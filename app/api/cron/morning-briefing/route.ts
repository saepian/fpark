import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';
import { makeUnsubToken } from '@/lib/unsubscribe-token';
import { COMPLIANCE_PRINCIPLE, INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';
import { fetchNaverNews, type NaverNewsItem } from '@/lib/naver-news';
import { nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, checkTemporalConsistency } from '@/lib/ai-grounding';
import { listAllAuthUserEmails } from '@/lib/list-all-auth-users';
import { fetchYahooIndex } from '@/lib/market-utils';
import type { MarketIndexData } from '@/lib/types';

// 장 시작 전(07:00 KST) 관심종목 "뉴스" 브리핑 — 저녁 daily-alert-email(수급/가격 중심)과
// 겹치지 않도록 전일 장 마감 이후 새로 나온 뉴스만 AI로 분석해서 보낸다.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// 종목마다 반복 호출되는 고정 지침 — 프롬프트 캐싱 대상 (system 블록, cache_control 적용)
const MORNING_BRIEFING_INSTRUCTIONS = `아래 JSON 형식으로만 응답하세요:
{
  "summary": "무슨 일이 있었는지 사실 기반 요약 (2~3문장)",
  "context": "시장/투자자들이 이 뉴스에 주목할 만한 이유에 대한 객관적 맥락 설명 (2~3문장)"
}

규칙:
- 매수/매도 의견, 목표가, 방향성 전망(상승/하락 예상 등)을 절대 포함하지 마세요.
- 위에 제공된 뉴스에 없는 내용을 지어내지 마세요.
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- 마크다운 문법(#, **, * 등) 사용 금지, 일반 텍스트로만 작성하세요.`;

// 관심종목 뉴스(MORNING_BRIEFING_INSTRUCTIONS)와 별개로, 관심종목과 무관한 "간밤 미국증시
// 전체" 요약 전용 지침. 국내 시장 방향을 예측/암시하는 표현을 절대 쓰지 않도록 명시 —
// "미국증시가 올랐으니 오늘 국내도 오를 것" 류의 문장이 나오면 유사투자자문업 규제 위반 소지가 있다.
const MORNING_MARKET_OVERVIEW_INSTRUCTIONS = `아래 JSON 형식으로만 응답하세요:
{
  "summary": "간밤 미국증시 동향 사실 기반 요약, 제공된 지수 등락률 수치를 반드시 포함 (2~3문장)",
  "context": "관련 뉴스에 실제로 언급된 배경/원인 설명 (1~2문장, 근거 뉴스가 없으면 빈 문자열)"
}

규칙:
- 위에 제공된 지수 등락률과 뉴스만 근거로 사용하고, 뉴스에 없는 원인을 지어내지 마세요.
- 이 데이터가 오늘 국내 시장에 미칠 영향을 예측하거나 암시하는 표현("오늘 국내 증시도 오를 것", "국내 증시에도 긍정적일 전망", "국내 시장 강세가 예상됩니다" 등)은 절대 쓰지 마세요.
- 국내 시장과의 연관성을 언급하려면, 제공된 뉴스에 그런 언급이 실제로 있을 때만 "관련이 있을 수 있다는 관측도 있다" 같은 관찰형으로만 쓰세요. 뉴스에 없으면 국내 시장 이야기 자체를 꺼내지 마세요.
- "매수"/"매도" 대신 "자금 유입"/"자금 유출" 표현을 쓰세요. 지수 자체의 등락은 "상승 마감"/"하락 마감"처럼 사실 그대로 서술하는 건 괜찮습니다.
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- 마크다운 문법(#, **, * 등) 사용 금지, 일반 텍스트로만 작성하세요.`;

type FreshNews = NaverNewsItem;
type TickerBriefing = { ticker: string; name: string; news: FreshNews[]; summary: string; context: string };
type UsMarketOverview = {
  summary: string;
  context: string;
  indices: { nasdaq: MarketIndexData | null; sp500: MarketIndexData | null; dow: MarketIndexData | null };
};

// 전일 장 마감(15:30 KST) 시각을 실제 UTC epoch로 계산 — 월요일이면 전 거래일이 금요일이므로 3일 전.
// (toLocaleString 트릭으로 만든 Date는 필드 읽기용일 뿐 epoch 비교에 쓰면 9시간 어긋나므로,
//  실제 비교에 쓸 epoch는 여기서 직접 계산한다)
function getPrevCloseUtc(): Date {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstShifted = new Date(Date.now() + KST_OFFSET_MS);
  const kstDay = kstShifted.getUTCDay(); // 0 Sun, 1 Mon, ... 6 Sat — 크론은 평일에만 돌지만 수동 테스트 대비 방어적으로 처리
  const daysBack = kstDay === 1 ? 3 : kstDay === 0 ? 2 : 1;
  return new Date(Date.UTC(
    kstShifted.getUTCFullYear(),
    kstShifted.getUTCMonth(),
    kstShifted.getUTCDate() - daysBack,
    6, 30, 0, 0, // 15:30 KST = 06:30 UTC (같은 날짜, 자정 넘어가지 않음)
  ));
}

function getKstDateInfo(): { dateStr: string; mm: number; dd: number } {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const mm = kst.getMonth() + 1;
  const dd = kst.getDate();
  return { dateStr: `${kst.getFullYear()}년 ${mm}월 ${dd}일`, mm, dd };
}

// 공통 fetchNaverNews(lib/naver-news.ts)를 쓰되, "종가 이후 새 뉴스"만 골라야 하므로
// pubDate 기준 sinceUtc 이후 건만 남긴다. diagnosis/stock 분석/daily-pick과 같은 API 래퍼 재사용.
async function fetchFreshNaverNews(stockName: string, sinceUtc: Date): Promise<{ items: FreshNews[]; apiError: boolean }> {
  const { items, apiError } = await fetchNaverNews(stockName, { display: 10, sort: 'date', timeoutMs: 5000 });
  if (apiError) {
    console.error(`[MORNING-BRIEFING] Naver News API 조회 실패 (${stockName})`);
    return { items: [], apiError: true };
  }
  const filtered = items.filter((n) => n.pubDate && new Date(n.pubDate).getTime() >= sinceUtc.getTime());
  return { items: filtered, apiError: false };
}

async function analyzeTickerNews(name: string, ticker: string, news: FreshNews[]): Promise<{ summary: string; context: string }> {
  const newsBlock = news
    .slice(0, 5)
    .map((n, i) => `${i + 1}. ${n.title}${n.description ? ` — ${n.description}` : ''}`)
    .join('\n');

  const prompt = `다음은 ${name}(${ticker})에 대해 전일 장 마감 이후 새로 보도된 뉴스입니다 (현재 시각: ${nowKstString()}, ${buildNewsFreshnessLine(news)}):

${newsBlock}

위 뉴스를 바탕으로 시스템 프롬프트에 제시된 JSON 형식과 규칙에 따라 응답하세요.`;

  try {
    const message = await Promise.race([
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: [
          { type: 'text', text: COMPLIANCE_PRINCIPLE },
          { type: 'text', text: MORNING_BRIEFING_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: prompt }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
    ]);
    const text  = message.content[0].type === 'text' ? message.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const result = {
        summary: String(parsed.summary ?? '').trim() || '새로운 뉴스가 확인되었습니다.',
        context: String(parsed.context ?? '').trim(),
      };
      // 시간적 사실관계 사후 검증 — 종목별 병렬 호출(배치)이라 재생성은 붙이지 않고 로그만 남긴다.
      const newsTextForCheck = news.map((n) => `${n.title} ${n.description ?? ''}`).join(' ');
      const check = checkTemporalConsistency(`${result.summary} ${result.context}`, newsTextForCheck);
      if (check.flagged) {
        console.warn(`[MORNING-BRIEFING] ${name} 시간적 사실관계 불일치 감지 (재생성 없음):`, check);
      }
      return result;
    }
  } catch (e) {
    console.error('[MORNING-BRIEFING] AI 분석 실패:', name, e instanceof Error ? e.message : e);
  }
  return { summary: '새로운 뉴스가 확인되었으나 AI 분석 생성에는 실패했습니다.', context: '' };
}

// 관심종목과 무관한 "간밤 미국증시 전체" 개요 — 크론 실행당 1회만 조회해 전 유저가 공유한다.
// daily-alert-email의 fetchMarketNews()(DB articles 테이블, fetch-news 크론이 09:00 KST에만
// 채움)는 07:00 KST 발송 시점엔 아직 간밤 뉴스가 안 들어있을 수 있어 여기선 쓰지 않고,
// 이 파일이 이미 쓰는 fetchNaverNews()로 그 자리에서 직접 실시간 검색한다.
async function fetchOvernightUsMarketOverview(): Promise<UsMarketOverview | null> {
  const [nasdaq, sp500, dow] = await Promise.all([
    fetchYahooIndex('^IXIC'),
    fetchYahooIndex('^GSPC'),
    fetchYahooIndex('^DJI'),
  ]);
  if (!nasdaq && !sp500 && !dow) {
    console.log('[MORNING-BRIEFING] 미국증시 지수 조회 전부 실패 — 섹션 생략');
    return null;
  }

  const { items: newsItems, apiError } = await fetchNaverNews('뉴욕증시', { sort: 'date', display: 5 });
  if (apiError) console.error('[MORNING-BRIEFING] 뉴욕증시 뉴스 조회 실패 — 지수만으로 요약 진행');

  const indexLine = (label: string, d: MarketIndexData | null) =>
    d ? `- ${label}: ${d.value.toLocaleString()} (${d.changeRate >= 0 ? '+' : ''}${d.changeRate.toFixed(2)}%)` : `- ${label}: 조회 실패`;

  const newsText = newsItems.length
    ? newsItems.map((n, i) => `${i + 1}. ${n.title}${n.description ? ` — ${n.description}` : ''}`).join('\n')
    : '관련 뉴스 없음';

  const prompt = `다음은 간밤 미국증시 마감 지수와 관련 뉴스입니다 (현재 시각: ${nowKstString()}, ${buildNewsFreshnessLine(newsItems)}):

## 지수 등락
${indexLine('나스닥', nasdaq)}
${indexLine('S&P500', sp500)}
${indexLine('다우존스', dow)}

## 관련 뉴스
${newsText}

위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 형식과 규칙에 따라 응답하세요.`;

  const indices = { nasdaq, sp500, dow };

  try {
    const message = await Promise.race([
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: [
          { type: 'text', text: COMPLIANCE_PRINCIPLE },
          { type: 'text', text: MORNING_MARKET_OVERVIEW_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: prompt }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
    ]);
    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON 파싱 실패: ' + text.slice(0, 100));
    const parsed = JSON.parse(match[0]);
    const summary = String(parsed.summary ?? '').trim();
    const context = String(parsed.context ?? '').trim();

    // 시간적 사실관계 사후 검증 — 크론당 1회 호출이라 재생성은 붙이지 않고 로그만 남긴다.
    const newsTextForCheck = newsItems.map((n) => `${n.title} ${n.description ?? ''}`).join(' ');
    const check = checkTemporalConsistency(`${summary} ${context}`, newsTextForCheck);
    if (check.flagged) {
      console.warn('[MORNING-BRIEFING] 미국증시 요약 시간적 사실관계 불일치 감지 (재생성 없음):', check);
    }

    return { summary, context, indices };
  } catch (e) {
    console.error('[MORNING-BRIEFING] 미국증시 요약 생성 실패:', e instanceof Error ? e.message : e);
    return {
      summary: '오늘의 미국증시 동향 요약을 생성하지 못했습니다. 아래 지수 현황을 참고해주세요.',
      context: '',
      indices,
    };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMorningEmailHtml(params: {
  userName: string;
  dateStr: string;
  stocks: TickerBriefing[];
  userId: string;
  usMarket: UsMarketOverview | null;
}): string {
  const { userName, dateStr, stocks, userId, usMarket } = params;

  const usIndexRow = (label: string, d: MarketIndexData | null) => {
    if (!d) {
      return `<tr style="border-bottom:1px solid #1e2537">
        <td style="padding:5px 4px;color:#64748b;font-size:12.5px">${label}</td>
        <td colspan="2" style="padding:5px 4px;color:#475569;font-size:12px;text-align:right">조회 실패</td>
      </tr>`;
    }
    const color = d.changeRate > 0 ? '#ef4444' : d.changeRate < 0 ? '#3b82f6' : '#6b7280';
    const sign  = d.changeRate > 0 ? '+' : '';
    return `<tr style="border-bottom:1px solid #1e2537">
      <td style="padding:5px 4px;color:#e2e8f0;font-size:12.5px">${label}</td>
      <td style="padding:5px 4px;color:#e2e8f0;font-size:12.5px;text-align:right;font-family:monospace">${d.value.toLocaleString()}</td>
      <td style="padding:5px 4px;color:${color};font-size:12.5px;font-weight:700;text-align:right;font-family:monospace">${sign}${d.changeRate.toFixed(2)}%</td>
    </tr>`;
  };

  // 관심종목 뉴스와 무관한 시장 전체 섹션 — 데이터가 하나도 없으면(지수 전부 실패) 생략.
  const usMarketSection = usMarket
    ? `<div style="margin-top:20px;background:#0f1117;border:1px solid #1e2537;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 14px;color:#e2e8f0;font-size:14px;font-weight:700;letter-spacing:.05em">🌙 간밤 미국증시 동향</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
          <tbody>
            ${usIndexRow('나스닥', usMarket.indices.nasdaq)}
            ${usIndexRow('S&P500', usMarket.indices.sp500)}
            ${usIndexRow('다우존스', usMarket.indices.dow)}
          </tbody>
        </table>
        ${usMarket.summary ? `<p style="margin:0 0 8px;color:#cbd5e1;font-size:13px;line-height:1.8">${escapeHtml(usMarket.summary)}</p>` : ''}
        ${usMarket.context ? `<p style="margin:0;color:#94a3b8;font-size:12.5px;line-height:1.8">${escapeHtml(usMarket.context)}</p>` : ''}
        <p style="margin:12px 0 0;color:#475569;font-size:11px;font-style:italic;border-top:1px solid #1e293b;padding-top:10px">
          ${INVESTMENT_DISCLAIMER}
        </p>
      </div>`
    : '';

  const stockCard = (s: TickerBriefing) => `
    <div style="margin-top:20px;background:#0f1117;border:1px solid #1e2537;border-radius:12px;padding:20px 24px">
      <h3 style="margin:0 0 12px;color:#e2e8f0;font-size:15px;font-weight:700">
        ${escapeHtml(s.name)} <span style="color:#475569;font-size:11px;font-weight:400">${s.ticker}</span>
      </h3>
      <div style="background:#0d1117;border:1px solid #312e81;border-radius:10px;padding:14px 16px">
        <p style="margin:0 0 8px;color:#818cf8;font-size:11px;font-weight:700;letter-spacing:.05em">AI 분석</p>
        <p style="margin:0 0 8px;color:#cbd5e1;font-size:13px;line-height:1.8">${escapeHtml(s.summary)}</p>
        ${s.context ? `<p style="margin:0;color:#94a3b8;font-size:12.5px;line-height:1.8">${escapeHtml(s.context)}</p>` : ''}
      </div>
      <div style="margin-top:12px">
        <p style="margin:0 0 6px;color:#64748b;font-size:11px;font-weight:600;letter-spacing:.05em">관련 뉴스 원문</p>
        <ul style="margin:0;padding:0 0 0 16px;color:#94a3b8;font-size:12.5px;line-height:1.9">
          ${s.news.slice(0, 3).map((n) => `<li><a href="${n.url}" style="color:#a5b4fc;text-decoration:none">${escapeHtml(n.title)}</a></li>`).join('')}
        </ul>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finance Park 아침 브리핑</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px 48px">

    <!-- 헤더 -->
    <div style="text-align:center;padding:32px 0 24px">
      <div style="font-size:22px;font-weight:800;color:#818cf8;letter-spacing:-.02em">Finance Park</div>
      <p style="margin:8px 0 0;color:#64748b;font-size:12px">${dateStr} · 장 시작 전 관심종목 뉴스 브리핑</p>
    </div>

    <!-- 인사말 -->
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:12px;padding:16px 20px">
      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.7">
        안녕하세요, <strong style="color:#e2e8f0">${escapeHtml(userName)}</strong>님.<br>
        전일 장 마감 이후 관심종목 <strong style="color:#e2e8f0">${stocks.length}개</strong>에서 새로운 뉴스가 확인되었습니다.
      </p>
    </div>

    ${usMarketSection}

    ${stocks.map(stockCard).join('')}

    <p style="margin:20px 0 0;color:#475569;font-size:11px;font-style:italic;text-align:center;line-height:1.6">
      ${INVESTMENT_DISCLAIMER}
    </p>

    <!-- CTA 버튼 -->
    <div style="text-align:center;margin-top:28px">
      <a href="https://fpark.com" style="display:inline-block;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:13.5px;font-weight:600">
        fpark.com에서 자세히 보기 →
      </a>
    </div>

    <!-- 푸터 -->
    <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #1e2537">
      <p style="color:#334155;font-size:11px;margin:0 0 8px">Finance Park · Pro 구독자 전용 아침 브리핑</p>
      <a href="https://fpark.com/api/email/unsubscribe?token=${makeUnsubToken(userId)}&type=morning" style="color:#475569;font-size:11px;text-decoration:underline">
        이메일 수신 거부
      </a>
    </div>

  </div>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  const resend     = new Resend(process.env.RESEND_API_KEY!);
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/morning-briefing] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/morning-briefing] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sinceUtc = getPrevCloseUtc();
  const { dateStr, mm, dd } = getKstDateInfo();
  console.log(`[MORNING-BRIEFING] 시작 — 기준 시각(전일 마감) ${sinceUtc.toISOString()} 이후 뉴스만 대상`);

  // 1. Pro 구독자 + 아침 브리핑 수신 동의자 (저녁 리포트의 email_alert_enabled와는 별개 토글)
  const { data: proUsers, error: usersError } = await adminClient
    .from('users')
    .select('id')
    .eq('plan', 'pro')
    .eq('morning_briefing_enabled', true);

  if (usersError) {
    console.error('[MORNING-BRIEFING] users 쿼리 실패:', usersError.message);
    return NextResponse.json({ ok: false, error: usersError.message });
  }
  if (!proUsers?.length) {
    console.log('[MORNING-BRIEFING] 발송 대상 없음 (Pro 구독자 없음)');
    return NextResponse.json({ ok: true, sent: 0, reason: 'no-pro-users' });
  }
  const userIds = proUsers.map((u: { id: string }) => u.id);

  // 2. 이메일 주소 일괄 조회
  let emailMap: Map<string, string>;
  try {
    emailMap = await listAllAuthUserEmails('[MORNING-BRIEFING]');
  } catch (e) {
    console.error('[MORNING-BRIEFING] 유저 이메일 조회 최종 실패 — 발송 중단:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'listUsers failed' });
  }

  // 3. 관심종목 일괄 조회 — 워치리스트 없는 Pro 유저는 여기서 자연스럽게 제외
  const { data: allWatchlist } = await adminClient
    .from('watchlist')
    .select('user_id, ticker, name')
    .in('user_id', userIds)
    .or('market.eq.kr,market.is.null');

  const userWatchMap = new Map<string, { ticker: string; name: string }[]>();
  const tickerNameMap = new Map<string, string>();
  for (const item of (allWatchlist ?? [])) {
    const curr = userWatchMap.get(item.user_id) ?? [];
    curr.push({ ticker: item.ticker, name: item.name });
    userWatchMap.set(item.user_id, curr);
    if (!tickerNameMap.has(item.ticker)) tickerNameMap.set(item.ticker, item.name);
  }

  const activeUserIds = userIds.filter((id) => (userWatchMap.get(id)?.length ?? 0) > 0);
  if (!activeUserIds.length) {
    console.log('[MORNING-BRIEFING] 관심종목 보유 Pro 유저 없음');
    return NextResponse.json({ ok: true, sent: 0, reason: 'no-watchlist' });
  }

  // 4. 유니크 종목별 "새 뉴스" 조회 (유저별 아니라 종목 단위로 한 번만, 청크+지연으로 API 보호)
  const uniqueTickers = [...tickerNameMap.keys()];
  console.log(`[MORNING-BRIEFING] 새 뉴스 조회 대상: ${uniqueTickers.length}개 종목`);

  // 관심종목과 무관한 "간밤 미국증시" 개요 — 종목별 뉴스 스캔과 독립적이라 병렬로 시작해둔다.
  // 크론 실행당 1회만 조회해 전 유저가 공유(daily-alert-email의 시장 전체 뉴스와 동일 패턴).
  const usMarketPromise = fetchOvernightUsMarketOverview();

  const newsResultMap = new Map<string, FreshNews[]>();
  let apiErrorCount = 0;
  for (let i = 0; i < uniqueTickers.length; i += 3) {
    const chunk = uniqueTickers.slice(i, i + 3);
    const settled = await Promise.allSettled(
      chunk.map(async (ticker) => {
        const name = tickerNameMap.get(ticker)!;
        const { items, apiError } = await fetchFreshNaverNews(name, sinceUtc);
        return { ticker, items, apiError };
      }),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        if (r.value.apiError) apiErrorCount++;
        else if (r.value.items.length) newsResultMap.set(r.value.ticker, r.value.items);
      } else {
        apiErrorCount++;
      }
    }
    if (i + 3 < uniqueTickers.length) await new Promise((r) => setTimeout(r, 300));
  }

  // KIS API 실패/조건미충족 구분 로깅과 같은 원칙 — "새 뉴스 없음"과 "API 자체 장애"를 구분해서 남긴다
  const apiErrorRate = uniqueTickers.length ? apiErrorCount / uniqueTickers.length : 0;
  console.log(
    `[MORNING-BRIEFING] 조회 완료 — ${newsResultMap.size}/${uniqueTickers.length}개 종목에 새 뉴스 ` +
    `(Naver API 실패 ${apiErrorCount}건 / 실패율 ${Math.round(apiErrorRate * 100)}%)`,
  );
  if (apiErrorRate >= 0.8) {
    console.error(`[MORNING-BRIEFING] Naver News API 장애 의심 (실패율 ${Math.round(apiErrorRate * 100)}%) — 결과가 비정상적으로 적을 수 있음`);
  }

  const tickersWithNews = [...newsResultMap.keys()];
  if (!tickersWithNews.length) {
    console.error(`[MORNING-BRIEFING] 활성 유저 ${activeUserIds.length}명 있었으나 새 뉴스 있는 종목 없음 — 발송 스킵 (sent:0, 확인 필요)`);
    return NextResponse.json({ ok: true, sent: 0, reason: 'no-fresh-news' });
  }

  // 5. 새 뉴스 있는 종목만 AI 분석 (병렬)
  const briefingMap = new Map<string, TickerBriefing>();
  const analysisSettled = await Promise.allSettled(
    tickersWithNews.map(async (ticker) => {
      const name = tickerNameMap.get(ticker)!;
      const news = newsResultMap.get(ticker)!;
      const { summary, context } = await analyzeTickerNews(name, ticker, news);
      return { ticker, name, news, summary, context };
    }),
  );
  for (const r of analysisSettled) {
    if (r.status === 'fulfilled') briefingMap.set(r.value.ticker, r.value);
    else console.error('[MORNING-BRIEFING] 종목 분석 단계 실패:', r.reason);
  }

  // 6. 유저별로 "새 뉴스 있는 관심종목"만 필터 — 하나도 없으면 그 유저는 발송 자체 스킵
  type UserBriefing = { userId: string; email: string; userName: string; stocks: TickerBriefing[] };
  const userBriefings: UserBriefing[] = [];
  for (const userId of activeUserIds) {
    const email = emailMap.get(userId) ?? '';
    if (!email) { console.warn(`[MORNING-BRIEFING] 이메일 없음: ${userId}`); continue; }
    const watchTickers = (userWatchMap.get(userId) ?? []).map((w) => w.ticker);
    const stocks = watchTickers
      .map((t) => briefingMap.get(t))
      .filter((s): s is TickerBriefing => !!s);
    if (!stocks.length) continue;
    userBriefings.push({ userId, email, userName: email.split('@')[0], stocks });
  }

  if (!userBriefings.length) {
    console.error(`[MORNING-BRIEFING] 활성 유저 ${activeUserIds.length}명 있었으나 새 뉴스가 관심종목에 매칭되는 유저 없음 — 발송 스킵 (sent:0, 확인 필요)`);
    return NextResponse.json({ ok: true, sent: 0, reason: 'no-matching-users' });
  }

  const usMarket = await usMarketPromise;
  console.log(`[MORNING-BRIEFING] 미국증시 개요 — ${usMarket ? '조회 성공' : '전체 실패(섹션 생략)'}`);

  // 7. 발송 (순차 — Resend 속도 제한 준수)
  let sent = 0;
  let failed = 0;
  const subject = `[fpark] ${mm}월 ${dd}일 오늘의 관심종목 뉴스 분석`;

  for (const ub of userBriefings) {
    const html = buildMorningEmailHtml({
      userName: ub.userName,
      dateStr,
      stocks:   ub.stocks,
      userId:   ub.userId,
      usMarket,
    });

    let status: 'sent' | 'failed' = 'sent';
    try {
      const { error: sendError } = await resend.emails.send({
        from: 'Finance Park <noreply@fpark.com>',
        to: [ub.email],
        subject,
        html,
      });
      if (sendError) throw new Error(JSON.stringify(sendError));
      sent++;
      console.log(`[MORNING-BRIEFING] ✓ 발송: ${ub.email} (새 뉴스 종목 ${ub.stocks.length}개)`);
    } catch (e) {
      status = 'failed';
      failed++;
      console.error(`[MORNING-BRIEFING] 발송 실패 (${ub.email}):`, e instanceof Error ? e.message : e);
    }

    try {
      await adminClient.from('email_send_logs').insert({
        user_id:            ub.userId,
        stock_count:        ub.stocks.length,
        ai_comment:         `[아침브리핑] ${ub.stocks.map((s) => s.name).join(', ')}`,
        status,
      });
    } catch (e) {
      console.warn('[MORNING-BRIEFING] 로그 저장 실패:', e instanceof Error ? e.message : e);
    }
  }

  console.log(`[MORNING-BRIEFING] 완료 — 발송: ${sent}, 실패: ${failed}`);
  if (sent === 0 && activeUserIds.length > 0) {
    console.error(`[MORNING-BRIEFING] 활성 유저 ${activeUserIds.length}명 있었으나 최종 발송 0건 (실패 ${failed}건) — 확인 필요`);
  }
  return NextResponse.json({ ok: true, sent, failed });
}
