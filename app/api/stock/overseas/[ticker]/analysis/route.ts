import { NextRequest, NextResponse, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import YahooFinanceClass from 'yahoo-finance2';
import { fetchOverseasChart } from '@/lib/yahoo-finance';
import {
  computeSurgeHistory,
  computeTradingValueMultiple,
  computeRiskMetrics,
  buildSurgeHistoryBlock,
  buildTradingValueBlock,
  buildRiskMetricsBlock,
  pickRelevantNews,
  buildNewsBlock,
} from '@/lib/stock-analysis-data';
import { overseasSearchName } from '@/lib/overseas-korean-names';
import { COMPLIANCE_PRINCIPLE, INVESTMENT_DISCLAIMER, signalToSentiment, clampSignal, type Signal } from '@/lib/ai-compliance';
import { fetchNaverNews } from '@/lib/naver-news';
import { nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, withTemporalRetry, kstDateStr, daysBetween } from '@/lib/ai-grounding';
import { checkPlan, resolveStockAnalysisLimit, getUsageCycleStart, isStockAnalysisDaily } from '@/lib/plan';
import type { Database } from '@/lib/database.types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const yf = new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] });

export type ReportType = 'news-driven' | 'data-driven';
export type { Signal };

// 2026-07-13 국내물(app/api/stock/[ticker]/analysis)과 동일한 8원칙으로 재설계.
// 데이터 소스가 KIS→yahoo-finance2로 바뀌는 것 말고는 프롬프트 구조·검증 로직을
// 최대한 그대로 재사용한다 — 국내물에서 이미 검증된 패턴(서버가 리포트유형 결정,
// 정적지표 참고용 격리, 직전 리포트 대비 갭톤, fpark 고유 지표 강제 활용)이다.
export interface OverseasAnalysisResult {
  reportType: ReportType;
  headline: string;
  mainAnalysis: string;
  yesterdayDelta: string;
  riskFactor: string;
  tags: string[];
  signal: Signal; // 내부 로그/집계용 — 화면 비노출
  current_price: number;
  resistance: number; // 52주 고가 — 서버 실측값
  support: number;    // 52주 저가 — 서버 실측값
  tradingValueMultiple: number | null;
  hasRelevantNews: boolean;
  currency: string;
  isCached?: boolean;
  disclaimer: string;
  createdAt: string;
}

interface HistoryRow {
  report_type: ReportType;
  headline: string;
  main_analysis: string;
  yesterday_delta: string | null;
  risk_factor: string | null;
  tags: string[] | null;
  signal: string | null;
  current_price: number | null;
  price_change_pct: number | null;
  reference_metrics: { week52High?: number; week52Low?: number; per?: number; pbr?: number; currency?: string } | null;
  internal_metrics: { tradingValueMultiple?: number | null; mdd?: number; volatility?: number; marketStateAtGeneration?: string } | null;
  disclaimer: string | null;
  created_at: string;
}

function mapRowToResult(row: HistoryRow): Omit<OverseasAnalysisResult, 'isCached'> {
  return {
    reportType: row.report_type,
    headline: row.headline,
    mainAnalysis: row.main_analysis,
    yesterdayDelta: row.yesterday_delta ?? '',
    riskFactor: row.risk_factor ?? '',
    tags: row.tags ?? [],
    signal: clampSignal(row.signal),
    current_price: row.current_price ?? 0,
    resistance: row.reference_metrics?.week52High ?? 0,
    support: row.reference_metrics?.week52Low ?? 0,
    tradingValueMultiple: row.internal_metrics?.tradingValueMultiple ?? null,
    hasRelevantNews: row.report_type === 'news-driven',
    currency: row.reference_metrics?.currency ?? 'USD',
    disclaimer: row.disclaimer ?? INVESTMENT_DISCLAIMER,
    createdAt: row.created_at,
  };
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', JPY: '¥', HKD: 'HK$', CNY: '¥' };
const CURRENCY_UNIT_WORDS: Record<string, string> = { USD: '달러', JPY: '엔', HKD: '홍콩달러', CNY: '위안' };

const COMMON_INSTRUCTIONS = `## 출력 형식 (JSON만)
{
  "reportType": "news-driven" | "data-driven",
  "headline": "오늘 리포트의 핵심을 담은 한 줄 제목 (매일 달라야 함) — 종목명 제외, 40자 이내, 지시형 표현 금지",
  "mainAnalysis": "본문 — news-driven이면 뉴스 해석 중심, data-driven이면 내부지표/이례적 신호 중심. 52주 고가·저가·PER 같은 정적 지표는 여기 쓰지 말 것",
  "yesterdayDelta": "[직전 리포트와의 차이]에 제공된 정보를 아래 [직전 리포트와의 간격] 지시에 따른 표현으로 정리 (구체적 수치 포함)",
  "riskFactor": "오늘 상황에 특정된 리스크 1개 (일반론 금지)",
  "tags": ["3~4개 핵심 키워드 (업종·테마·이슈 위주)"],
  "signal": "순유입 우위" | "중립·관망" | "차익실현 관찰" | "순유출 우위"
}

규칙:
- reportType은 위 [리포트 유형]에 이미 지정된 값을 그대로 옮겨 적으세요 — 직접 판단하지 마세요
- signal은 매매 지시가 아니라 수급·가격 패턴에 대한 관찰 결과이며 화면에는 노출되지 않고 내부 집계에만 쓰입니다 — 상승 모멘텀이 강하면 "순유입 우위", 하락 압력이 강하면 "순유출 우위", 단기 급등 후 차익실현 흐름이 관찰되면 "차익실현 관찰", 그 외에는 "중립·관망"
- 52주 고가/저가, PER 같은 정적 지표는 mainAnalysis·yesterdayDelta·riskFactor 어디에서도 핵심 근거로 쓰지 마세요 — 이 숫자들은 매일 거의 안 바뀌므로 본문에 쓰면 리포트가 매일 똑같아 보입니다
- [직전 리포트와의 차이]에 제공된 정보 중 최소 1개는 yesterdayDelta에서 구체적 수치와 함께 반드시 언급하세요. 정확한 표현 방식(어제 대비 / N일 전 리포트 대비 / 위트 문구 등)은 아래 [직전 리포트와의 간격] 지시를 따르세요
- [내부 계산 지표](급등이력·거래대금배수·MDD·변동성) 중 최소 1개는 mainAnalysis에서 반드시 활용하세요 — 증권사 앱에서 볼 수 없는 고유 계산값입니다. 이 지표를 언급할 때는 이미 당연히 알고 있는 사실인 것처럼 자연스럽게 서술하세요 — 출처를 밝히거나 어디서 가져온 값인지 표시하지 말 것
- "정당화", "권고", "~하는 것이 좋습니다" 같은 결론형·권유형 단어를 쓰지 말고 관찰·해석형 문장을 사용하세요
- 같은 종결 표현을 이 리포트 안에서 2회 이상 쓰지 말고 문장마다 종결을 다양하게 바꾸세요 ("~로 보임", "~때문임", "~로 풀이됨", "~라는 점이 눈에 띔" 등)
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- 본문에서 현재가·52주 고가·52주 저가를 언급할 때는 "종목 데이터"에 제시된 숫자와 통화 표기를 한 글자도 다르지 않게 그대로 쓰세요 — 익숙한 가격대와 다르다는 이유로 자릿수를 줄이거나 늘리지 말 것
- tags에는 "매수"/"매도"/"순매수"/"순매도" 같은 단어를 넣지 말 것
- "fpark", "당사", "본 서비스" 등 자기 서비스를 3인칭처럼 지칭하는 표현을 쓰지 말 것
- "~기준으로", "~에 따르면"처럼 마치 외부 출처를 인용하는 어투로 내부 지표를 서술하지 말 것 (예: "fpark 기준 거래대금은..." 대신 "거래대금은 최근 20거래일 평균의 0.72배에 그쳤다"처럼 사실을 바로 서술)
- JSON 키 순서 및 구조 변경 금지`;

const NEWS_DRIVEN_INSTRUCTIONS = `## [리포트 유형] 뉴스가 있는 날 (news-driven)

오늘은 이 종목과 직접 관련된 뉴스가 있습니다. 아래 [오늘의 관련 뉴스]를 mainAnalysis의 중심 소재로 삼으세요.

작성 순서:
1. 뉴스의 핵심 사실을 1~2문장으로 요약 — "누가/무엇을/왜"가 드러나야 하고, 기사 제목을 그대로 옮기지 말고 재구성
2. 이 뉴스가 오늘 주가/거래대금 움직임과 실제로 연결되는지, 무관하게 따로 노는지 판단하고 이유를 서술 — 데이터가 뒷받침하지 않으면 "뉴스와 가격 움직임이 아직 명확히 연동되지 않고 있다"처럼 솔직하게 쓸 것, "뉴스 때문에 올랐다"고 무조건 단정하지 말 것
3. 이 뉴스가 하루짜리 이슈인지 앞으로 며칠/몇 주 지켜봐야 할 이슈인지 판단해서 언급 (실적 발표는 후속 이슈, 단발성 공시는 하루짜리 등)

금지: 기사 문장을 15단어 이상 그대로 인용하지 말 것(자체 요약·재구성만). 뉴스 요약이 mainAnalysis 절반을 넘지 않게, "왜 중요한지/어떻게 해석해야 하는지"에 더 많은 분량을 쓸 것`;

const DATA_DRIVEN_INSTRUCTIONS = `## [리포트 유형] 뉴스가 없는 날 (data-driven)

오늘은 이 종목과 직접 관련된 (한국어로 검색 가능한) 뉴스가 없습니다. 억지로 mainAnalysis를 길게 채우지 마세요. 뉴스가 없다는 사실 자체를 숨기지 말고 인정하되, 아래에 집중하세요:

1. [내부 계산 지표]에서 오늘 특이한 값(평소 대비 벗어난 값)이 있는지 확인하고, 있다면 그것을 mainAnalysis의 중심으로 삼으세요 (예: 거래대금이 20일 평균 대비 유의미하게 높거나 낮은 경우, 과거 급등/급락 이력과 오늘 상황이 겹치는 경우 등)
2. 특이한 지표가 없다면 "오늘은 뉴스도 없고 지표도 평소 범위 안에 있다"고 짧게 정리하세요. 억지로 리스크 요인이나 관찰 포인트를 지어내지 마세요

이런 날의 mainAnalysis는 뉴스가 있는 날보다 확연히 짧아야 합니다 (목표: 3~5문장 이내). 짧다는 것 자체가 "오늘은 특별한 게 없다"는 정직한 신호입니다.`;

const FIRST_REPORT_TONE = `## [직전 리포트와의 간격] 첫 리포트

이 종목의 첫 리포트로, 비교할 과거 데이터가 없습니다. yesterdayDelta에는 "이 종목의 첫 리포트로 비교할 과거 데이터가 없다"는 사실을 짧게 한 문장으로만 언급하세요. 과장하거나 아쉬워하는 티를 내지 마세요.`;

const ONE_DAY_GAP_TONE = `## [직전 리포트와의 간격] 1일 (어제)

직전 리포트가 어제 것입니다. yesterdayDelta에서 자연스럽게 "어제 대비"라는 표현을 써서 [직전 리포트와의 차이]에 제공된 정보를 구체적 수치와 함께 비교하세요.`;

const FEW_DAYS_GAP_TONE = `## [직전 리포트와의 간격] 2~6일

직전 리포트가 며칠 전 것입니다. yesterdayDelta에서 "어제 대비"가 아니라 "N일 전 리포트 대비"라는 표현을 쓰고(N은 [직전 리포트와의 차이]에 제시된 실제 일수), 그 사이 무엇이 달라졌는지 [직전 리포트와의 차이]의 수치로 비교하세요. 간격이 왜 생겼는지 사과하거나 설명할 필요는 없습니다 — 이 정도는 흔한 일입니다.`;

const LONG_GAP_TONE = `## [직전 리포트와의 간격] 7일 이상

직전 리포트가 오래 전(7일 이상) 것입니다. yesterdayDelta 맨 앞에 "오랜만에 다시 조회된 종목"이라는 사실을 위트 있게 짧게 한 문장으로 짚으세요. 예시 톤(그대로 쓰지 말고 매번 다르게 표현할 것):
- "이 종목은 최근 N일간 조회가 뜸했던 모양이다"
- "N일 만에 다시 관심을 받은 종목이다"
- "한동안 관심 밖이었다가 오늘 다시 소환된 종목"
(N은 [직전 리포트와의 차이]에 제시된 실제 일수로 채우세요)

이 문장은 비꼬거나 종목을 깎아내리는 톤이 아니라 가볍게 던지는 한 줄 유머여야 합니다. 절대로 "망한 종목", "관심 꺼진 종목" 같은 부정적 낙인 표현이나, "지금이 기회", "저평가" 같은 투자 유인성 표현을 쓰지 마세요 — 컴플라이언스 원칙(매수/매도·목표가 관련 금지 규칙)이 이 문장에도 동일하게 적용됩니다. 이 위트 문장 다음에는 곧바로 [직전 리포트와의 차이]의 실제 데이터(가격 변화, 거래대금 변화 등)로 자연스럽게 이어가세요. 위트 문장은 매번 표현을 다르게 써서 반복되지 않게 하세요(고정 문구 금지).`;

// 국내물의 correctPriceMentions(잘 아는 가격대로 AI가 임의 보정하는 현상 방지)를 통화별로
// 일반화 — 심볼/단위어(달러·엔·위안·홍콩달러) 둘 다 매치해 AI가 어느 쪽으로 쓰든 교정한다.
function correctPriceMentions(
  result: Omit<OverseasAnalysisResult, 'isCached'>,
  ticker: string,
): Omit<OverseasAnalysisResult, 'isCached'> {
  const symbol = CURRENCY_SYMBOLS[result.currency] ?? result.currency;
  const unitWord = CURRENCY_UNIT_WORDS[result.currency] ?? result.currency;
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numPattern = `(?:${escapedSymbol}\\s*)?([\\d,]+\\.?\\d*)\\s*(?:${unitWord})?`;

  const checks: { re: RegExp; truth: number; label: string }[] = [
    { re: new RegExp(`현재가\\s*${numPattern}`, 'g'), truth: result.current_price, label: '현재가' },
    { re: new RegExp(`52주\\s*고[가점]\\s*${numPattern}`, 'g'), truth: result.resistance, label: '52주 고가' },
    { re: new RegExp(`52주\\s*저[가점]\\s*${numPattern}`, 'g'), truth: result.support, label: '52주 저가' },
  ];

  const fixText = (text: string): string => {
    let fixed = text;
    for (const { re, truth, label } of checks) {
      if (!(truth > 0)) continue;
      fixed = fixed.replace(re, (match, numStr: string) => {
        const extracted = parseFloat(numStr.replace(/,/g, ''));
        if (!extracted || Math.abs(extracted - truth) / truth <= 0.05) return match;
        console.warn(
          `[OVERSEAS ANALYSIS] ${ticker} ${label} 불일치 교정: "${extracted}" → "${truth}"`,
        );
        return match.replace(numStr, String(truth));
      });
    }
    return fixed;
  };

  return {
    ...result,
    headline: fixText(result.headline),
    mainAnalysis: fixText(result.mainAnalysis),
    yesterdayDelta: fixText(result.yesterdayDelta),
    riskFactor: fixText(result.riskFactor),
  };
}

// 2026-07-13 국내물은 "장마감(15:30 KST 고정) 전 생성 캐시가 마감 후에도 재사용되는" 버그를
// 고정 시각으로 고쳤지만, 해외물은 거래소별 시차·서머타임이 있어 고정 시각을 못 박을 수 없다.
// 대신 Yahoo가 이미 제공하는 marketState(PRE/REGULAR/CLOSED/POST 등)를 그대로 신뢰한다 —
// 생성 시점에 REGULAR였는지 여부와 지금 REGULAR인지 여부가 다르면(정규장이 그 사이 열리거나
// 닫혔으면) 캐시를 무효화한다. 거래소 휴장일도 marketState가 알아서 반영하므로 국내물보다
// 오히려 더 정확하다.
function isMarketSessionStale(generatedState: string | undefined, currentState: string | undefined): boolean {
  if (!generatedState || !currentState) return false;
  return (generatedState === 'REGULAR') !== (currentState === 'REGULAR');
}

function buildYesterdayComparisonBlock(
  prev: HistoryRow & { report_date: string } | null,
  todayChangeRate: number,
  todayMultiple: number | null,
  daysSinceLastReport: number | null,
): string {
  if (!prev || daysSinceLastReport === null) return '첫 리포트라 비교 대상 없음';

  const lines: string[] = [
    `- 직전 리포트와의 간격: ${daysSinceLastReport}일`,
    `- 직전 리포트: ${prev.report_date} (${prev.report_type === 'news-driven' ? '뉴스 있음' : '뉴스 없음'})`,
  ];
  if (prev.price_change_pct !== null) {
    lines.push(`- 등락률: 그날 ${prev.price_change_pct >= 0 ? '+' : ''}${prev.price_change_pct}% → 오늘 ${todayChangeRate >= 0 ? '+' : ''}${todayChangeRate}%`);
  }
  const prevMultiple = prev.internal_metrics?.tradingValueMultiple;
  if (prevMultiple != null || todayMultiple != null) {
    lines.push(`- 거래대금(20일 평균 대비 배수): 그날 ${prevMultiple != null ? `${prevMultiple}배` : '데이터 없음'} → 오늘 ${todayMultiple != null ? `${todayMultiple}배` : '데이터 없음'}`);
  }
  return lines.join('\n');
}

const MARKET_NAMES: Record<string, string> = {
  us: '미국 NASDAQ/NYSE',
  jp: '일본 도쿄증권거래소(TSE)',
  hk: '홍콩 증권거래소(HKEX)',
  cn: '중국 상하이/심천 증권거래소',
};

interface QuoteSnapshot {
  name: string;
  currency: string;
  price: number;
  changeRate: number;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  week52High: number;
  week52Low: number;
  revenue: number | null;
  opMargin: number | null;
  roe: number | null;
  marketState: string | undefined;
}

async function fetchQuote(ticker: string): Promise<QuoteSnapshot | null> {
  try {
    const result = await yf.quoteSummary(ticker, {
      modules: ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics'] as const,
    });
    const p  = result.price;
    const sd = result.summaryDetail;
    const fd = result.financialData;
    const ks = result.defaultKeyStatistics;

    return {
      name:       p?.shortName ?? p?.longName ?? ticker,
      currency:   p?.currency ?? 'USD',
      price:      p?.regularMarketPrice ?? 0,
      changeRate: (p?.regularMarketChangePercent ?? 0) * 100,
      marketCap:  p?.marketCap ?? null,
      pe:         sd?.trailingPE ?? null,
      pb:         (ks?.priceToBook ?? sd?.priceToBook ?? null) as number | null,
      week52High: sd?.fiftyTwoWeekHigh ?? 0,
      week52Low:  sd?.fiftyTwoWeekLow  ?? 0,
      revenue:    fd?.totalRevenue     ?? null,
      opMargin:   fd?.operatingMargins ?? null,
      roe:        fd?.returnOnEquity   ?? null,
      marketState: p?.marketState,
    };
  } catch {
    return null;
  }
}

// 2026-07-20 국내물(app/api/stock/[ticker]/analysis)과 동일한 인증/한도 로직 이식 —
// 이 라우트는 인증도 사용량 제한도 없이 방치돼 있어 비로그인 상태로도 Claude API를
// 무제한 호출할 수 있는 취약점이 있었다. stock_analysis_usage 테이블은 국내/해외
// 구분 컬럼이 없는 단일 테이블(20260714_stock_analysis_usage.sql)이라 종목분석
// 한도는 애초에 국내+해외 합산 공유로 설계돼 있다 — ticker 문자열만 다를 뿐
// user_id+usage_date 기준으로 그대로 합산되므로, 별도 처리 없이 그대로 재사용.
function makeAuthSupabase() {
  const cookieStore = cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.then(s => s.getAll()),
        setAll: (pairs) => cookieStore.then(s => {
          pairs.forEach(({ name, value, options }) => s.set(name, value, options));
        }),
      },
    },
  );
}

async function getMonthlyStockAnalysisCount(
  authedSupabase: ReturnType<typeof makeAuthSupabase>,
  userId: string,
): Promise<number> {
  const { data: userRow } = await authedSupabase
    .from('users')
    .select('subscription_start_date')
    .eq('id', userId)
    .maybeSingle();
  const { cycleStart } = getUsageCycleStart(userRow?.subscription_start_date ?? null, new Date());

  const { count } = await authedSupabase
    .from('stock_analysis_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('usage_date', cycleStart.toISOString().split('T')[0]);
  return count ?? 0;
}

async function getDailyStockAnalysisCount(
  authedSupabase: ReturnType<typeof makeAuthSupabase>,
  userId: string,
  todayStr: string,
): Promise<number> {
  const { count } = await authedSupabase
    .from('stock_analysis_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('usage_date', todayStr);
  return count ?? 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  const market = req.nextUrl.searchParams.get('market') ?? 'us';
  const cacheKey = `overseas_${ticker}`;
  const todayStr = kstDateStr();

  // 0. 인증 — 국내물(359-361행)과 동일 패턴.
  const authedSupabase = makeAuthSupabase();
  const { data: { user } } = await authedSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 0-1. 월간/일간 한도 체크 — 국내물과 동일 패턴. usage_date 테이블은 ticker 문자열만
  // 저장하므로 해외 티커("AAPL" 등)도 그대로 같은 카운터에 합산된다(위 주석 참고).
  const { data: existingUsage } = await authedSupabase
    .from('stock_analysis_usage')
    .select('id')
    .eq('user_id', user.id)
    .eq('ticker', ticker)
    .eq('usage_date', todayStr)
    .maybeSingle();

  if (!existingUsage) {
    const plan  = await checkPlan(authedSupabase, user.id, user.email);
    const limit = resolveStockAnalysisLimit(plan);
    const count = isStockAnalysisDaily(plan)
      ? await getDailyStockAnalysisCount(authedSupabase, user.id, todayStr)
      : await getMonthlyStockAnalysisCount(authedSupabase, user.id);
    if (count >= limit) {
      const message = isStockAnalysisDaily(plan)
        ? '오늘 무료 이용 횟수를 모두 사용했습니다. 베이직/프로로 업그레이드하면 월 단위로 더 많이 이용하실 수 있습니다.'
        : '이번 달 이용 한도를 모두 사용했습니다. 다음 결제일에 초기화됩니다.';
      return NextResponse.json({ error: message }, { status: 429 });
    }
  }

  // 이번 조회를 이용 기록으로 남긴다 — 캐시 히트/신규 생성 응답 모두에서 호출(아래).
  const recordUsage = () => {
    after(async () => {
      const { error } = await authedSupabase
        .from('stock_analysis_usage')
        .upsert(
          { user_id: user.id, ticker, usage_date: todayStr },
          { onConflict: 'user_id,ticker,usage_date', ignoreDuplicates: true },
        );
      if (error) console.error('[OVERSEAS ANALYSIS] 이용 기록 저장 실패:', error.message);
    });
  };

  // 1. 시세 조회 — 캐시 유효성 판단(marketState)에도 필요하고, 캐시 미스 시 프롬프트
  // 데이터로도 그대로 쓰이므로 항상 먼저 가져온다. Claude 호출(느림)과 달리 가벼운 호출이라
  // 캐시 히트 케이스에서도 이 정도 비용은 감수한다.
  let quote: QuoteSnapshot | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    quote = await fetchQuote(ticker);
    if (quote) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  if (!quote) {
    return NextResponse.json({ error: '종목 정보 조회 실패' }, { status: 502 });
  }

  // 2. 당일 캐시 확인
  try {
    const { data: cached } = await supabase
      .from('stock_analysis_history')
      .select('*')
      .eq('ticker', cacheKey)
      .eq('report_date', todayStr)
      .maybeSingle();
    if (cached) {
      const row = cached as HistoryRow;
      const genState = row.internal_metrics?.marketStateAtGeneration;
      if (isMarketSessionStale(genState, quote.marketState)) {
        console.log(`[OVERSEAS ANALYSIS] ${ticker} 정규장 상태 변화 감지(${genState} → ${quote.marketState}) — 캐시 무시하고 재생성`);
      } else {
        recordUsage();
        return NextResponse.json({ ...mapRowToResult(row), isCached: true });
      }
    }
  } catch (e) {
    console.warn('[OVERSEAS ANALYSIS] 당일 캐시 조회 실패, 새로 생성:', e instanceof Error ? e.message : e);
  }

  const { price, currency, week52High: hi52, week52Low: lo52 } = quote;

  // 3. 관련 뉴스 — 해외종목은 한글 뉴스 소스(Naver)에서 종목명 그대로("NVDA") 검색하면
  // 적중률이 낮아 한글명 매핑(lib/overseas-korean-names)을 우선 쓰고, 매핑에 없는 티커는
  // 영문 종목명으로 폴백한다. DB(articles)도 국내 매체의 해외종목 보도를 보완적으로 조회.
  const searchName = overseasSearchName(ticker, quote.name);
  const [{ data: dbNews }, ...naverResults] = await Promise.all([
    supabase
      .from('articles')
      .select('title, summary, published_at')
      .ilike('title', `%${searchName}%`)
      .not('summary', 'is', null)
      .order('published_at', { ascending: false })
      .limit(5),
    fetchNaverNews(searchName, { sort: 'date' }),
    fetchNaverNews(`${searchName} 실적`, { sort: 'date' }),
    fetchNaverNews(`${searchName} 주가`, { sort: 'date' }),
  ]);

  const seenNaverTitle = new Set<string>();
  const naverItems = naverResults.flatMap((r) => r.items).filter((item) => {
    if (seenNaverTitle.has(item.title)) return false;
    seenNaverTitle.add(item.title);
    return true;
  });

  const newsCandidates = [
    ...(dbNews ?? []).map((n) => ({
      title:   n.title,
      summary: n.summary ?? undefined,
      date:    n.published_at ? new Date(n.published_at).toLocaleDateString('ko-KR') : undefined,
    })),
    ...naverItems.map((n) => ({ title: n.title, summary: n.description })),
  ];
  const relevantNews = pickRelevantNews(newsCandidates, searchName, undefined, 3);
  const newsBlock = buildNewsBlock(relevantNews);
  const reportType: ReportType = relevantNews.length > 0 ? 'news-driven' : 'data-driven';

  // 3-1. 일별 차트(최근 약 1년) — 급등이력/거래대금배수/MDD·변동성 계산용
  let chart: Awaited<ReturnType<typeof fetchOverseasChart>> = [];
  try {
    chart = await fetchOverseasChart(ticker);
  } catch (e) {
    console.warn('[OVERSEAS ANALYSIS] 차트 조회 실패, 급등이력/거래대금배수/리스크지표 생략:', e instanceof Error ? e.message : e);
  }

  const surgeHistory         = chart.length ? computeSurgeHistory(chart) : null;
  const tradingValueMultiple = chart.length ? computeTradingValueMultiple(chart) : null;
  const riskMetrics          = chart.length ? computeRiskMetrics(chart.map((d) => d.close)) : null;
  const surgeHistoryBlock    = buildSurgeHistoryBlock(surgeHistory);
  const tradingValueBlock    = buildTradingValueBlock(tradingValueMultiple);
  const riskMetricsBlock     = buildRiskMetricsBlock(riskMetrics);

  // 3-2. 직전 리포트(오늘 이전 가장 최근 1건) 조회
  let prevRow: (HistoryRow & { report_date: string }) | null = null;
  try {
    const { data } = await supabase
      .from('stock_analysis_history')
      .select('*')
      .eq('ticker', cacheKey)
      .lt('report_date', todayStr)
      .order('report_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    prevRow = data as (HistoryRow & { report_date: string }) | null;
  } catch (e) {
    console.warn('[OVERSEAS ANALYSIS] 직전 리포트 조회 실패, 비교 없이 진행:', e instanceof Error ? e.message : e);
  }
  const daysSinceLastReport = prevRow ? daysBetween(todayStr, prevRow.report_date) : null;
  const yesterdayComparisonBlock = buildYesterdayComparisonBlock(
    prevRow,
    quote.changeRate,
    tradingValueMultiple?.valid ? tradingValueMultiple.multiple : null,
    daysSinceLastReport,
  );
  const gapTone =
    daysSinceLastReport === null ? FIRST_REPORT_TONE :
    daysSinceLastReport === 1 ? ONE_DAY_GAP_TONE :
    daysSinceLastReport <= 6 ? FEW_DAYS_GAP_TONE :
    LONG_GAP_TONE;

  // 4. Claude 분석
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const fmtPrice = (n: number) => `${symbol}${n.toLocaleString('en-US', { minimumFractionDigits: currency === 'JPY' ? 0 : 2, maximumFractionDigits: currency === 'JPY' ? 0 : 2 })}`;
  const fmtAmount = (n: number | null): string => {
    if (n == null) return 'N/A';
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T ${currency}`;
    if (Math.abs(n) >= 1e9)  return `${(n / 1e9).toFixed(2)}B ${currency}`;
    return `${(n / 1e6).toFixed(2)}M ${currency}`;
  };
  const w52pos = hi52 > lo52 ? Math.round(((price - lo52) / (hi52 - lo52)) * 100) : null;

  const prompt = `아래 종목 데이터를 관찰된 사실 위주로 정리하고 반드시 JSON만 출력하세요. JSON 외 텍스트는 절대 포함하지 마세요.

## 기준 시각
현재 시각: ${nowKstString()}

## [리포트 유형]
${reportType} — 이 값을 그대로 reportType 필드에 옮겨 적으세요.

## 종목 데이터
※ 현재가·52주 고저가는 서버가 직접 실측한 값입니다. 본인이 알고 있는 시세감이나 관례적인 가격대와 다르더라도
임의로 보정하거나 축소·확대해서 쓰지 말고, 아래 숫자(통화 표기 포함)를 본문에서도 그대로 인용하세요.
- 종목명: ${quote.name} (${ticker})
- 시장: ${MARKET_NAMES[market] ?? market}
- 현재가: ${fmtPrice(price)} (등락률 ${quote.changeRate >= 0 ? '+' : ''}${quote.changeRate.toFixed(2)}%)
- 52주 고가: ${fmtPrice(hi52)} / 저가: ${fmtPrice(lo52)}${w52pos !== null ? ` (현재가 52주 레인지의 ${w52pos}% 위치)` : ''}
- 시가총액: ${fmtAmount(quote.marketCap)} / PER: ${quote.pe ? quote.pe.toFixed(1) + 'x' : 'N/A'} / PBR: ${quote.pb ? quote.pb.toFixed(2) + 'x' : 'N/A'}
- 매출액: ${fmtAmount(quote.revenue)} / 영업이익률: ${quote.opMargin ? (quote.opMargin * 100).toFixed(1) + '%' : 'N/A'} / ROE: ${quote.roe ? (quote.roe * 100).toFixed(1) + '%' : 'N/A'}

## 오늘의 관련 뉴스 (${buildNewsFreshnessLine(relevantNews)})
${newsBlock}

## 직전 리포트와의 차이
${yesterdayComparisonBlock}

## 내부 계산 지표 (서버 계산값 — 증권사 앱에는 없는 고유 지표)
- 과거 유사 급등/급락 이력(최근 약 1년): ${surgeHistoryBlock}
- 거래대금: ${tradingValueBlock}
- 리스크 지표: ${riskMetricsBlock}

위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 형식과 규칙에 따라 정리하세요.`;

  const newsText = relevantNews.map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');

  try {
    type ParsedAnalysis = Omit<
      OverseasAnalysisResult,
      'current_price' | 'resistance' | 'support' | 'tradingValueMultiple' | 'hasRelevantNews' | 'currency' | 'disclaimer' | 'createdAt' | 'isCached'
    >;

    const analysis = await withTemporalRetry<ParsedAnalysis>(
      async () => {
        const message = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: [
            { type: 'text', text: COMPLIANCE_PRINCIPLE },
            { type: 'text', text: COMMON_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
            {
              type: 'text',
              text: reportType === 'news-driven' ? NEWS_DRIVEN_INSTRUCTIONS : DATA_DRIVEN_INSTRUCTIONS,
              cache_control: { type: 'ephemeral' },
            },
            { type: 'text', text: gapTone, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: prompt }],
        });
        const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + text.slice(0, 100));
        const parsed = JSON.parse(jsonMatch[0]) as ParsedAnalysis;
        const reportText = [parsed.headline, parsed.mainAnalysis, parsed.yesterdayDelta, parsed.riskFactor].join(' ');
        return { parsed, reportText };
      },
      newsText,
      '[OVERSEAS ANALYSIS]',
    );

    let result: Omit<OverseasAnalysisResult, 'isCached'> = {
      ...analysis,
      reportType,
      signal: clampSignal(analysis.signal),
      current_price: price,
      resistance: hi52,
      support: lo52,
      tradingValueMultiple: tradingValueMultiple?.valid ? tradingValueMultiple.multiple : null,
      hasRelevantNews: relevantNews.length > 0,
      currency,
      disclaimer: INVESTMENT_DISCLAIMER,
      createdAt: new Date().toISOString(),
    };

    result = correctPriceMentions(result, ticker);

    // 5. 히스토리 저장 — 하루 1건(ticker, report_date unique). 정규장 상태 변화로 재생성될 때도
    // 같은 (ticker, report_date)라 upsert로 덮어쓴다. 비동기 저장(after())은 국내물과 동일 이유.
    after(async () => {
      const { error } = await supabase
        .from('stock_analysis_history')
        .upsert({
          ticker: cacheKey,
          report_date: todayStr,
          report_type: result.reportType,
          headline: result.headline,
          main_analysis: result.mainAnalysis,
          yesterday_delta: result.yesterdayDelta,
          risk_factor: result.riskFactor,
          tags: result.tags,
          current_price: result.current_price,
          price_change_pct: quote.changeRate,
          reference_metrics: { week52High: hi52, week52Low: lo52, per: quote.pe, pbr: quote.pb, currency },
          internal_metrics: {
            tradingValueMultiple: result.tradingValueMultiple,
            mdd: riskMetrics?.mdd ?? null,
            volatility: riskMetrics?.volatility ?? null,
            marketStateAtGeneration: quote.marketState ?? null,
          },
          signal: result.signal,
          sentiment: signalToSentiment(result.signal),
          disclaimer: result.disclaimer,
          created_at: result.createdAt,
        }, { onConflict: 'ticker,report_date' });
      if (error) console.error('[OVERSEAS ANALYSIS] 결과 저장 실패:', error.message);
    });
    recordUsage();

    return NextResponse.json(result);
  } catch (e) {
    console.error('[OVERSEAS ANALYSIS] Claude 오류:', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
