import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { deductCredit } from '@/lib/credits';
import { checkPlan, resolvePortfolioLimit } from '@/lib/plan';
import {
  collectStockAnalysisData,
  buildTechnicalBlock,
  buildInvestorBlock,
  pickRelevantNews,
  computeRiskMetrics,
  computeSurgeHistory,
  buildSurgeHistoryBlock,
  computeTradingValueMultiple,
  buildTradingValueBlock,
} from '@/lib/stock-analysis-data';
import type { StockAnalysisData } from '@/lib/stock-analysis-data';
import { fetchDailyChart, fetchIndexRangeChange } from '@/lib/kis-api';
import { fetchNaverNews } from '@/lib/naver-news';
import { COMPLIANCE_PRINCIPLE, clampSignal, type Signal } from '@/lib/ai-compliance';
import {
  nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, checkTemporalConsistency,
  kstDateStr, daysBetween,
} from '@/lib/ai-grounding';
import type { Database } from '@/lib/database.types';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const claude        = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MAX_HOLDINGS        = 10;

// 종목별 개별 분석(Stage 1) 고정 지침 — 종목마다 반복 호출되므로 프롬프트 캐싱 대상.
// 실제 ticker 값은 종목마다 다르므로 예시 스키마에서는 플레이스홀더만 사용한다.
// 2026-07-13 3차 고도화: reason이 "PER·거래대금·뉴스 제목 나열"에 그쳐 같은 날 만든
// 기업분석("오늘의 기업 분석")보다 얕다는 지적 — 뉴스가 있으면 배경("왜")까지 반드시
// 해석하도록 강화하고, 거래대금은 뉴스와 경합시키지 않고 여유 있을 때만 붙이도록
// 우선순위를 재조정했다(지난 라운드에서 거래대금을 "최상 우선"으로 지시한 게 2문장
// 예산 안에서 뉴스 해석을 밀어낸 것으로 확인됨).
const STOCK_SIGNAL_SYSTEM = `${COMPLIANCE_PRINCIPLE} 한국주식 데이터를 뉴스·수급·밸류에이션 관점에서 종합 해석하는 애널리스트입니다. 뉴스가 있으면 그 배경("왜 이런 뉴스가 나왔는지")까지 파고들어 설명하고, 없으면 수급·기술적 요인으로만 설명하며 뉴스를 지어내지 마세요. 사실 나열이 아니라 해석을 담으세요. JSON만 출력. reason 작성 시 종목명 사용, 숫자 종목코드 출력 금지.`;

const STOCK_SIGNAL_INSTRUCTIONS = `다음 한국 주식의 관찰된 데이터를 분석하고 JSON만 출력하세요.

{"ticker":"<종목코드>","signal":"순유입 우위"|"중립·관망"|"차익실현 관찰"|"순유출 우위","reason":"2~3문장, 관찰된 사실과 그 배경 해석","sector":"실제업종명"}

signal은 매매 지시가 아니라 현재 수급·가격 패턴에 대한 관찰 결과입니다 — 외국인·기관의 순매수 자금 유입이 우위면 "순유입 우위", 순매도로 자금이 빠져나가는 흐름이 우위면 "순유출 우위", 수익률이 높고 밸류에이션 부담이 겹쳐 차익실현 패턴이 관찰되면 "차익실현 관찰", 그 외에는 "중립·관망"을 선택하세요. 뉴스 기사 제목에 "목표가"라는 단어가 있어도 reason에서는 그 단어를 그대로 쓰지 말고 "영업이익 추정치 상향" 같은 실적 전망치 표현으로만 언급하세요.
- 관련 뉴스가 주어지면(최우선) 제목만 스치듯 언급하지 말고 "누가/무엇을/왜"가 드러나게 재구성하고, 그 뉴스가 오늘 주가·수급과 실제로 연결되는지까지 한 문장 이상 써서 해석하세요. 예) '외국인이 3거래일 연속 순매도한 것은 최근 발표된 2분기 실적 컨센서스 하향 조정 때문으로 풀이되며, 이는 실적 자체보다 장기공급계약 구조 변화에 따른 일시적 조정에 가깝습니다.'
- "참고 - 거래대금"이 주어지면 여유가 될 때 reason에 반영하세요 — 다만 뉴스 해석을 밀어내면서까지 우선하지는 마세요. 뉴스가 없는 종목에서는 거래대금·급등이력이 핵심 근거가 됩니다.
- "참고 - 과거 유사 급등락 이력"이 오늘 상황과 관련 있다고 판단되면 "이전에도 비슷한 급락이 있었고 그때는 ~했다" 식으로 비교 판단을 녹이세요.
아래에 주어지는 실제 종목 데이터를 분석 대상으로 삼아, 응답의 "ticker" 필드에는 위 플레이스홀더 대신 그 종목의 실제 코드를 채워 넣으세요. ${TEMPORAL_GROUNDING_INSTRUCTION}`;

// 포트폴리오 종합 분석(Stage 2) 고정 지침 — 요청마다 1회만 호출되지만 다른 요청 간에도 재사용 가능.
// 2026-07-13 재설계: opportunityFactors("참고 데이터 포인트")가 suggestions("참고할 만한
// 관찰 포인트")와 거의 같은 내용을 반복해서 필드 자체를 제거. historyNarrative(직전 진단
// 대비)·contributionNarrative(오늘 손익 기여도)를 신설 — 지난 라운드(기업분석)에서 배운 대로
// summary에 욱여넣지 않고 별도 필드로 분리해서 각자 스캔 가능한 카드로 렌더링한다.
// 2026-07-13 3차 고도화: "AI 종합 평가"가 같은 날 만든 기업분석("오늘의 기업 분석")보다
// 명백히 얕다는 지적 — PER·거래대금·뉴스 제목 나열 수준에서, 뉴스 배경 해석 +
// 시계열(급등이력) 비교 + 판단형 문장을 포함하는 수준으로 끌어올린다.
const PORTFOLIO_SUMMARY_SYSTEM = `${COMPLIANCE_PRINCIPLE} 한국주식 포트폴리오를 섹터·수급·뉴스 관점에서 종합 해석하는 애널리스트입니다. 이 리포트는 fpark의 핵심 유료 콘텐츠입니다 — 사실을 나열하는 데 그치지 말고, 왜 그런 결과가 나왔는지에 대한 판단과 해석을 반드시 포함하세요. 같은 날 만들어지는 개별 기업분석 리포트와 동등하거나 더 깊은 수준이어야 합니다. 숫자(PER·수급 등) 근거와 실제 뉴스 이슈의 배경까지 함께 담아 설명하되, 무엇을 하라고 지시하지 마세요. JSON만 출력. 종목 언급 시 반드시 종목명 사용, 종목코드(숫자 6자리) 출력 금지.`;

// suggestions("참고할 만한 관찰 포인트")는 Risk Factors·기업별 관찰 지표와 실측 결과
// 거의 100% 재진술이라 필드 자체를 제거(통합이 아니라 삭제). historyNarrative(직전 진단
// 대비)·contributionNarrative(오늘 손익 기여도)·holdingPeriodNarrative(3-1)·구조적
// shortTermOutlook/midTermOutlook(3-2)·coMovementNarrative(섹터 동조화 해석) 신설.
const PORTFOLIO_SUMMARY_INSTRUCTIONS = `{"summary":"5-7문장 종합 설명 — 기업분석 리포트와 동등한 밀도로 작성. [1] 전체 수익률의 구조적 배경(섹터 편중·수급 현황) [2] 뉴스가 있는 종목은 그 뉴스가 '왜' 나왔는지, 시장이 왜 그렇게 반응했는지(또는 반응하지 않았는지)까지 배경 해석 — 제목만 스치듯 언급 금지, 최소 1개 종목은 깊이 있게(예: 컨센서스 조정 근거, 계약 구조 변화 등 구체적 배경) [3] [포트폴리오 내 과거 유사 급등락 이력]에 데이터가 있으면 활용해 '이번 흐름이 과거와 비슷한지 다른지' 판단 문장 포함 [4] 판단형 문장 최소 1개 포함(예: '이번 하락은 개별 종목 이슈보다 업종 전체 심리 위축에 가깝다', '이 흐름이 지속 가능한지는 다음 실적에서 확인될 필요가 있다') — 미래 수익률이나 가격을 예측하는 것이 아니라 현재 상황의 성격을 판단하는 문장이어야 함 — 총수익률·평가손익 숫자(예: '-19.44%', '+123만원')를 문장에 직접 쓰지 마세요, 이미 상단 카드에 표시됩니다. 벤치마크·직전 진단 대비·손익 기여도 수치도 마찬가지로 언급 금지(각각 별도 필드가 있음)","sectors":[{"name":"섹터명","tickers":["코드"],"weight":정수,"warning":boolean}],"riskFactors":["포트폴리오 전체 관점의 리스크 요인1(수치 포함, 손실 종목 비중·섹터 과집중·벤치마크 대비 부진·개별 종목 변동성 등 근거)","요인2","요인3"],"opportunityFactors":["포트폴리오 전체 관점에서 관찰 가능한 긍정적 데이터 포인트 1~3개(수치·근거 포함, riskFactors와 동일 형식) — 이미 본문(종목별 문단·summary)에 나온 개별 사실을 그대로 복사하지 말고, 포트폴리오 관점에서 종합해 새롭게 서술. 예) 'DL이앤씨와 종근당 모두 외국인·기관의 저점 매수 성격 자금 유입이 관찰되는데, 이는 반도체 업황 심리 위축과 달리 개별 밸류에이션 매력에 반응하는 흐름으로 풀이됩니다.' 뚜렷한 긍정 신호가 없으면 억지로 지어내지 말고 [\"현재 뚜렷한 긍정 신호가 부족합니다\"] 하나만 반환하거나 1~2개로 줄여도 됨"],"historyNarrative":"【1~2문장, 아래 [직전 진단과의 간격] 지시를 그대로 따를 것】구체적 수치는 화면에 별도로 표시되므로 여기서는 그 변화가 어떤 의미인지 해석 위주로. 보유 종목 구성이 바뀌었으면([직전 진단과의 차이]에 명시됨) 반드시 그 사실을 언급할 것","contributionNarrative":"【[오늘 손익 기여도]에 제공된 상위 기여 종목을 근거로 1~2문장 — 구체적 금액은 화면에 이미 별도로 표시되므로 여기서는 숫자를 반복하지 말고(금액을 다시 옮겨 적지 말 것) 어떤 종목이 왜 기여했는지 의미 위주로만 서술】예) '오늘 포트폴리오 평가손익 변화는 대부분 종근당 하락에서 발생했습니다.' 매수/매도 권유가 아니라 순수 관찰 서술, 데이터가 없으면 빈 문자열","holdingPeriodNarrative":"【[보유 기간 비교]에 데이터가 있을 때만 1문장 — 없으면 빈 문자열】구체적 수익률 수치는 화면에 별도 표시되므로 여기서는 편입 시점에 따라 성과가 왜 갈렸는지(업황 변화, 매수 시점의 가격 수준 등) 해석 위주로. 매수 타이밍을 지시하거나 '그래서 지금 사야 한다'는 식으로 연결 금지","coMovementNarrative":"【[섹터 동조화 관찰 데이터]에 사례가 있을 때만 1~2문장 — 없으면 빈 문자열】단순히 '같은 방향으로 움직였다'는 사실 재진술에 그치지 말고, 왜 그런 동조화가 생겼는지(개별 재료보다 업종 심리가 더 강하게 작용했는지 등)와 포트폴리오 분산 효과 관점에서 어떤 함의가 있는지까지 서술. 예) '개별 종목 재료가 서로 다름에도 같은 방향으로 움직였다는 것은 업종 전체 심리가 더 강하게 작용했다는 뜻이며, 분산 투자 효과가 기대만큼 작동하지 않고 있음을 시사합니다.'","shortTermOutlook":"포트폴리오 '구조' 관점의 단기 관찰 변수 — 종목을 하나씩 나열하지 말고, 섹터 비중이 가장 큰 구조(예: 특정 섹터가 N% 차지)로 인해 포트폴리오 전체가 어떤 단기 이벤트에 노출돼 있는지 종합해서 서술. 예) '반도체 섹터가 60%를 차지하는 구조상, 다음 주 메모리 가격·실적 발표 결과가 포트폴리오 전체 방향에 영향을 줄 가능성이 있습니다.' '수익률이 갈릴 수 있다'/'상승·하락 여력' 같이 가격을 예측하는 표현 절대 금지, 2문장","midTermOutlook":"포트폴리오 '구조' 관점의 중기 관찰 변수 — 마찬가지로 종목 나열이 아니라 섹터 편중·구성 특성에서 비롯되는 중기 취약점/기회를 종합. 특정 수익률이나 방향을 예측하지 않음, 가격 방향 예측 절대 금지, 2문장"}

규칙:
- sectors weight 합계=100
- riskFactors는 개별 종목이 아니라 포트폴리오 전체 구조(손실 비중·섹터 편중·벤치마크 대비·변동성)를 보는 관점으로 작성하세요
- opportunityFactors는 riskFactors와 동일한 컴플라이언스 원칙이 적용됩니다 — "매수 신호"·"지금이 기회"처럼 투자를 유인하는 표현이 아니라 어디까지나 "관찰 가능한 긍정적 데이터 포인트" 수준으로 서술하세요. 목표가·매수 추천·"상승 여력" 같은 표현 절대 금지
- shortTermOutlook/midTermOutlook은 반드시 "이 포트폴리오 구조가~" 식으로 시작하는 상위 종합 문장이어야 하며, "삼성전자는 ~, SK하이닉스는 ~" 식으로 종목을 순서대로 나열하는 문장은 금지입니다. 목표가·손절가·매수매도 지시·저항선·지지선·가격 방향 예측 금지 — 관찰된 사실만 서술하고 그 사실이 앞으로 수익률에 어떤 영향을 줄지 예측하지 마세요
- 뉴스가 있는 종목은 그 이슈를 근거로 언급하고, 뉴스가 없는 종목은 수급·기술적 요인으로만 설명하며 뉴스를 지어내지 마세요. "관련 뉴스 없음"이라는 이유만으로 그 종목을 summary에서 아예 빼지 마세요 — 뉴스가 없다는 사실 자체도 관찰(예: '특별한 뉴스 없이 수급 요인으로 움직였다')로 서술할 수 있습니다
- 벤치마크 수치는 별도 카드로 이미 표시되므로 summary·historyNarrative 등 어디에서도 다시 언급하지 마세요
- summary·riskFactors·historyNarrative·contributionNarrative·holdingPeriodNarrative·coMovementNarrative·shortTermOutlook·midTermOutlook 서로 같은 사실을 반복 서술하지 마세요 — 각 필드는 서로 다른 내용을 담아야 합니다
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- summary·riskFactors·historyNarrative·contributionNarrative·holdingPeriodNarrative·outlook에서 종목을 언급할 때는 반드시 종목명을 사용하고 종목코드(숫자 6자리)는 절대 출력하지 마세요`;

// 2026-07-13 "직전 진단과의 간격"에 따라 어조를 분기 — 기업분석과 동일한 이유(진단 빈도가
// 사용자마다 다름). 포트폴리오는 보유 종목 구성 변화 자체가 관찰 대상이 될 수 있어(기업분석의
// "매입가 달라지면 비교 생략"과 달리) 모든 톤에서 구성 변화 언급을 요구한다.
const PORTFOLIO_FIRST_TONE = `## [직전 진단과의 간격] 첫 포트폴리오 진단

이 포트폴리오의 첫 진단으로, 비교할 과거 데이터가 없습니다. historyNarrative에는 "첫 포트폴리오 진단으로 비교할 과거 데이터가 없다"는 사실을 짧게 한 문장으로만 언급하세요.`;

const PORTFOLIO_ONE_DAY_TONE = `## [직전 진단과의 간격] 1일 (어제)

직전 진단이 어제 것입니다. historyNarrative에서 "어제 대비"라는 표현을 써서 [직전 진단과의 차이]에 제공된 총수익률 변화를 해석하세요. 보유 종목 구성이 바뀌었으면([직전 진단과의 차이]에 명시됨) 그 사실(추가/제거된 종목)을 반드시 먼저 언급하세요.`;

const PORTFOLIO_FEW_DAYS_TONE = `## [직전 진단과의 간격] 2~6일

직전 진단이 며칠 전 것입니다. historyNarrative에서 "어제 대비"가 아니라 "N일 전 진단 대비"라는 표현을 쓰고(N은 [직전 진단과의 차이]에 제시된 실제 일수), 그 사이 무엇이 달라졌는지 해석하세요. 보유 종목 구성이 바뀌었으면 그 사실을 반드시 먼저 언급하세요. 간격이 왜 생겼는지 사과할 필요는 없습니다.`;

const PORTFOLIO_LONG_GAP_TONE = `## [직전 진단과의 간격] 7일 이상

직전 진단이 오래 전(7일 이상) 것입니다. historyNarrative 맨 앞에 "오랜만에 다시 진단받은 포트폴리오"라는 사실을 위트 있게 짧게 한 문장으로 짚으세요(매번 표현을 다르게, 고정 문구 금지). 비꼬거나 깎아내리는 톤 금지, "지금이 기회"·"저평가" 같은 투자 유인성 표현 금지 — 컴플라이언스 원칙이 이 문장에도 동일 적용됩니다. 위트 문장 다음에는 보유 종목 구성 변화(있으면 반드시)와 총수익률 변화로 자연스럽게 이어가세요.`;

// ── Supabase ────────────────────────────────────────────────────────────────

function makeSupabase() {
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

// subscription_start_date 기준 현재 사이클 시작일 계산 (null이면 매월 1일 폴백)
function getBillingCycleStart(subscriptionStartDate: string | null, now: Date): Date {
  if (!subscriptionStartDate) {
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }
  const startDay = new Date(subscriptionStartDate).getDate();
  const y = now.getFullYear();
  const m = now.getMonth();
  // 말일 클램핑 (e.g., 1월 31일 → 2월 28일)
  const lastDay = (yr: number, mo: number) => new Date(yr, mo + 1, 0).getDate();
  const thisMonthStart = new Date(y, m, Math.min(startDay, lastDay(y, m)), 0, 0, 0, 0);
  if (thisMonthStart <= now) return thisMonthStart;
  return new Date(y, m - 1, Math.min(startDay, lastDay(y, m - 1)), 0, 0, 0, 0);
}

async function getMonthlyCount(
  supabase: ReturnType<typeof makeSupabase>,
  userId: string,
): Promise<number> {
  try {
    // subscription_start_date 조회 후 사이클 시작일 계산
    const { data: userRow } = await supabase
      .from('users')
      .select('subscription_start_date')
      .eq('id', userId)
      .maybeSingle();

    const cycleStart = getBillingCycleStart(
      userRow?.subscription_start_date ?? null,
      new Date(),
    );

    const { count } = await supabase
      .from('portfolio_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', cycleStart.toISOString());
    return count ?? 0;
  } catch { return 0; }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface HoldingInput {
  ticker: string; name: string;
  avgPrice: number; quantity: number; buyDate?: string;
}

interface EnrichedHolding extends HoldingInput {
  currentPrice: number; invested: number; value: number;
  profit: number; profitRate: number;
  analysisData: StockAnalysisData | null;
  relevantNews: { title: string; summary?: string; date?: string; url?: string }[];
  mdd: number | null;         // 최근 3개월 최대낙폭(%), 음수
  volatility: number | null;  // 최근 3개월 일별 변동성(표준편차, %)
  todayChangeRate: number | null;  // 오늘 vs 전일 종가 등락률(%) — 차트 마지막 2행에서 계산, 신규 API 호출 없음
  todayContribution: number | null; // 오늘 손익 기여도(원) = (오늘종가-전일종가) × 수량
  surgeHistoryBlock: string | null; // 참고용(있을 때만 Stage 1 프롬프트에 포함), 사례 없으면 null
  tradingValueBlock: string | null; // 거래대금배수 — 우선순위 최상, 있으면 Stage 1 프롬프트에 필수 포함
}

interface StockAiResult {
  ticker: string; signal: Signal; reason: string; sector: string;
  newsBasis: 'news' | 'estimated';
}

interface PrevPortfolioResult {
  totalProfitRate?: number;
  totalProfit?: number;
  holdings?: { ticker: string; name: string }[];
}

interface PrevPortfolioRow {
  report_date: string;
  result: PrevPortfolioResult | null;
  created_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseAiJson<T>(text: string, fallback: T): T {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('[PORTFOLIO-DIAGNOSIS] AI 응답에서 JSON을 찾지 못함, 길이:', text.length);
    return fallback;
  }
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('[PORTFOLIO-DIAGNOSIS] JSON.parse 실패 (응답이 잘렸을 가능성):', e instanceof Error ? e.message : e);
    return fallback;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timer = new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms));
  return Promise.race([promise, timer]);
}

// 종목 1개 프롬프트 — PER·52주위치·수급·관련도 상위 뉴스 포함
function buildStockPrompt(h: EnrichedHolding): string {
  const ad  = h.analysisData;
  const pr  = h.profitRate >= 0 ? '+' : '';
  const lines: string[] = [
    `현재 시각: ${nowKstString()}`,
    `종목: ${h.name}(${h.ticker}) | 매입가:${h.avgPrice.toLocaleString()} | 현재가:${h.currentPrice.toLocaleString()} | 수익률:${pr}${h.profitRate.toFixed(1)}%`,
  ];
  if (ad) {
    const tech: string[] = [];
    if (ad.per > 0)         tech.push(`PER:${ad.per.toFixed(1)}배`);
    if (ad.week52Position)  tech.push(`52주위치:${ad.week52Position.toFixed(0)}%`);
    if (ad.operatingProfit) tech.push(`영업이익:${ad.operatingProfit}`);
    if (tech.length)        lines.push(tech.join(' | '));
    const inv = buildInvestorBlock(ad);
    if (inv && inv !== '데이터 없음') lines.push(`수급: ${inv.replace(/\n/g, ' ')}`);

    lines.push(buildNewsFreshnessLine(h.relevantNews));
    if (h.relevantNews.length > 0) {
      const newsLines = h.relevantNews
        .map(n => `${n.title}${n.summary ? ` — ${n.summary}` : ''}`)
        .join(' / ');
      lines.push(`뉴스: ${newsLines}`);
      lines.push('(위 뉴스를 근거로 reason을 작성하되, 뉴스에 없는 내용은 지어내지 말 것)');
    } else {
      lines.push('뉴스: 관련 뉴스 없음 — reason은 수급·기술적 요인으로만 작성하고 뉴스를 지어내지 말 것');
    }

    if (!ad.operatingProfit && !ad.revenue) {
      lines.push('재무 데이터 없음 - 수급과 뉴스 기반으로만 분석');
    }
    if (h.tradingValueBlock) {
      lines.push(`참고 - 거래대금: ${h.tradingValueBlock}`);
    }
    if (h.surgeHistoryBlock) {
      lines.push(`참고 - 과거 유사 급등락 이력: ${h.surgeHistoryBlock}`);
    }
  } else {
    lines.push('데이터 조회 실패 - 수익률 기반으로만 분석');
  }
  return lines.join('\n');
}

// ── Stage 1: 종목 개별 분석 ─────────────────────────────────────────────────

async function analyzeOneStock(h: EnrichedHolding): Promise<StockAiResult> {
  const prompt = buildStockPrompt(h);

  const newsBasis: 'news' | 'estimated' = h.relevantNews.length > 0 ? 'news' : 'estimated';

  try {
    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system: [
        { type: 'text', text: STOCK_SIGNAL_SYSTEM },
        { type: 'text', text: STOCK_SIGNAL_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const parsed = parseAiJson<Omit<StockAiResult, 'newsBasis'>>(text, { ticker: h.ticker, signal: '중립·관망', reason: '', sector: '' });

    // 시간적 사실관계 사후 검증 — N개 종목 병렬 호출이라 재생성은 비용이 커서 로그만 남긴다.
    const newsText = h.relevantNews.map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
    const check = checkTemporalConsistency(parsed.reason ?? '', newsText);
    if (check.flagged) {
      console.warn(`[PORTFOLIO-DIAGNOSIS] ${h.ticker} 시간적 사실관계 불일치 감지 (재생성 없음):`, check);
    }

    return { ...parsed, signal: clampSignal(parsed.signal), newsBasis };
  } catch (e) {
    console.error(`[PORTFOLIO-DIAGNOSIS] 종목 분석 실패 ${h.ticker}:`, e);
    return { ticker: h.ticker, signal: '중립·관망', reason: '', sector: '', newsBasis };
  }
}

// 직전 진단(오늘 이전 가장 최근 1건) 대비 차이를 프롬프트에 주입할 텍스트로 변환.
// 수치·구성변화는 서버가 직접 계산해서 채우고(AI에 맡기지 않음), AI는 해석만 한다.
function buildPortfolioHistoryBlock(
  prev: PrevPortfolioRow | null,
  current: { totalProfitRate: number; totalProfit: number; holdings: { ticker: string; name: string }[] },
  daysSinceLastReport: number | null,
): { block: string; addedTickers: { ticker: string; name: string }[]; removedTickers: { ticker: string; name: string }[]; compositionChanged: boolean } {
  if (!prev || daysSinceLastReport === null) {
    return { block: '첫 포트폴리오 진단이라 비교 대상 없음', addedTickers: [], removedTickers: [], compositionChanged: false };
  }

  const prevHoldings  = prev.result?.holdings ?? [];
  const prevTickerSet = new Set(prevHoldings.map(h => h.ticker));
  const currTickerSet = new Set(current.holdings.map(h => h.ticker));
  const addedTickers   = current.holdings.filter(h => !prevTickerSet.has(h.ticker));
  const removedTickers = prevHoldings.filter(h => !currTickerSet.has(h.ticker));
  const compositionChanged = addedTickers.length > 0 || removedTickers.length > 0;

  const lines: string[] = [
    `- 직전 진단과의 간격: ${daysSinceLastReport}일`,
    `- 직전 진단일: ${prev.report_date}`,
  ];
  if (typeof prev.result?.totalProfitRate === 'number') {
    lines.push(`- 총 수익률: 그날 ${prev.result.totalProfitRate >= 0 ? '+' : ''}${prev.result.totalProfitRate}% → 오늘 ${current.totalProfitRate >= 0 ? '+' : ''}${current.totalProfitRate.toFixed(2)}%`);
  }
  if (compositionChanged) {
    const parts: string[] = [];
    if (addedTickers.length)   parts.push(`추가된 종목: ${addedTickers.map(h => h.name).join(', ')}`);
    if (removedTickers.length) parts.push(`제거된 종목: ${removedTickers.map(h => h.name).join(', ')}`);
    lines.push(`- 보유 종목 구성 변경됨 (${parts.join(' / ')}) — 평가손익 금액 비교는 의미가 없으므로 수익률(%) 변화만 근거로 쓸 것`);
  } else if (typeof prev.result?.totalProfit === 'number') {
    lines.push(`- 총 평가손익: 그날 ${prev.result.totalProfit >= 0 ? '+' : ''}${Math.round(prev.result.totalProfit).toLocaleString()}원 → 오늘 ${current.totalProfit >= 0 ? '+' : ''}${Math.round(current.totalProfit).toLocaleString()}원`);
  }
  return { block: lines.join('\n'), addedTickers, removedTickers, compositionChanged };
}

// 같은 섹터에 2종목 이상이고 오늘 방향(상승/하락)이 일치하면 결정형 템플릿 문장 생성.
// AI를 거치지 않는다 — 정교한 상관계수 계산이 아니라 순수 관찰 사실이라 서버 계산만으로
// 충분하고, AI가 편집할 여지를 없애 컴플라이언스 리스크 자체가 생기지 않는다.
function buildCoMovementText(
  enriched: EnrichedHolding[],
  stockResults: StockAiResult[],
): string | null {
  // 2026-07-13 발견: 그룹핑 키를 AI가 자유 형식으로 붙인 sector(stockResults)로 잡으면
  // 같은 업종인데도 "반도체"/"전기전자" 등으로 표기가 갈려 그룹이 안 잡히는 버그가 있었다
  // (실측: 삼성전자·SK하이닉스 둘 다 KIS 분류는 "전기·전자"로 동일). KIS 원천 데이터
  // (analysisData.sector)를 우선 쓰고, 없을 때만 AI 라벨로 폴백한다.
  const bySector = new Map<string, { name: string; changeRate: number }[]>();
  enriched.forEach((h, i) => {
    const sector = h.analysisData?.sector || stockResults[i]?.sector || '';
    if (!sector || h.todayChangeRate === null) return;
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector)!.push({ name: h.name, changeRate: h.todayChangeRate });
  });

  const sentences: string[] = [];
  for (const [sector, items] of bySector) {
    if (items.length < 2) continue;
    const allUp   = items.every(it => it.changeRate > 0);
    const allDown = items.every(it => it.changeRate < 0);
    if (!allUp && !allDown) continue;
    const dir   = allUp ? '상승' : '하락';
    const names = items.map(it => `${it.name}(${it.changeRate >= 0 ? '+' : ''}${it.changeRate.toFixed(1)}%)`).join(', ');
    sentences.push(`${sector} 섹터 비중 종목(${names})이 오늘 같은 방향(${dir})으로 움직였습니다.`);
  }
  return sentences.length > 0 ? sentences.join(' ') : null;
}

// ── Stage 2: 포트폴리오 종합 분석 ──────────────────────────────────────────

async function analyzePortfolioSummary(
  stockResults: StockAiResult[],
  nameMap: Record<string, string>,   // ticker → 종목명
  newsMap: Record<string, { title: string; summary?: string }[]>, // ticker → 관련도 상위 뉴스
  totalProfitRate: number,
  holdingCount: number,
  benchmark: { portfolioProfitRate: number; kospiChangeRate: number } | null,
  portfolioFacts: { lossCount: number; lossWeightPct: number; riskiestLines: string[] },
  historyComparisonBlock: string,
  contributionFactsLine: string,
  holdingPeriodFactsLine: string,
  surgeFactsLine: string,
  coMovementFactsLine: string,
  gapTone: string,
): Promise<{
  summary: string; sectors: unknown[];
  riskFactors: string[]; opportunityFactors: string[]; historyNarrative: string; contributionNarrative: string;
  holdingPeriodNarrative: string; coMovementNarrative: string;
  shortTermOutlook: string; midTermOutlook: string;
}> {
  // 종목명-종목코드 매핑 테이블
  const mappingTable = Object.entries(nameMap)
    .map(([ticker, name]) => `${ticker}: ${name}`)
    .join(', ');

  // 종목명 + 뉴스 현황으로 라인 구성
  const lines = stockResults
    .map(s => {
      const news = newsMap[s.ticker] ?? [];
      const newsPart = news.length > 0 ? ` | 뉴스: ${news[0].title}` : ' | 뉴스: 없음(수급·기술적 요인)';
      return `${nameMap[s.ticker] ?? s.ticker}(${s.sector || '기타'}): ${s.signal} — ${s.reason}${newsPart}`;
    })
    .join('\n');

  const benchmarkLine = benchmark
    ? `\n벤치마크(참고용 수치 비교, 판단 근거로 쓰지 말 것): 포트폴리오 수익률 ${benchmark.portfolioProfitRate.toFixed(2)}% vs 같은 기간 KOSPI 등락률 ${benchmark.kospiChangeRate.toFixed(2)}%`
    : '';

  const riskFactsLine =
    `\n포트폴리오 리스크 참고 데이터:\n` +
    `- 손실 종목: ${portfolioFacts.lossCount}/${holdingCount}개 (평가금액 기준 ${portfolioFacts.lossWeightPct.toFixed(1)}%)` +
    (portfolioFacts.riskiestLines.length > 0 ? `\n- 변동성 참고: ${portfolioFacts.riskiestLines.join(', ')}` : '');

  const prompt =
    `포트폴리오 관찰 데이터 정리 (JSON만 출력)\n\n` +
    `현재 시각: ${nowKstString()}\n\n` +
    `[종목코드→종목명 매핑] ${mappingTable}\n\n` +
    `총 수익률: ${totalProfitRate.toFixed(2)}% | 보유종목: ${holdingCount}개${benchmarkLine}\n` +
    `${lines}\n${riskFactsLine}\n\n` +
    `## 직전 진단과의 차이\n${historyComparisonBlock}\n\n` +
    `## 오늘 손익 기여도\n${contributionFactsLine}\n\n` +
    `## 보유 기간 비교\n${holdingPeriodFactsLine}\n\n` +
    `## 포트폴리오 내 과거 유사 급등락 이력\n${surgeFactsLine}\n\n` +
    `## 섹터 동조화 관찰 데이터\n${coMovementFactsLine}\n\n` +
    `위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 스키마와 규칙에 따라 정리하세요.`;

  try {
    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [
        { type: 'text', text: PORTFOLIO_SUMMARY_SYSTEM },
        { type: 'text', text: PORTFOLIO_SUMMARY_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: gapTone, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const parsed = parseAiJson(text, {
      summary: '', sectors: [],
      riskFactors: [], opportunityFactors: [], historyNarrative: '', contributionNarrative: '',
      holdingPeriodNarrative: '', coMovementNarrative: '', shortTermOutlook: '', midTermOutlook: '',
    });

    // 시간적 사실관계 사후 검증 — 포트폴리오 요약은 1회 호출이지만, 종목별 뉴스가 이미
    // Stage 1에서 개별 검증되므로 여기서는 종합 텍스트만 가볍게 로그로 남긴다(재생성 없음).
    const allNewsText = Object.values(newsMap).flat().map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
    const summaryText = [parsed.summary, parsed.historyNarrative, parsed.contributionNarrative, parsed.holdingPeriodNarrative, parsed.coMovementNarrative, parsed.shortTermOutlook, parsed.midTermOutlook].filter(Boolean).join(' ');
    const check = checkTemporalConsistency(summaryText, allNewsText);
    if (check.flagged) {
      console.warn('[PORTFOLIO-DIAGNOSIS] 포트폴리오 종합 요약 시간적 사실관계 불일치 감지 (재생성 없음):', check);
    }

    return parsed;
  } catch (e) {
    console.error('[PORTFOLIO-DIAGNOSIS] 종합 분석 실패:', e);
    return {
      summary: '', sectors: [],
      riskFactors: [], opportunityFactors: [], historyNarrative: '', contributionNarrative: '',
      holdingPeriodNarrative: '', coMovementNarrative: '', shortTermOutlook: '', midTermOutlook: '',
    };
  }
}

// 보유 기간별 관점(3-1) — 매입일이 서로 다른 종목 중 가장 오래/최근 보유한 종목의
// 수익률을 비교해서 편입 시점 격차를 관찰. buyDate가 없거나 전부 같으면 데이터 없음.
function buildHoldingPeriodFactsLine(
  enriched: EnrichedHolding[],
  todayStr: string,
): { line: string; longest: { ticker: string; name: string; holdDays: number; profitRate: number } | null; mostRecent: { ticker: string; name: string; holdDays: number; profitRate: number } | null } {
  const withDates = enriched
    .filter(h => h.buyDate)
    .map(h => ({ ticker: h.ticker, name: h.name, holdDays: daysBetween(todayStr, h.buyDate!), profitRate: parseFloat(h.profitRate.toFixed(2)) }))
    .filter(h => h.holdDays >= 0);

  const uniqueDays = new Set(withDates.map(h => h.holdDays));
  if (withDates.length < 2 || uniqueDays.size < 2) {
    return { line: '매입일 데이터 부족 또는 전부 동일 — 비교 불가', longest: null, mostRecent: null };
  }

  const longest    = [...withDates].sort((a, b) => b.holdDays - a.holdDays)[0];
  const mostRecent = [...withDates].sort((a, b) => a.holdDays - b.holdDays)[0];
  const line =
    `- 가장 오래 보유: ${longest.name} (${longest.holdDays}일 전 매입, 수익률 ${longest.profitRate >= 0 ? '+' : ''}${longest.profitRate}%)\n` +
    `- 가장 최근 편입: ${mostRecent.name} (${mostRecent.holdDays}일 전 매입, 수익률 ${mostRecent.profitRate >= 0 ? '+' : ''}${mostRecent.profitRate}%)`;
  return { line, longest, mostRecent };
}

// ── SSE helper ──────────────────────────────────────────────────────────────

function sseEncode(ctrl: ReadableStreamDefaultController, encoder: TextEncoder, data: object) {
  ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const plan    = await checkPlan(supabase, user.id, user.email);
  const count   = await getMonthlyCount(supabase, user.id);
  const isPro   = plan === 'pro' || plan === 'admin';
  const isBasic = plan === 'basic';
  const limit   = resolvePortfolioLimit(plan);
  return NextResponse.json({
    isPro,
    isBasic,
    count,
    remaining: Math.max(0, limit - count),
  });
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── 1. Auth (정상 JSON 에러 반환) ──────────────────────────────────────────
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const plan    = await checkPlan(supabase, user.id, user.email);
  const isPro   = plan === 'pro' || plan === 'admin';
  const isBasic = plan === 'basic';

  // 플랜 없는 경우 1회권 크레딧 원자적 차감(레이스 컨디션 방지)
  let usedCredit = false;
  if (!isPro && !isBasic) {
    const result = await deductCredit(user.id, 'portfolio');
    if (result.success === false) {
      if (result.reason === 'error') {
        return NextResponse.json({ error: '크레딧 확인 중 오류가 발생했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ error: 'PRO_REQUIRED' }, { status: 403 });
    }
    usedCredit = true;
  }

  const count = await getMonthlyCount(supabase, user.id);
  const limit = resolvePortfolioLimit(plan);
  if (!usedCredit && count >= limit) {
    // 월 한도 초과 시에도 1회권 크레딧 원자적 차감
    const result = await deductCredit(user.id, 'portfolio');
    if (result.success === false) {
      if (result.reason === 'error') {
        return NextResponse.json({ error: '크레딧 확인 중 오류가 발생했습니다.' }, { status: 500 });
      }
      return NextResponse.json(
        { error: `이번 달 사용 한도(${limit}회)를 초과했습니다.` },
        { status: 429 },
      );
    }
    usedCredit = true;
  }

  // ── 2. 입력 검증 ──────────────────────────────────────────────────────────
  const { holdings } = (await request.json()) as { holdings: HoldingInput[] };
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return NextResponse.json({ error: '종목을 하나 이상 입력해주세요.' }, { status: 400 });
  }
  if (holdings.length > MAX_HOLDINGS) {
    return NextResponse.json({ error: `최대 ${MAX_HOLDINGS}종목까지 분석 가능합니다.` }, { status: 400 });
  }

  // ── 3. SSE 스트림 시작 ────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const send    = (ctrl: ReadableStreamDefaultController, data: object) =>
    sseEncode(ctrl, encoder, data);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Stage 0: 데이터 수집
        send(controller, { type: 'progress', label: '종목 데이터 수집 중...' });
        console.log(`[PORTFOLIO-DIAGNOSIS] 데이터 수집 시작 (${holdings.length}개 종목)`);

        const [analysisResults, chartResults, naverNewsResults] = await Promise.all([
          Promise.allSettled(
            holdings.map(h =>
              withTimeout(collectStockAnalysisData(h.ticker, h.name), 8000, null)
            ),
          ),
          Promise.allSettled(
            // '3M'→'1Y': computeSurgeHistory(최근 약 5개월 이력)에 필요한 최소 기간 확보.
            // 호출 수는 그대로(종목당 1회) — MDD/변동성 계산도 배열이 길어져도 동일하게 동작.
            // 타임아웃 8초→15초(2026-07-13 발견): fetchDailyChart 내부 자체 타임아웃이
            // 시장 코드(J/Q)당 10초라 최악의 경우 20초까지 걸리는데, 바깥 래퍼가 8초로
            // 더 짧으면 KIS 응답이 오기도 전에 먼저 포기해서 오늘 손익 기여도·급등이력·
            // 거래대금배수가 조용히 null 처리되는 버그가 있었다(4종목 동시 요청 부하에서
            // 매번 다른 종목이 랜덤하게 누락됨 — 실측: 모베이스전자).
            holdings.map(h =>
              withTimeout(fetchDailyChart(h.ticker, '1Y'), 15000, null).then(v => {
                if (v === null) console.warn(`[PORTFOLIO-DIAGNOSIS] ${h.ticker}(${h.name}) 차트 조회 실패/타임아웃 — 손익 기여도·급등이력·거래대금배수 계산에서 제외됨`);
                return v;
              })
            ),
          ),
          // 2026-07-13 발견: collectStockAnalysisData는 DB(articles) 뉴스만 보고 있어서
          // 소형주는 실제 관련 뉴스가 있어도 DB 커버리지가 낮아 "미확인" 처리되는 문제가
          // 있었다(실측: 모베이스전자 DB 뉴스 0건). 기업분석/종목 리포트와 동일하게
          // 네이버 실시간 검색을 병행한다.
          Promise.allSettled(
            holdings.map(h => withTimeout(fetchNaverNews(h.name), 8000, { items: [], apiError: true })),
          ),
        ]);

        const enriched: EnrichedHolding[] = holdings.map((h, i) => {
          const ar           = analysisResults[i];
          const ad           = ar.status === 'fulfilled' ? ar.value : null;
          const currentPrice = (ad?.currentPrice && ad.currentPrice > 0) ? ad.currentPrice : h.avgPrice;
          const resolvedName = (ad?.stockName && ad.stockName !== h.ticker) ? ad.stockName : h.name;
          const invested     = h.avgPrice * h.quantity;
          const value        = currentPrice * h.quantity;
          const profit       = value - invested;
          const profitRate   = h.avgPrice > 0 ? ((currentPrice - h.avgPrice) / h.avgPrice) * 100 : 0;

          const nr = naverNewsResults[i];
          const naverItems = nr.status === 'fulfilled' ? nr.value.items : [];
          const newsCandidates = [
            ...(ad?.news ?? []).map(n => ({ title: n.title, summary: n.summary, date: n.date, url: n.url })),
            ...naverItems.map(n => ({ title: n.title, summary: n.description, url: n.url })),
          ];
          const relevantNews = pickRelevantNews(newsCandidates, resolvedName, ad?.sector, 3);

          const cr        = chartResults[i];
          const chartData = (cr.status === 'fulfilled' && cr.value) ? cr.value : [];
          const closes    = chartData.map(p => p.close);
          const risk      = computeRiskMetrics(closes);

          // 오늘 손익 기여도 — 신규 API 호출 없이 이미 fetch한 차트의 마지막 2개 종가로 계산
          let todayChangeRate: number | null = null;
          let todayContribution: number | null = null;
          if (chartData.length >= 2) {
            const todayClose = chartData[chartData.length - 1].close;
            const prevClose  = chartData[chartData.length - 2].close;
            if (todayClose > 0 && prevClose > 0) {
              todayChangeRate   = ((todayClose - prevClose) / prevClose) * 100;
              todayContribution = (todayClose - prevClose) * h.quantity;
            }
          }

          const surgeHistory      = chartData.length ? computeSurgeHistory(chartData) : null;
          const surgeHistoryBlock = surgeHistory?.hasMatches ? buildSurgeHistoryBlock(surgeHistory) : null;

          // 거래대금배수(우선순위 최상, 2026-07-13 2차 고도화) — "오늘 이 종목이 얼마나
          // 얇은/두꺼운 거래량에서 움직였는지"는 포트폴리오 리스크 판단에 직결.
          const tradingValueMultiple = chartData.length ? computeTradingValueMultiple(chartData) : null;
          const tradingValueBlock    = tradingValueMultiple?.valid ? buildTradingValueBlock(tradingValueMultiple) : null;

          return {
            ...h, name: resolvedName, currentPrice, invested, value, profit, profitRate,
            analysisData: ad, relevantNews,
            mdd:        risk?.mdd        ?? null,
            volatility: risk?.volatility ?? null,
            todayChangeRate, todayContribution, surgeHistoryBlock, tradingValueBlock,
          };
        });

        // 벤치마크 비교: 편입 종목 평균 매수일 ~ 현재 KOSPI 등락률 (매수일 입력된 종목이 있을 때만)
        let benchmark: {
          portfolioProfitRate: number; kospiChangeRate: number;
          fromDate: string; toDate: string;
        } | null = null;
        try {
          const buyDates = holdings
            .map(h => h.buyDate)
            .filter((d): d is string => !!d)
            .map(d => new Date(d).getTime())
            .filter(t => !isNaN(t));
          if (buyDates.length > 0) {
            const avgBuyDate = new Date(buyDates.reduce((s, t) => s + t, 0) / buyDates.length);
            const kospi = await withTimeout(fetchIndexRangeChange('0001', avgBuyDate, new Date()), 8000, null);
            if (kospi) {
              benchmark = {
                portfolioProfitRate: 0, // 아래에서 totalProfitRate 계산 후 채움
                kospiChangeRate: parseFloat(kospi.changeRate.toFixed(2)),
                fromDate: kospi.startDate,
                toDate:   kospi.endDate,
              };
            }
          }
        } catch (e) {
          console.error('[PORTFOLIO-DIAGNOSIS] 벤치마크 비교 실패:', e);
        }

        const totalInvested   = enriched.reduce((s, h) => s + h.invested, 0);
        const totalValue      = enriched.reduce((s, h) => s + h.value, 0);
        const totalProfit     = totalValue - totalInvested;
        const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

        if (benchmark) benchmark.portfolioProfitRate = parseFloat(totalProfitRate.toFixed(2));

        // 포트폴리오 리스크 참고 데이터 (Stage 2 프롬프트에 사실로 주입)
        const lossHoldings   = enriched.filter(h => h.profitRate < 0);
        const lossCount      = lossHoldings.length;
        const lossWeightPct  = totalValue > 0 ? (lossHoldings.reduce((s, h) => s + h.value, 0) / totalValue) * 100 : 0;
        const riskiestLines  = [...enriched]
          .filter(h => h.mdd != null)
          .sort((a, b) => (a.mdd as number) - (b.mdd as number))
          .slice(0, 2)
          .map(h => `${h.name} 최근 3개월 MDD ${(h.mdd as number).toFixed(1)}%`);

        // ── 직전 진단(오늘 이전 가장 최근 1건) 조회 — "직전 진단 대비" 계산용 ──────
        const todayStr = kstDateStr();
        let prevRow: PrevPortfolioRow | null = null;
        try {
          const { data } = await supabase
            .from('portfolio_diagnosis')
            .select('report_date, result, created_at')
            .eq('user_id', user.id)
            .lt('report_date', todayStr)
            .order('report_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          prevRow = data as PrevPortfolioRow | null;
        } catch (e) {
          console.warn('[PORTFOLIO-DIAGNOSIS] 직전 진단 조회 실패, 비교 없이 진행:', e instanceof Error ? e.message : e);
        }
        const daysSinceLastReport = (prevRow && prevRow.report_date) ? daysBetween(todayStr, prevRow.report_date) : null;
        const currentHoldingsForHistory = enriched.map(h => ({ ticker: h.ticker, name: h.name }));
        const {
          block: historyComparisonBlock, addedTickers, removedTickers, compositionChanged,
        } = buildPortfolioHistoryBlock(
          prevRow,
          { totalProfitRate, totalProfit, holdings: currentHoldingsForHistory },
          daysSinceLastReport,
        );
        const gapTone =
          daysSinceLastReport === null ? PORTFOLIO_FIRST_TONE :
          daysSinceLastReport === 1 ? PORTFOLIO_ONE_DAY_TONE :
          daysSinceLastReport <= 6 ? PORTFOLIO_FEW_DAYS_TONE :
          PORTFOLIO_LONG_GAP_TONE;

        // ── 오늘 손익 기여도 상위 종목 (방향당 최대 N개 컷오프, N은 보유종목 수에 비례) ──
        // 2026-07-13 4차 개선: N을 3으로 고정하면 보유종목이 늘어날 때(최대 10개) 상위
        // 기여 종목을 너무 적게 보여주게 된다 — 최소 3, 최대 5, 그 사이는 보유종목 수의
        // 절반로 스케일. 주의: 이 N은 "상승/하락 각 방향의 컷오프"일 뿐이라 실제 표시되는
        // 총 종목 수(양+음 합계, 극단치 강제포함분 포함)와 다를 수 있다 — UI 라벨에 쓸
        // 개수는 아래 finalResult에서 topPositive.length + topNegative.length로 별도 계산한다.
        const topContributorsN = Math.min(5, Math.max(3, Math.ceil(enriched.length / 2)));
        const contributors = enriched.filter(h => h.todayContribution !== null);
        const topPositive = [...contributors].filter(h => (h.todayContribution as number) > 0)
          .sort((a, b) => (b.todayContribution as number) - (a.todayContribution as number)).slice(0, topContributorsN);
        const topNegative = [...contributors].filter(h => (h.todayContribution as number) < 0)
          .sort((a, b) => (a.todayContribution as number) - (b.todayContribution as number)).slice(0, topContributorsN);

        const mostExtreme = [...contributors].sort(
          (a, b) => Math.abs(b.todayChangeRate as number) - Math.abs(a.todayChangeRate as number),
        )[0];
        if (mostExtreme && !topPositive.includes(mostExtreme) && !topNegative.includes(mostExtreme)) {
          if ((mostExtreme.todayContribution as number) >= 0) topPositive.push(mostExtreme);
          else topNegative.push(mostExtreme);
        }

        const fmtContrib = (h: EnrichedHolding) => `${h.name} ${(h.todayContribution as number) >= 0 ? '+' : ''}${Math.round(h.todayContribution as number).toLocaleString()}원 (${(h.todayChangeRate as number) >= 0 ? '+' : ''}${(h.todayChangeRate as number).toFixed(2)}%)`;
        const contributionFactsLine = contributors.length > 0
          ? [
              topPositive.length ? `- 상승 기여 상위: ${topPositive.map(fmtContrib).join(', ')}` : null,
              topNegative.length ? `- 하락 기여 상위: ${topNegative.map(fmtContrib).join(', ')}` : null,
            ].filter(Boolean).join('\n') || '뚜렷한 기여 종목 없음'
          : '오늘 등락 데이터 없음';

        // ── 보유 기간별 관점 (3-1) — 최장/최근 보유 종목 성과 비교 ─────────────────
        const holdingPeriodFacts = buildHoldingPeriodFactsLine(enriched, todayStr);

        // Stage 1: 종목별 개별 분석 (병렬)
        send(controller, { type: 'progress', label: `${enriched.length}개 종목 개별 분석 중...` });
        console.log(`[PORTFOLIO-DIAGNOSIS] Stage 1 시작 — ${enriched.length}개 병렬 분석`);

        const stockResults = await Promise.all(enriched.map(h => analyzeOneStock(h)));

        // 섹터 co-movement 사실 — 그룹핑·방향 판정은 AI 호출 없이 서버가 결정형으로 계산
        // (컴플라이언스 리스크 없는 순수 사실). 이 사실을 Stage 2 프롬프트에 넣어
        // "왜/무슨 함의인지"는 AI가 해석하게 한다(2026-07-13 3차 고도화 — 사실 재조합에
        // 그쳤던 문제 개선).
        const coMovementText = buildCoMovementText(enriched, stockResults);
        const coMovementFactsLine = coMovementText ?? '동조화 사례 없음';

        // 포트폴리오 내 과거 유사 급등락 이력 — Stage 0에서 종목별로 이미 계산된 값을 모음
        const surgeFactsLine = enriched
          .filter(h => h.surgeHistoryBlock)
          .map(h => `- ${h.name}: ${h.surgeHistoryBlock}`)
          .join('\n') || '데이터 없음';

        // Stage 2: 포트폴리오 종합 분석
        send(controller, { type: 'progress', label: '포트폴리오 종합 분석 중...' });
        console.log('[PORTFOLIO-DIAGNOSIS] Stage 2 시작 — 종합 분석');

        // ticker → 종목명 / 관련 뉴스 매핑 (AI가 summary에 종목명·뉴스 근거 사용하도록)
        const nameMap: Record<string, string> = {};
        const newsMap: Record<string, { title: string; summary?: string }[]> = {};
        enriched.forEach(h => {
          nameMap[h.ticker] = h.name;
          newsMap[h.ticker] = h.relevantNews;
        });

        const summary = await analyzePortfolioSummary(
          stockResults, nameMap, newsMap, totalProfitRate, enriched.length, benchmark,
          { lossCount, lossWeightPct, riskiestLines },
          historyComparisonBlock, contributionFactsLine, holdingPeriodFacts.line,
          surgeFactsLine, coMovementFactsLine, gapTone,
        );

        // 결과 병합
        const mergedHoldings = enriched.map(h => {
          const aiH = stockResults.find(s => s.ticker === h.ticker);
          return {
            ticker:       h.ticker,
            name:         h.name,
            currentPrice: h.currentPrice,
            avgPrice:     h.avgPrice,
            quantity:     h.quantity,
            value:        h.value,
            invested:     h.invested,
            profit:       h.profit,
            profitRate:   parseFloat(h.profitRate.toFixed(2)),
            signal:       aiH?.signal ?? '중립·관망',
            reason:       aiH?.reason ?? '',
            sector:       aiH?.sector ?? '',
            newsBasis:    aiH?.newsBasis ?? (h.relevantNews.length > 0 ? 'news' : 'estimated'),
            news:         h.relevantNews,
            mdd:          h.mdd,
            volatility:   h.volatility,
            todayContribution: h.todayContribution,
            isCached:     h.analysisData?.isCached,
            cachedAt:     h.analysisData?.cachedAt,
          };
        });

        const finalResult = {
          totalInvested,
          totalValue,
          totalProfit,
          totalProfitRate: parseFloat(totalProfitRate.toFixed(2)),
          summary:            summary.summary            ?? '',
          sectors:            summary.sectors            ?? [],
          holdings:           mergedHoldings,
          riskFactors:        summary.riskFactors        ?? [],
          opportunityFactors: summary.opportunityFactors  ?? [],
          shortTermOutlook:   summary.shortTermOutlook    || '',
          midTermOutlook:     summary.midTermOutlook      || '',
          benchmark,
          history: {
            daysSince: daysSinceLastReport,
            prevDate: prevRow?.report_date,
            prevTotalProfitRate: prevRow?.result?.totalProfitRate ?? null,
            prevTotalProfit:     prevRow?.result?.totalProfit     ?? null,
            compositionChanged,
            addedTickers,
            removedTickers,
            narrative: summary.historyNarrative || (daysSinceLastReport === null ? '이 포트폴리오의 첫 진단입니다.' : ''),
          },
          // 서버 계산 금액을 그대로 노출 — AI(contributionNarrative)가 숫자를 옮겨 적다 틀릴
          // 여지를 없앤다(2026-07-13 발견: AI 서술에만 의존하면 실제 금액과 어긋날 수 있음).
          topContributors: {
            // 2026-07-13 발견: topContributorsN은 "방향당 컷오프"라 상승/하락 각각
            // 그 값까지 담길 수 있고 극단치 종목이 강제로 하나 더 추가될 수도 있어서,
            // 실제 표시되는 총 개수와 다를 수 있었다(실측: 컷오프 3인데 5종목 표시).
            // 라벨은 반드시 아래 두 배열의 실제 길이 합으로 계산한다.
            n: topPositive.length + topNegative.length, // UI 라벨용 — "오늘 손익 영향이 가장 큰 N종목"
            positive: topPositive.map(h => ({ ticker: h.ticker, name: h.name, amount: Math.round(h.todayContribution as number) })),
            negative: topNegative.map(h => ({ ticker: h.ticker, name: h.name, amount: Math.round(h.todayContribution as number) })),
          },
          contributionNarrative: summary.contributionNarrative || '',
          coMovementText,
          coMovementNarrative: summary.coMovementNarrative || '',
          holdingPeriod: {
            longest:    holdingPeriodFacts.longest,
            mostRecent: holdingPeriodFacts.mostRecent,
            narrative:  summary.holdingPeriodNarrative || '',
          },
        };

        // DB 저장
        try {
          const { error: insertError } = await supabase.from('portfolio_diagnosis').insert({
            user_id:     user.id,
            report_date: todayStr,
            result:      finalResult,
          });
          if (insertError) console.error('[PORTFOLIO-DIAGNOSIS] DB 저장 실패:', insertError);
        } catch (dbErr) {
          console.error('[PORTFOLIO-DIAGNOSIS] DB 저장 실패:', dbErr);
        }

        console.log(`[PORTFOLIO-DIAGNOSIS] 완료${usedCredit ? ' (1회권 사용)' : ''}`);
        send(controller, { type: 'result', data: finalResult });
      } catch (e) {
        console.error('[PORTFOLIO-DIAGNOSIS] 치명적 오류:', e);
        send(controller, { type: 'error', message: 'AI 분석 생성 실패' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
