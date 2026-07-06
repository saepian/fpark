import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { fetchStockPrice } from '@/lib/kis-api';
import { makeUnsubToken } from '@/lib/unsubscribe-token';
import { fetchDBNews, fetchMarketNews, pickRelevantNews } from '@/lib/stock-analysis-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;


type StockResult = {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
  sector?: string;
};

type NewsItem = { title: string; summary?: string; date?: string; url?: string };

// 관심종목 등락률 기준 "유의미한 하락"으로 보고 뉴스 근거를 조회할 문턱값
const DECLINE_THRESHOLD = -3;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function fetchPricesInChunks(tickers: string[]): Promise<Map<string, StockResult>> {
  const result = new Map<string, StockResult>();
  for (let i = 0; i < tickers.length; i += 3) {
    const batch = tickers.slice(i, i + 3);
    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const data = await fetchStockPrice(ticker);
        return {
          ticker, name: data.name, price: data.price, change: data.change,
          changeRate: data.changeRate, sector: data.sector,
        };
      }),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') result.set(r.value.ticker, r.value);
    }
    if (i + 3 < tickers.length) await new Promise((r) => setTimeout(r, 300));
  }
  return result;
}

// 하락 종목들의 관련 뉴스를 배치 조회 (유저별이 아니라 유니크 종목 단위로 한 번만)
async function fetchDeclineNewsMap(
  decliningStocks: StockResult[],
): Promise<Map<string, NewsItem[]>> {
  const newsMap = new Map<string, NewsItem[]>();
  const settled = await Promise.allSettled(
    decliningStocks.map(async (s) => {
      const candidates = await fetchDBNews(s.name, s.ticker, s.sector);
      const relevant   = pickRelevantNews(candidates, s.name, s.sector, 3);
      return { ticker: s.ticker, relevant };
    }),
  );
  for (const r of settled) {
    if (r.status === 'fulfilled') newsMap.set(r.value.ticker, r.value.relevant);
  }
  return newsMap;
}

// 여러 하락 종목에 동일 뉴스(같은 url, 없으면 정규화된 제목)가 매칭되면 "공통 원인 후보"로 병합
// (포트폴리오 진단 뉴스 동향 집계와 동일한 방식 — 지어내지 않고 실제 매칭 데이터로만 판단)
function findCommonCauseNews(
  decliningStocks: StockResult[],
  newsMap: Map<string, NewsItem[]>,
): { title: string; summary?: string; stocks: string[] }[] {
  const map = new Map<string, { title: string; summary?: string; stocks: string[] }>();
  for (const s of decliningStocks) {
    for (const n of newsMap.get(s.ticker) ?? []) {
      const key = (n.url && n.url.trim()) || n.title.trim().toLowerCase();
      const existing = map.get(key);
      if (existing) {
        if (!existing.stocks.includes(s.name)) existing.stocks.push(s.name);
      } else {
        map.set(key, { title: n.title, summary: n.summary, stocks: [s.name] });
      }
    }
  }
  return [...map.values()].filter((n) => n.stocks.length >= 2);
}

async function generateAiComment(
  userName: string,
  stocks: StockResult[],
  newsMap: Map<string, NewsItem[]>,
  commonCauseNews: { title: string; summary?: string; stocks: string[] }[],
  marketNews: NewsItem[],
): Promise<string> {
  const stockList = stocks
    .map(
      (s) =>
        `- ${s.name}(${s.ticker}): ${s.changeRate > 0 ? '+' : ''}${s.changeRate.toFixed(2)}% (${s.change > 0 ? '+' : ''}${s.change.toLocaleString()}원)`,
    )
    .join('\n');

  const decliningStocks = stocks.filter((s) => s.changeRate <= DECLINE_THRESHOLD);

  // 하락 종목별 뉴스 근거 블록 — 뉴스가 있으면 근거로, 없으면 "수급 요인 추정"임을 명시하도록 데이터 자체를 그렇게 구성
  const declineNewsBlock = decliningStocks.length
    ? decliningStocks
        .map((s) => {
          const news = newsMap.get(s.ticker) ?? [];
          const newsLines = news.length
            ? news.map((n) => `  · ${n.title}${n.summary ? ` — ${n.summary}` : ''}`).join('\n')
            : '  · 관련 뉴스 확인되지 않음 (수급 요인으로만 추정 가능)';
          return `- ${s.name}(${s.changeRate.toFixed(2)}%) 관련 뉴스:\n${newsLines}`;
        })
        .join('\n')
    : '';

  // 이 유저의 하락 종목들 사이에서 실제로 겹치는 뉴스만 "공통 원인 후보"로 전달 (지어내지 않음)
  const userDecliningNames = new Set(decliningStocks.map((s) => s.name));
  const relevantCommonCause = commonCauseNews
    .map((n) => ({ ...n, stocks: n.stocks.filter((name) => userDecliningNames.has(name)) }))
    .filter((n) => n.stocks.length >= 2);
  const commonCauseBlock = relevantCommonCause.length
    ? relevantCommonCause
        .map((n) => `- "${n.title}" 기사가 ${n.stocks.join(', ')}에 공통으로 매칭됨`)
        .join('\n')
    : '';

  // 시장 전체(코스피/코스닥/금리/환율/해외증시 등) 뉴스 — 개별 종목과 무관하게 크론 실행당 1회만 조회된 컨텍스트
  const marketNewsBlock = marketNews.length
    ? marketNews.map((n) => `- ${n.title}${n.summary ? ` — ${n.summary}` : ''}`).join('\n')
    : '';

  const prompt = `당신은 국내 주식 시장 데이터를 있는 그대로 정리하는 정보 제공자입니다. 투자자문업자가 아니므로 매수/매도를 지시하거나 권유하지 마세요.

다음은 오늘 투자자의 관심종목 등락 현황입니다:
${stockList}
${declineNewsBlock ? `\n다음은 하락 종목별로 실제 조회된 관련 뉴스입니다 (아래 목록에 없는 원인은 절대 지어내지 마세요):\n${declineNewsBlock}\n` : ''}
${commonCauseBlock ? `\n여러 하락 종목에 공통으로 매칭된 뉴스:\n${commonCauseBlock}\n` : ''}
${marketNewsBlock ? `\n다음은 오늘 시장 전체(코스피/코스닥/금리/환율/해외증시 등)에 영향을 줄 수 있는 뉴스입니다 (실제로 오늘 하락과 관련 있다고 판단되는 경우에만 언급하고, 관련 없으면 언급하지 마세요):\n${marketNewsBlock}\n` : ''}

아래 3개 섹션 구조로 정리해주세요 (섹션 번호와 제목을 그대로 사용):

1. 종목별 하락 배경: 위에 제공된 뉴스가 있으면 그 뉴스를 근거로 하락 배경을 설명하고, 뉴스가 없다고 표시된 종목은 "특별한 뉴스 근거 없이 수급 요인으로 추정됨"이라고 정직하게 명시하세요.
2. 시장 전체 배경 및 종합 판단: 시장 전체 뉴스가 오늘 하락과 관련 있다고 판단되면 그 영향 가능성을 짚고, 그것이 개별 종목의 긍정 뉴스를 상쇄했는지도 함께 판단하세요 (예: "오늘 [뉴스 내용]으로 시장 전반이 하락 압력을 받았고, 이것이 [종목]의 개별 호재를 상쇄한 것으로 추정됩니다"). 여러 종목에 공통으로 매칭된 뉴스가 있다면 이 섹션에서 함께 언급하세요. 시장 전체 뉴스가 없거나 관련이 없다면 "특별한 시장 전체 이슈는 확인되지 않아 개별 종목 수급 요인으로 추정됩니다"라고 정직하게 명시하세요. 이 섹션 안에서 오늘 관심종목 전반의 등락 흐름도 한 문장으로 요약하세요.
3. 내일 주목 포인트: 투자자가 참고할 만한 관찰 포인트를 2~3줄로 짧게 (지시가 아닌 정보 형태로)

작성 규칙 (반드시 준수):
- "금리 우려", "실적 부진", "업황 둔화", "미국발 조정" 같은 구체적 원인은 위에 제공된 뉴스(종목별 또는 시장 전체)에 실제로 등장하는 경우에만 사용하세요. 뉴스로 확인되지 않은 원인을 절대 지어내지 마세요.
- 뉴스 근거가 없는 하락은 반드시 "수급 요인으로 추정됨" 형태로만 표현하고, 없는 뉴스를 있는 것처럼 서술하지 마세요.
- 종목의 등락률은 반드시 맨 위 "관심종목 등락 현황"에 제공된 수치만 사용하세요. 뉴스 기사 본문/제목에 등락률 수치(예: "7% 급락")가 포함되어 있어도, 그 수치를 해당 종목의 현재 등락률로 착각해 인용하지 마세요 — 기사 속 수치는 기사가 작성된 시점(장 초반 등)의 별도 수치일 수 있습니다. 기사 속 수치를 굳이 언급해야 한다면 "기사에 따르면 장 초반 한때 -N%" 처럼 현재 등락률과 명확히 구분해서 표현하세요.
- 마크다운 문법(#, **, * 등) 사용 금지, 일반 텍스트로만 작성
- "~하세요", "~하는 게 좋습니다" 같은 권유·지시형 문장 대신 "~관찰됩니다", "~로 추정됩니다" 형태의 관찰형 어조 사용
- 단정적인 매수/매도 추천 금지, 참고용 관찰로만 표현
- 3개 섹션 구조를 반드시 지키고, 섹션을 더 쪼개거나 추가하지 마세요
- 전체 분량은 공백 포함 800~1000자 내외로 작성하세요 (너무 짧지도, 너무 길지도 않게)`;

  try {
    const message = await Promise.race([
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
    ]);
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    return text || '오늘 시장 데이터를 분석 중입니다.';
  } catch (e) {
    console.warn('[DAILY-EMAIL] AI 코멘트 생성 실패:', e instanceof Error ? e.message : e);
    return '오늘 시장 데이터를 분석 중입니다.';
  }
}

// Claude 응답 등 외부 텍스트를 HTML에 삽입할 때 특수문자 이스케이프
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEmailHtml(params: {
  userName: string;
  dateStr: string;
  stocks: StockResult[];
  aiComment: string;
  notifications: { message: string }[];
  userId: string;
}): string {
  const { userName, dateStr, stocks, aiComment, notifications, userId } = params;

  const upStocks   = stocks.filter((s) => s.changeRate > 0);
  const downStocks = stocks.filter((s) => s.changeRate < 0);
  const flatStocks = stocks.filter((s) => s.changeRate === 0);

  const sorted = [
    ...upStocks.sort((a, b) => b.changeRate - a.changeRate),
    ...flatStocks,
    ...downStocks.sort((a, b) => a.changeRate - b.changeRate),
  ];

  const row = (s: StockResult) => {
    const color = s.changeRate > 0 ? '#ef4444' : s.changeRate < 0 ? '#3b82f6' : '#6b7280';
    const sign  = s.changeRate > 0 ? '+' : '';
    return `<tr style="border-bottom:1px solid #1e2537">
      <td style="padding:10px 8px;color:#e2e8f0;font-size:13px">${s.name}<span style="color:#475569;font-size:11px;margin-left:4px">${s.ticker}</span></td>
      <td style="padding:10px 8px;color:#e2e8f0;font-size:13px;text-align:right;font-family:monospace">${s.price.toLocaleString()}원</td>
      <td style="padding:10px 8px;color:${color};font-size:13px;font-weight:700;text-align:right;font-family:monospace">${sign}${s.changeRate.toFixed(2)}%</td>
      <td style="padding:10px 8px;color:${color};font-size:13px;text-align:right;font-family:monospace">${sign}${s.change.toLocaleString()}원</td>
    </tr>`;
  };

  const aiSection = `<div style="margin-top:28px;background:#0f1117;border:1px solid #312e81;border-radius:12px;padding:20px 24px">
      <h2 style="margin:0 0 14px;font-size:14px;font-weight:700;color:#818cf8;letter-spacing:.05em">📊 AI 분석</h2>
      <p style="margin:0;color:#cbd5e1;font-size:13.5px;line-height:1.9;white-space:pre-line">${escapeHtml(aiComment)}</p>
      <p style="margin:16px 0 0;color:#475569;font-size:11px;font-style:italic;border-top:1px solid #1e293b;padding-top:12px">
        본 내용은 AI가 생성한 참고용 정보이며 투자 조언이 아닙니다. 투자의 최종 책임은 투자자 본인에게 있습니다.
      </p>
    </div>`;

  const notifSection =
    notifications.length > 0
      ? `<div style="margin-top:28px;background:#0f1117;border:1px solid #1e2537;border-radius:12px;padding:20px 24px">
          <h2 style="margin:0 0 14px;color:#a78bfa;font-size:14px;font-weight:700;letter-spacing:.05em">🔔 오늘 발생한 알림</h2>
          <ul style="margin:0;padding:0 0 0 16px;color:#94a3b8;font-size:12.5px;line-height:2">
            ${notifications.map((n) => `<li>${escapeHtml(n.message)}</li>`).join('')}
          </ul>
        </div>`
      : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finance Park 일일 리포트</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px 48px">

    <!-- 헤더 -->
    <div style="text-align:center;padding:32px 0 24px">
      <div style="font-size:22px;font-weight:800;color:#818cf8;letter-spacing:-.02em">Finance Park</div>
      <p style="margin:8px 0 0;color:#64748b;font-size:12px">${dateStr} 관심종목 일일 리포트</p>
    </div>

    <!-- 인사말 -->
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:12px;padding:16px 20px;margin-bottom:20px">
      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.7">
        안녕하세요, <strong style="color:#e2e8f0">${userName}</strong>님.<br>
        오늘 관심종목 <strong style="color:#e2e8f0">${stocks.length}개</strong>의 종가 현황을 전달해 드립니다.
      </p>
    </div>

    <!-- 관심종목 현황 -->
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:12px;padding:20px 24px">
      <h2 style="margin:0 0 16px;color:#e2e8f0;font-size:14px;font-weight:700;letter-spacing:.05em">📈 관심종목 등락 현황</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid #334155">
            <th style="padding:6px 8px;color:#64748b;font-size:11px;font-weight:600;text-align:left;letter-spacing:.05em">종목</th>
            <th style="padding:6px 8px;color:#64748b;font-size:11px;font-weight:600;text-align:right;letter-spacing:.05em">현재가</th>
            <th style="padding:6px 8px;color:#64748b;font-size:11px;font-weight:600;text-align:right;letter-spacing:.05em">등락률</th>
            <th style="padding:6px 8px;color:#64748b;font-size:11px;font-weight:600;text-align:right;letter-spacing:.05em">등락금액</th>
          </tr>
        </thead>
        <tbody>${sorted.map(row).join('')}</tbody>
      </table>

      <!-- 요약 통계 -->
      <div style="display:flex;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid #1e2537">
        <div style="flex:1;text-align:center;padding:8px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px">
          <div style="color:#ef4444;font-size:18px;font-weight:700">${upStocks.length}</div>
          <div style="color:#64748b;font-size:10px;margin-top:2px">상승</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px;background:rgba(100,116,139,.08);border:1px solid rgba(100,116,139,.2);border-radius:8px">
          <div style="color:#94a3b8;font-size:18px;font-weight:700">${flatStocks.length}</div>
          <div style="color:#64748b;font-size:10px;margin-top:2px">보합</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:8px">
          <div style="color:#3b82f6;font-size:18px;font-weight:700">${downStocks.length}</div>
          <div style="color:#64748b;font-size:10px;margin-top:2px">하락</div>
        </div>
      </div>
    </div>

    ${aiSection}
    ${notifSection}

    <!-- CTA 버튼 -->
    <div style="text-align:center;margin-top:28px">
      <a href="https://fpark.com" style="display:inline-block;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:13.5px;font-weight:600">
        fpark.com에서 자세히 보기 →
      </a>
    </div>

    <!-- 푸터 -->
    <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #1e2537">
      <p style="color:#334155;font-size:11px;margin:0 0 8px">Finance Park · Pro 구독자 전용 일일 리포트</p>
      <a href="https://fpark.com/api/email/unsubscribe?token=${makeUnsubToken(userId)}&type=evening" style="color:#475569;font-size:11px;text-decoration:underline">
        이메일 수신 거부
      </a>
    </div>

  </div>
</body>
</html>`;
}

function getKstInfo(): { dateStr: string; notifDate: string; mm: number; dd: number } {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const mm = kst.getMonth() + 1;
  const dd = kst.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dateStr:   `${kst.getFullYear()}년 ${mm}월 ${dd}일`,
    notifDate: `${kst.getFullYear()}-${pad(mm)}-${pad(dd)}`,
    mm,
    dd,
  };
}

export async function GET(request: NextRequest) {
  const resend     = new Resend(process.env.RESEND_API_KEY!);
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/daily-alert-email] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/daily-alert-email] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { dateStr, notifDate, mm, dd } = getKstInfo();

  // 1. Pro 구독자 + 이메일 수신 동의자
  const { data: proUsers, error: usersError } = await adminClient
    .from('users')
    .select('id')
    .eq('plan', 'pro')
    .eq('email_alert_enabled', true);

  if (usersError) {
    console.error('[DAILY-EMAIL] users 쿼리 실패:', usersError.message);
    return NextResponse.json({ ok: false, error: usersError.message });
  }
  if (!proUsers?.length) {
    console.log('[DAILY-EMAIL] 발송 대상 없음');
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const userIds = proUsers.map((u: { id: string }) => u.id);
  console.log(`[DAILY-EMAIL] 발송 대상: ${userIds.length}명`);

  // 2. 이메일 주소 일괄 조회 (페이지네이션으로 1000명 초과 대응)
  const allAuthUsers: { id: string; email?: string }[] = [];
  let authPage = 1;
  while (true) {
    const { data: { users: pageUsers } } = await adminClient.auth.admin.listUsers({ page: authPage, perPage: 1000 });
    if (!pageUsers?.length) break;
    allAuthUsers.push(...pageUsers);
    if (pageUsers.length < 1000) break;
    authPage++;
  }
  const emailMap = new Map<string, string>(allAuthUsers.map((u) => [u.id, u.email ?? ''] as [string, string]));

  // 3. 관심종목 일괄 조회
  const { data: allWatchlist } = await adminClient
    .from('watchlist')
    .select('user_id, ticker, name')
    .in('user_id', userIds)
    .or('market.eq.kr,market.is.null');

  const userWatchMap = new Map<string, { ticker: string; name: string }[]>();
  for (const item of (allWatchlist ?? [])) {
    const curr = userWatchMap.get(item.user_id) ?? [];
    curr.push({ ticker: item.ticker, name: item.name });
    userWatchMap.set(item.user_id, curr);
  }

  const activeUserIds = userIds.filter((id) => (userWatchMap.get(id)?.length ?? 0) > 0);
  if (!activeUserIds.length) {
    console.log('[DAILY-EMAIL] 관심종목 보유 사용자 없음');
    return NextResponse.json({ ok: true, sent: 0 });
  }

  // 4. 유니크 ticker 주가 일괄 조회
  const uniqueTickers = [
    ...new Set(activeUserIds.flatMap((id) => (userWatchMap.get(id) ?? []).map((w) => w.ticker))),
  ];
  console.log(`[DAILY-EMAIL] 주가 조회: ${uniqueTickers.length}개 종목`);
  const priceMap = await fetchPricesInChunks(uniqueTickers);

  // 5. 오늘 알림 일괄 조회
  const { data: todayNotifs } = await adminClient
    .from('notifications')
    .select('user_id, message, type')
    .in('user_id', activeUserIds)
    .eq('notif_date', notifDate);

  const notifMap = new Map<string, { message: string }[]>();
  for (const n of (todayNotifs ?? [])) {
    const curr = notifMap.get(n.user_id) ?? [];
    curr.push({ message: n.message });
    notifMap.set(n.user_id, curr);
  }

  // 6. 사용자별 컨텍스트 수집
  type UserCtx = {
    userId: string;
    email: string;
    userName: string;
    stocks: StockResult[];
    notifications: { message: string }[];
  };

  const userCtxList: UserCtx[] = [];
  for (const userId of activeUserIds) {
    const email = emailMap.get(userId) ?? '';
    if (!email) { console.warn(`[DAILY-EMAIL] 이메일 없음: ${userId}`); continue; }
    const watchItems = userWatchMap.get(userId) ?? [];
    const stocks: StockResult[] = watchItems
      .map((w) => priceMap.get(w.ticker))
      .filter((s): s is StockResult => !!s);
    if (!stocks.length) continue;
    userCtxList.push({
      userId,
      email,
      userName:      email.split('@')[0],
      stocks,
      notifications: notifMap.get(userId) ?? [],
    });
  }

  // 6-1. 유니크 하락 종목(전체 유저 통틀어) 뉴스 배치 조회 — 유저별이 아니라 종목 단위로 한 번만
  const uniqueDeclining = [...priceMap.values()].filter((s) => s.changeRate <= DECLINE_THRESHOLD);
  console.log(`[DAILY-EMAIL] 하락(${DECLINE_THRESHOLD}% 이하) 종목: ${uniqueDeclining.length}개 — 뉴스 조회`);
  const newsMap         = await fetchDeclineNewsMap(uniqueDeclining);
  const commonCauseNews = findCommonCauseNews(uniqueDeclining, newsMap);
  if (commonCauseNews.length) {
    console.log(`[DAILY-EMAIL] 공통 원인 뉴스 ${commonCauseNews.length}건:`,
      commonCauseNews.map((n) => `"${n.title}" → ${n.stocks.join(',')}`));
  }

  // 6-2. 시장 전체(코스피/코스닥/금리/환율/해외증시 등) 뉴스 — 크론 실행당 1회만 조회, 전 유저 공유
  const marketNews = await fetchMarketNews(`${notifDate}T00:00:00+09:00`);
  console.log(`[DAILY-EMAIL] 시장 전체 뉴스 ${marketNews.length}건:`, marketNews.map((n) => n.title));

  // 7. Claude 호출 병렬 실행 (Promise.allSettled)
  const aiResults = await Promise.allSettled(
    userCtxList.map((ctx) => generateAiComment(ctx.userName, ctx.stocks, newsMap, commonCauseNews, marketNews)),
  );

  // 8. 이메일 발송 (순차 — Resend 속도 제한 준수)
  let sent = 0;
  let failed = 0;
  const subject = `[Finance Park] ${mm}월 ${dd}일 관심종목 일일 리포트`;

  for (let i = 0; i < userCtxList.length; i++) {
    const ctx       = userCtxList[i];
    const aiResult  = aiResults[i];
    const aiComment = aiResult.status === 'fulfilled'
      ? aiResult.value
      : '오늘 시장 데이터를 분석 중입니다.';
    const html = buildEmailHtml({
      userName:      ctx.userName,
      dateStr,
      stocks:        ctx.stocks,
      aiComment,
      notifications: ctx.notifications,
      userId:        ctx.userId,
    });

    let status: 'sent' | 'failed' = 'sent';
    try {
      const { error: sendError } = await resend.emails.send({
        from: 'Finance Park <noreply@fpark.com>',
        to: [ctx.email],
        subject,
        html,
      });
      if (sendError) throw new Error(JSON.stringify(sendError));
      sent++;
      console.log(`[DAILY-EMAIL] ✓ 발송: ${ctx.email} (주식 ${ctx.stocks.length}개, 알림 ${ctx.notifications.length}개)`);
    } catch (e) {
      status = 'failed';
      failed++;
      console.error(`[DAILY-EMAIL] 발송 실패 (${ctx.email}):`, e instanceof Error ? e.message : e);
    }

    try {
      await adminClient.from('email_send_logs').insert({
        user_id:            ctx.userId,
        stock_count:        ctx.stocks.length,
        notification_count: ctx.notifications.length,
        ai_comment:         aiComment || null,
        status,
      });
    } catch (e) {
      console.warn('[DAILY-EMAIL] 로그 저장 실패:', e instanceof Error ? e.message : e);
    }
  }

  console.log(`[DAILY-EMAIL] 완료 — 발송: ${sent}, 실패: ${failed}`);
  return NextResponse.json({ ok: true, sent, failed });
}
