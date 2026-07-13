import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, fetchStockPrice, STOCK_NAMES, CURATED_TICKERS_MKT } from '@/lib/kis-api';
import { fetchInvestorTrend, pickRelevantNews } from '@/lib/stock-analysis-data';
import { COMPLIANCE_PRINCIPLE } from '@/lib/ai-compliance';
import { fetchNaverNews } from '@/lib/naver-news';
import { nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, withTemporalRetry } from '@/lib/ai-grounding';
import type { Database } from '@/lib/database.types';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

// 2026-07-13 재설계 — 기존엔 당일 절대금액(100억원)만 봐서 시가총액이 큰 종목(삼성전자·
// SK하이닉스 등)이 "평범한 하루"에도 항상 조건을 통과, 메인페이지가 매일 같은 종목으로
// 고정되는 문제가 있었다(실측: 최근 8거래일 중 삼성전자 2회, 나머지는 매일 다른 종목).
// 절대금액 대신 "최근 20거래일 평균 흐름 대비 오늘이 몇 배인지"로 전환한다(종목 리포트의
// computeTradingValueMultiple과 동일 원칙). 아래 두 기준은 순수 배수만으로 걸러지는
// 노이즈(예: 평소 0.1억→오늘 0.5억 = "5배"지만 사실상 무의미한 금액)를 막는 하한선이다.
const MIN_ABS_TODAY_AUK = 20;       // 오늘 순매수 절대금액이 이 정도는 돼야 "이례적"으로 취급
const MIN_BASELINE_AUK = 5;         // 20일 평균 흐름 자체가 이보다 작으면 배수를 신뢰하지 않음(분모 과소 방지)
const MIN_BASELINE_DAYS = 15;       // 신규상장 등으로 과거 데이터가 부족하면 배수 계산 보류
const UNUSUAL_MULTIPLE_THRESHOLD = 2.5; // 오늘 순매수가 평소 흐름의 이 배수 이상이면 "이례적"

// 일별 순매수(부호 있음) 배열 → 최근 20거래일 평균 "흐름 강도"(절대값 평균) 대비 오늘의 배수.
// 절대값으로 평균을 잡는 이유: 매수/매도가 번갈아 나오는 종목은 부호 있는 값을 그대로
// 평균내면 서로 상쇄돼 분모가 비정상적으로 작아진다 — computeRiskMetrics의 변동성(표준편차)
// 계산과 같은 이유로 "평소 얼마나 크게 움직이는 종목인가"를 절대값 기준으로 잡는다.
function computeFlowMultiple(todayAmount: number, priorAmounts: number[]): { avg: number; multiple: number | null } {
  if (priorAmounts.length < MIN_BASELINE_DAYS) return { avg: 0, multiple: null };
  const avg = priorAmounts.reduce((s, v) => s + Math.abs(v), 0) / priorAmounts.length;
  if (avg < MIN_BASELINE_AUK) return { avg, multiple: null };
  return { avg, multiple: parseFloat((todayAmount / avg).toFixed(2)) };
}

export function getDailyPickSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function kisHeaders(token: string, trId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
  };
}

async function fetchStockDetail(ticker: string, token: string) {
  for (const mktCode of ['J', 'Q']) {
    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
    url.searchParams.set('FID_INPUT_ISCD', ticker);
    try {
      const res = await fetch(url.toString(), {
        headers: kisHeaders(token, 'FHKST01010100'),
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.rt_cd !== '0') continue;
      const o = data.output;
      return {
        currentPrice: Number(o.stck_prpr),
        changeRate: parseFloat(o.prdy_ctrt) || 0,
        week52High: Number(o.w52_hgpr),
        week52Low: Number(o.w52_lwpr),
        marketCap: o.hts_avls ? `${Math.round(Number(o.hts_avls) / 100_000_000)}억` : '-',
        per: parseFloat(o.per) || 0,
        pbr: parseFloat(o.pbr) || 0,
      };
    } catch { continue; }
  }
  return null;
}

// ── 수급 스크리닝 ─────────────────────────────────────────────────────────────

interface FlowCandidate {
  ticker: string;
  name: string;
  foreignNetBuyAuk: number;          // 최근 거래일 외국인 순매수(억원)
  institutionNetBuyAuk: number;      // 최근 거래일 기관 순매수(억원)
  foreignCumulative5dAuk: number;    // 최근 5거래일 누적 외국인 순매수(억원)
  institutionCumulative5dAuk: number;
  foreignConsecutiveDays: number;    // 외국인 연속 순매수 일수
  institutionConsecutiveDays: number;
  foreignMultiple: number | null;      // 오늘 외국인 순매수 / 최근 20거래일 평균 흐름 강도
  institutionMultiple: number | null;  // 오늘 기관 순매수 / 최근 20거래일 평균 흐름 강도
}

function countConsecutivePositive(amounts: number[]): number {
  let count = 0;
  for (const a of amounts) {
    if (a > 0) count++;
    else break;
  }
  return count;
}

function classifyPickReason(c: FlowCandidate): string | null {
  const bigForeign =
    c.foreignMultiple !== null &&
    c.foreignNetBuyAuk >= MIN_ABS_TODAY_AUK &&
    c.foreignMultiple >= UNUSUAL_MULTIPLE_THRESHOLD;
  const bigInstitution =
    c.institutionMultiple !== null &&
    c.institutionNetBuyAuk >= MIN_ABS_TODAY_AUK &&
    c.institutionMultiple >= UNUSUAL_MULTIPLE_THRESHOLD;
  const streak5Foreign     = c.foreignConsecutiveDays >= 5;
  const streak5Institution = c.institutionConsecutiveDays >= 5;

  if ((bigForeign || streak5Foreign) && (bigInstitution || streak5Institution)) return '외국인·기관 동반 자금 유입';
  if (streak5Foreign) return '외국인 5일 연속 자금 유입';
  if (streak5Institution) return '기관 5일 연속 자금 유입';
  if (bigForeign) return '외국인 평소 대비 이례적 자금 유입';
  if (bigInstitution) return '기관 평소 대비 이례적 자금 유입';
  return null;
}

// 후보 유니버스(대형·중형주 약 90종목)를 순회하며 외국인·기관 수급 데이터 조회
// apiErrorCount: KIS 호출 자체가 실패한 종목 수 — "조건 미충족"과 구분하기 위해 별도 집계
async function scanFlowCandidates(): Promise<{ candidates: FlowCandidate[]; apiErrorCount: number; totalCount: number }> {
  const tickers = CURATED_TICKERS_MKT.map(([t]) => t);
  const candidates: FlowCandidate[] = [];
  let apiErrorCount = 0;

  for (let i = 0; i < tickers.length; i += 5) {
    const chunk = tickers.slice(i, i + 5);
    const settled = await Promise.allSettled(
      chunk.map(async (ticker): Promise<{ candidate: FlowCandidate | null; apiError: boolean }> => {
        // days=21 — trend[0]이 오늘(latest와 동일 거래일), trend[1..]이 20일 평균 베이스라인용.
        const { latest, trend, apiError } = await fetchInvestorTrend(ticker, 21);
        if (apiError) return { candidate: null, apiError: true };
        if (!latest || trend.length === 0) return { candidate: null, apiError: false };

        const priorForeign     = trend.slice(1).map((d) => d.foreign);
        const priorInstitution = trend.slice(1).map((d) => d.institution);
        const { multiple: foreignMultiple }     = computeFlowMultiple(latest.foreign.amount, priorForeign);
        const { multiple: institutionMultiple } = computeFlowMultiple(latest.institution.amount, priorInstitution);

        return {
          candidate: {
            ticker,
            name: STOCK_NAMES[ticker] ?? ticker,
            foreignNetBuyAuk:     latest.foreign.amount,
            institutionNetBuyAuk: latest.institution.amount,
            // 누적/연속일수는 "최근 5거래일"이라는 기존 의미를 유지 — trend가 21일로 늘어났어도
            // 이 두 필드는 항상 앞 5개만 사용한다(프롬프트에 "최근 5거래일 누적"으로 노출됨).
            foreignCumulative5dAuk:     trend.slice(0, 5).reduce((s, d) => s + d.foreign, 0),
            institutionCumulative5dAuk: trend.slice(0, 5).reduce((s, d) => s + d.institution, 0),
            foreignConsecutiveDays:     countConsecutivePositive(trend.map((d) => d.foreign)),
            institutionConsecutiveDays: countConsecutivePositive(trend.map((d) => d.institution)),
            foreignMultiple,
            institutionMultiple,
          },
          apiError: false,
        };
      }),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        if (r.value.apiError) apiErrorCount++;
        else if (r.value.candidate) candidates.push(r.value.candidate);
      } else {
        apiErrorCount++;
      }
    }
    if (i + 5 < tickers.length) await new Promise((r) => setTimeout(r, 200));
  }

  return { candidates, apiErrorCount, totalCount: tickers.length };
}

const DAILY_PICK_OUTPUT_INSTRUCTIONS = `## 출력 형식 (JSON만)
{
  "summary": "수급 데이터 관찰 한줄 요약, 구체적 수치 포함 (예: '외국인 5거래일 연속 자금 유입, 누적 320억원 유입이 관찰됨') — 50자 이내, 지시형 표현 금지",
  "analysis": "수급 데이터를 중심으로 한 관찰 서술 (3-4문장). 뉴스는 참고 정보로만 보조적으로 언급",
  "reference_info": ["뉴스·실적 등 참고 정보 1-3개 (보조적 위치, 없으면 빈 배열)"],
  "risks": ["리스크 요인 1-2개"],
  "keywords": ["3~4개 핵심 키워드"]
}

규칙:
- summary·analysis는 수급 수치가 핵심 근거이며, 뉴스·실적은 참고 정보로만 보조적으로 다루세요
- "재도약 기대", "매력도를 높이는 핵심 요인", "권고", "정당화" 같은 결론형·권유형 표현을 쓰지 말고 "~관찰됩니다", "~라는 특징이 있습니다", "~라는 해석도 있습니다" 형태로 작성하세요
- 목표가·저항선·진입전략 관련 내용은 만들지 마세요 (52주 고점 대비 위치는 별도로 표시됩니다)
- summary·analysis·keywords 전부에서 "매수"/"매도"/"순매수"/"순매도" 단어를 쓰지 말고 "자금 유입"/"자금 유출"로 표현하세요 (예: "순매수 572억원" → "자금 유입 572억원", "순유출 상태" → "자금 유출 상태")
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- JSON 키 순서 및 구조 변경 금지`;

async function notifyKisFailure(apiErrorCount: number, totalCount: number, apiErrorRate: number) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Finance Park <noreply@fpark.com>',
      to: ['saepian2@gmail.com'],
      subject: `[fpark] daily-pick KIS API 장애 알림 (실패율 ${Math.round(apiErrorRate * 100)}%)`,
      html: `<p>daily-pick 크론 스크리닝 중 KIS API 호출이 ${apiErrorCount}/${totalCount}건 실패했습니다 (실패율 ${Math.round(apiErrorRate * 100)}%).</p>
             <p>오늘 수급 상위 기업이 선정되지 않았습니다. KIS Open API 서버 상태를 확인해 주세요.</p>`,
    });
  } catch (e) {
    console.error('[DAILY-PICK] KIS 장애 알림 메일 발송 실패:', e);
  }
}

export async function generateAndSavePick(): Promise<{ ticker: string; name: string } | null> {
  const supabase = getDailyPickSupabase();
  const today = new Date().toISOString().split('T')[0];

  // 이미 선정된 종목 있으면 스킵
  const { data: existing, error: existErr } = await supabase
    .from('daily_picks')
    .select('ticker, name')
    .eq('date', today)
    .maybeSingle();
  if (existErr && (existErr.code === 'PGRST205' || existErr.message?.includes('daily_picks'))) {
    console.error('[DAILY-PICK] daily_picks 테이블이 없습니다.');
    throw new Error('daily_picks 테이블 없음');
  }
  if (existing) return existing;

  // 1. 외국인·기관 수급 기준 스크리닝
  console.log('[DAILY-PICK] 수급 스크리닝 시작');
  const { candidates, apiErrorCount, totalCount } = await scanFlowCandidates();
  const apiErrorRate = totalCount > 0 ? apiErrorCount / totalCount : 0;
  console.log(
    `[DAILY-PICK] 스크리닝 완료 — ${candidates.length}/${totalCount}개 종목 조회 ` +
    `(KIS 실패 ${apiErrorCount}건 / 실패율 ${Math.round(apiErrorRate * 100)}%)`,
  );

  const classified = candidates
    .map((c) => ({ ...c, reason: classifyPickReason(c) }))
    .filter((c): c is FlowCandidate & { reason: string } => c.reason !== null);

  console.log(
    `[DAILY-PICK] 조건 충족: ${classified.length}건 — ` +
    classified.map((c) => `${c.name}(${c.reason})`).join(', '),
  );

  // 조건을 충족하는 종목이 없으면 선정하지 않음 (가짜 사유로 억지 선정하지 않음)
  if (classified.length === 0) {
    const KIS_FAILURE_THRESHOLD = 0.8;
    if (apiErrorRate >= KIS_FAILURE_THRESHOLD) {
      console.error(
        `[DAILY-PICK] KIS API 장애로 스크리닝 실패 (실패율 ${Math.round(apiErrorRate * 100)}%, ${apiErrorCount}/${totalCount}건) — 선정 생략`,
      );
      await notifyKisFailure(apiErrorCount, totalCount, apiErrorRate);
    } else {
      console.log('[DAILY-PICK] 오늘 수급 조건 충족 종목 없음 — 선정 생략');
    }
    return null;
  }

  // 우선순위: 동반 자금 유입 > 이례성 배수(절대금액이 아니라 "평소 대비 얼마나 튀는지") 합산.
  // 절대금액으로 정렬하면 시가총액 큰 종목이 항상 이기므로(재설계 이전 문제), 배수 기준으로 바꾼다.
  classified.sort((a, b) => {
    const aBonus = a.reason === '외국인·기관 동반 자금 유입' ? 1000 : 0;
    const bBonus = b.reason === '외국인·기관 동반 자금 유입' ? 1000 : 0;
    const aScore = aBonus + Math.max(a.foreignMultiple ?? 0, 0) + Math.max(a.institutionMultiple ?? 0, 0);
    const bScore = bBonus + Math.max(b.foreignMultiple ?? 0, 0) + Math.max(b.institutionMultiple ?? 0, 0);
    return bScore - aScore;
  });
  const selected = classified[0];
  console.log(`[DAILY-PICK] 선정: ${selected.name}(${selected.ticker}) — ${selected.reason}`);

  const token = await getAccessToken();
  const detail = await fetchStockDetail(selected.ticker, token);
  const priceInfo = await fetchStockPrice(selected.ticker).catch(() => null);
  const currentPrice = priceInfo?.price ?? detail?.currentPrice ?? 0;
  const changeRate   = priceInfo?.changeRate ?? detail?.changeRate ?? 0;

  // 2. 참고용 뉴스 (수급이 핵심, 뉴스는 보조 정보) — DB 캐시(articles) 조회는 유지하되,
  // 중소형주는 DB에 거의 안 걸리므로 Naver 실시간 검색을 보완적으로 병행
  const [{ data: news }, naverResult] = await Promise.all([
    supabase
      .from('articles')
      .select('title, summary, published_at, source')
      .ilike('title', `%${selected.name}%`)
      .order('published_at', { ascending: false })
      .limit(5),
    fetchNaverNews(selected.name),
  ]);

  const newsCandidates = [
    ...(news ?? []).map((n) => ({
      title:   n.title,
      summary: n.summary ?? undefined,
      date:    n.published_at ? new Date(n.published_at).toLocaleDateString('ko-KR') : undefined,
    })),
    ...naverResult.items.map((n) => ({ title: n.title, summary: n.description as string | undefined, date: undefined as string | undefined })),
  ];
  const relevantNews = pickRelevantNews(newsCandidates, selected.name, undefined, 5);

  const newsText = relevantNews.length > 0
    ? relevantNews.map((n, i) =>
        `${i + 1}. ${n.title}${n.summary ? `\n   요약: ${n.summary}` : ''}${n.date ? `\n   날짜: ${n.date}` : ''}`
      ).join('\n\n')
    : '관련 뉴스 없음';

  // 3. Claude로 수급 데이터 관찰 서술 생성 (뉴스는 참고 정보로만 보조 배치)
  const prompt = `아래는 정량적 수급 기준(외국인·기관 자금 유입)으로 스크리닝된 종목입니다. 이 데이터를 관찰된 사실 위주로 정리하고 JSON만 출력하세요.

## 기준 시각
현재 시각: ${nowKstString()}

## 종목 정보
- 종목명: ${selected.name} (${selected.ticker})
- 현재가: ${currentPrice.toLocaleString()}원 (오늘 등락률 ${changeRate}%)
- 선정 사유: ${selected.reason}
- 전일 외국인 자금 유입: ${selected.foreignNetBuyAuk}억원${selected.foreignMultiple !== null ? ` (최근 20거래일 평균 흐름 대비 ${selected.foreignMultiple}배)` : ''} / 최근 5거래일 누적: ${selected.foreignCumulative5dAuk}억원 (연속 ${selected.foreignConsecutiveDays}일 유입)
- 전일 기관 자금 유입: ${selected.institutionNetBuyAuk}억원${selected.institutionMultiple !== null ? ` (최근 20거래일 평균 흐름 대비 ${selected.institutionMultiple}배)` : ''} / 최근 5거래일 누적: ${selected.institutionCumulative5dAuk}억원 (연속 ${selected.institutionConsecutiveDays}일 유입)
- 52주 최고가: ${detail?.week52High?.toLocaleString() ?? '-'}원 / 최저가: ${detail?.week52Low?.toLocaleString() ?? '-'}원
- 시가총액: ${detail?.marketCap ?? '-'} | PER: ${detail?.per ?? '-'}배 | PBR: ${detail?.pbr ?? '-'}배

## 참고 뉴스 (보조 정보, ${buildNewsFreshnessLine(relevantNews)})
${newsText}

위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 형식과 규칙에 따라 정리하세요.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const newsTextForCheck = relevantNews.map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
  let analysisResult: any = {
    summary: `${selected.name} — ${selected.reason} 관찰됨`,
    analysis: '수급 데이터 기반 관찰 정보를 준비 중입니다.',
    reference_info: [],
    risks: ['시장 변동성'],
    keywords: [selected.name],
  };

  try {
    analysisResult = await withTemporalRetry(
      async () => {
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: [
            { type: 'text', text: COMPLIANCE_PRINCIPLE },
            { type: 'text', text: DAILY_PICK_OUTPUT_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: prompt }],
        });
        const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('JSON 파싱 실패: ' + text.slice(0, 100));
        const parsed = JSON.parse(match[0]);
        const reportText = [parsed.summary, parsed.analysis, ...(parsed.reference_info ?? [])].filter(Boolean).join(' ');
        return { parsed, reportText };
      },
      newsTextForCheck,
      '[DAILY-PICK]',
    );
  } catch (e) {
    console.error('[DAILY-PICK] Claude 분석 실패:', e);
  }

  // 4. DB 저장 — 실제 선정 사유(수치)를 그대로 기록
  const { error } = await supabase.from('daily_picks').upsert({
    ticker: selected.ticker,
    name: selected.name,
    date: today,
    analysis: analysisResult.analysis,
    summary: analysisResult.summary,
    catalysts: analysisResult.reference_info ?? [], // 참고 정보 (뉴스/실적 등, 보조적)
    risks: analysisResult.risks,
    keywords: analysisResult.keywords,
    target_price: null, // 목표가 개념 제거
    pick_reason: selected.reason,
    foreign_net_buy_auk: selected.foreignNetBuyAuk,
    institution_net_buy_auk: selected.institutionNetBuyAuk,
    foreign_consecutive_days: selected.foreignConsecutiveDays,
    institution_consecutive_days: selected.institutionConsecutiveDays,
    week52_high: detail?.week52High ?? null,
    week52_low: detail?.week52Low ?? null,
    news_used: news ?? [],
    price_at_pick: currentPrice,
  }, { onConflict: 'date' });

  if (error) {
    console.error('[DAILY-PICK] DB 저장 실패:', error);
    return null;
  }

  console.log(`[DAILY-PICK] 완료: ${selected.name} (${selected.ticker}) — ${selected.reason}`);
  return { ticker: selected.ticker, name: selected.name };
}
