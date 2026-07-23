import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { deductCredit } from '@/lib/credits';
import { checkPlan, resolveDiagnosisLimit, getUsageCycleStart } from '@/lib/plan';
import { fetchStockPrice, fetchIndexRangeChange, fetchDailyChart, fetchAnnualFinancials, type AnnualFinancialRow } from '@/lib/kis-api';
import {
  collectStockAnalysisData,
  buildTechnicalBlock,
  buildInvestorBlock,
  buildNewsBlock,
  pickRelevantNews,
  computeSurgeHistory,
  computeTradingValueMultiple,
  computeRiskMetrics,
  buildSurgeHistoryBlock,
  buildTradingValueBlock,
  buildRiskMetricsBlock,
} from '@/lib/stock-analysis-data';
import { fetchSectorPeers, computeSectorRelativeChange } from '@/lib/sector-peers';
import { fetchRecentDisclosures, type DartDisclosure } from '@/lib/dart-api';
import { COMPLIANCE_PRINCIPLE } from '@/lib/ai-compliance';
import { fetchNaverNews } from '@/lib/naver-news';
import {
  nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, checkTemporalConsistency,
  kstDateStr, daysBetween,
} from '@/lib/ai-grounding';
import type { Database } from '@/lib/database.types';

export const dynamic    = 'force-dynamic';
// 2026-07-23 실측: 60초는 2026-06-29 DB 에러 핸들링 보강 시 30→60초로 단순 연장한 값이라
// 실측 근거가 없었음 — 이후 "3차 고도화"로 출력 필드가 늘며 지금은 실측 worst-case가
// 42.9초(71.5%)까지 올라와 세 리포트 중 여유가 가장 적었다. 포트폴리오진단(120s)과
// 동일 수준으로 맞춰 안전마진 확보(Vercel Pro GA 상한 800초 대비 15%에 불과).
export const maxDuration = 120;

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// 2026-07-13 재설계: 같은 사실이 여러 섹션(요약/주요 관찰 데이터/가격위치 데이터/참고
// 데이터 포인트)에 반복 서술되던 문제, 뉴스가 나열형이던 문제, 히스토리 비교가 아예
// 없던 문제를 종목 리포트(app/api/stock/[ticker]/analysis/route.ts) 재설계와 동일한
// 원칙으로 해결. summary/reasons/technicalAnalysis/opportunityFactors 4개 필드를
// mainAnalysis 하나의 서술형 본문으로 통합하고, historyNarrative로 "직전 진단 대비"
// 개념을 신설했다. 매 요청마다 동일한 고정 지침 — 프롬프트 캐싱 대상(system 블록,
// cache_control 적용). 종목별로 바뀌는 데이터(가격/수급/뉴스/히스토리)는 messages 쪽에 둔다.
const DIAGNOSIS_OUTPUT_INSTRUCTIONS = `## 출력 JSON 스키마 (반드시 아래 구조 그대로 출력)
{
  "mainAnalysis": "【500~700자, 아래 순서로 하나의 흐름으로 이어 쓸 것 — 항목을 나열하지 말 것】[1] 첫 문장: 현재 상태를 관찰형으로 — 예) '지금 삼성전자는 수익이 충분히 난 상태이며 외국인 자금 유출이 나타나고 있습니다.' [2] 밸류에이션 한 줄 코멘트: PER/PBR이 업종 평균 대비 어느 수준인지 관찰형으로 — 예) 'PER 44배 수준은 반도체 업종 평균 대비 높은 밸류에이션 구간으로 풀이됩니다.' (52주 고저가·PER 숫자 자체를 다시 나열하지 말고 해석 문장으로만) [3] 수급 해석: 외국인·기관 5일 추이의 방향과 규모를 관찰형으로 서술 — 개인과 방향이 실제로 반대일 때만 그 대립 구도를 사실로 명시(같으면 생략, 미래 가격을 예측하는 문구 절대 금지) [4] (관련 뉴스가 있으면) 뉴스의 핵심 사실을 '누가/무엇을/왜'가 드러나게 재구성하고, 그 뉴스가 실제 주가·수급 움직임과 연결되는지, 선반영된 것인지, 하루짜리 이슈인지 지속될 이슈인지까지 해석 (기사 문장을 15단어 이상 그대로 인용 금지). 뉴스가 없으면 이 문단은 생략하고 '특별한 뉴스 없이 수급·기술적 요인으로 추정된다' 정도로 짧게만 정리 [5] (뉴스 논조와 실제 주가 흐름이 실제로 반대일 때만) 그 괴리를 강조 — 괴리가 없으면 생략 [6] [내부 계산 지표] 중 최소 1개를 보유 정보(매입가 대비 관점·평가손익)와 엮어 서술하세요 — **[급등이력]에 hasMatches:true인 사례가 있으면 반드시 그것을 우선 활용**(과거 유사 규모 등락 이후 실제 수익률 흐름을 사실로 제시, 예측 아님), 사례가 없을 때만 거래대금배수·MDD/변동성 중에서 고르세요. 예) '이 종목은 매입가 대비 10% 수익 구간인데, 오늘 같은 규모의 급락은 최근 5개월 내 한 차례 더 있었고 그때는 이후 5일간 +3% 반등했습니다' 같이 종목 리포트와는 다르게 '내 포지션 관점'에서 풀어 쓸 것(종목 리포트의 문장을 그대로 옮기지 말 것). **업종 대비·실적 추이는 이 필드에서 언급하지 마세요** — 각각 sectorNarrative/financialsNarrative 필드에서 별도로 다룹니다. [7] 데이터 사실로 마무리 — 52주 고점·저점 대비 위치는 관찰 사실로 짧게 언급 가능하나 그 숫자로 결론을 유도하지 말 것. 금지: 매수/매도/홀딩 같은 지시나 권유, '~하세요'/'~하는 게 좋습니다'/'권고'/'~전략이 현실적입니다' 같은 1인칭 조언 문장, 목표가·손절가 언급, 저항선·지지선·매물대 같은 기술적 분석 용어, 미래 가격 예측 표현, ①②③ 번호 나열, 데이터를 bullet처럼 툭툭 끊어 나열하는 문장(반드시 서술형으로 연결). 스타일: 편하게 설명하는 관찰형 어조를 쓰되 문장마다 종결 표현을 다양하게 바꾸고 같은 어미를 반복하지 마세요",
  "historyNarrative": "【1~2문장, 아래 [직전 진단과의 간격] 지시를 그대로 따를 것】구체적 수치는 화면에 별도로 표시되므로 여기서는 그 변화가 어떤 의미인지 해석 위주로 서술",
  "sectorNarrative": "【[업종 대비]에 peer 데이터가 있을 때만 1~3문장 — 없으면 빈 문자열 \"\"】오늘 이 종목의 등락률이 동종업계 대비 어떻게 움직였는지만 집중 해석. 예) '오늘 반도체 업종 평균은 +0.81%인 반면 이 종목은 -7.71%로 업종 내에서도 두드러진 약세를 보였습니다.' mainAnalysis·riskFactors와 겹치는 내용 반복 금지, 수치 나열보다 그 격차가 업종 공통 이슈인지 이 종목만의 개별 이슈인지 짚는 데 집중",
  "financialsNarrative": "【[실적 추이]에 데이터가 있을 때만 2~3문장 — 없으면 빈 문자열 \"\"】최근 3개년 매출·영업이익·순이익·ROE 추세와 함의를 짧게. 예) '2023년 적자에서 2024·2025년 연속 흑자 전환했고, 영업이익도 확대되는 흐름입니다. 이 개선 궤도가 이어지는지는 다음 실적 발표에서 확인될 예정입니다.' 숫자를 전부 나열하지 말고 추세(개선/악화/횡보)와 그 의미 위주로, 향후 실적을 예측하지 말고 '다음 실적에서 확인될 예정' 같은 관찰형으로 마무리",
  "disclosureNarrative": "【[최근 주요 공시]에 사례가 있을 때만 1~2문장 — 없으면 빈 문자열 \"\"】공시는 사실관계가 명확하므로 뉴스보다 구체적 수치·날짜를 그대로 인용해도 됨(예: '7월 10일 자기주식 500억원 규모 처분을 공시했다'). 이 공시가 왜 있었는지/무엇을 의미하는지 관찰형으로 해석하되, 나열하지 말고 서술형 문장으로. mainAnalysis·riskFactors와 겹치는 내용 반복 금지",
  "riskFactors": ["리스크 요인 1 (수치 포함, mainAnalysis와 겹치지 않는 내용)", "리스크 요인 2", "리스크 요인 3"],
  "institutionalFlow": "기관 수급 한 줄 캡션 (도넛 차트 옆에 표시, 1문장, '순매수 우위' 같은 방향성 판단 표현 대신 관찰된 유입/유출 규모를 그대로 서술)",
  "foreignFlow": "외국인 수급 한 줄 캡션 (도넛 차트 옆에 표시, 1문장, 동일 기준)",
  "flowPercentage": 50,
  "shortTermOutlook": "단기 관찰 변수 — mainAnalysis에 이미 쓴 내용과 겹치지 않는 새 정보만, 현재 진행 중인 수급/이벤트 요인 중 앞으로 방향이 바뀔 수 있는 지점을 사실 나열형으로 서술 (예: '외국인 자금은 5일째 유출 중이며, 기관은 오늘 하루 대규모로 유입했습니다. 이 두 흐름이 계속될지는 아직 확인되지 않았습니다.') — '주가 방향이 갈릴 수 있다', '~구간이다', '상승/하락 여력' 같이 가격 움직임을 예측하는 표현 절대 금지, 목표가·저항선·지지선 언급 금지, 2문장",
  "midTermOutlook": "중기 관찰 변수 — mainAnalysis에 이미 쓴 내용과 겹치지 않는 새 정보만, 업황·실적 관련 사실을 나열하되 특정 가격 수준이나 방향을 예측하지 않음 (예: '메모리 공급 부족 전망과 대규모 투자 계획이 발표된 상태이며, 실제 실적 개선 여부는 다음 분기 실적에서 확인될 예정입니다.') — 가격 방향 예측·목표가·저항선·지지선 언급 절대 금지, 2문장"
}

위 JSON 스키마를 반드시 준수하세요. 각 필드는 반드시 포함되어야 합니다.
규칙:
- ${COMPLIANCE_PRINCIPLE}
- riskFactors는 반드시 문자열 배열 (JSON array)
- flowPercentage는 반드시 숫자 타입, 0~100 사이 정수 (외국인·기관 합산 순매수 강도 관찰치) — 이 값은 서버가 실측 수급 데이터로 재계산해 덮어쓰므로 참고용으로만 채우세요
- "목표가", "손절가", "매수 추천", "매도 추천", "권고", "정당화", "저항선", "지지선", "매물대", "과매수", "과매도", "지지 시험", "가격 방향", "우위를 점하는지", "상승 여력을 기대", "신호로 해석" 단어·표현을 사용하지 마세요
- mainAnalysis·shortTermOutlook·midTermOutlook은 관찰된 사실만 서술하고, 그 사실이 앞으로 주가에 어떤 영향을 줄지 예측하거나 암시하지 마세요
- 같은 사실(52주 위치, 특정 수급 수치, 특정 뉴스 등)을 mainAnalysis·riskFactors·shortTermOutlook·midTermOutlook 여러 곳에서 반복 서술하지 마세요 — 각 필드는 서로 다른 내용을 담아야 합니다
- 52주 고가/저가·PER/PBR 같은 정적 지표를 mainAnalysis의 핵심 근거 문장으로 쓰지 마세요 (스치듯 한 번 언급하는 것은 허용하되 그 숫자로 결론을 이끌어내지 말 것)
- financialsNarrative: [실적 추이]는 확정된 연간 실적이며 잠정치가 아닙니다 — "향후 실적이 개선될 것" 같은 전망이 아니라 "최근 N개년 추세가 이러하다"는 관찰로만 서술하세요
- sectorNarrative: [업종 대비]는 "판단이 아닌 수치 비교"입니다 — 시장(KOSPI) 대비 비교와 같은 어투로, 우열을 평가하는 뉘앙스 없이 사실만 전달하세요
- sectorNarrative·financialsNarrative·disclosureNarrative는 mainAnalysis·riskFactors·shortTermOutlook·midTermOutlook과 내용이 겹치면 안 됩니다 — 업종/실적/공시 이야기는 각각 그 필드에서만
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- 52주 고점/저점을 언급할 때는 위에 제공된 수치를 그대로 활용하세요 (임의의 가격을 새로 만들지 마세요)
- 순수 JSON만 출력하고 다른 텍스트는 절대 포함하지 마세요.
- 마크다운 코드블록(\`\`\`json), 설명 텍스트, preamble 없이 { 로 시작하는 JSON만 출력하세요.`;

// 2026-07-13 "직전 진단과의 간격"에 따라 어조를 분기 — stock_analysis_history와
// 동일한 이유(사용자마다 진단 빈도가 다름)로, 인기 있게 자주 들여다보는 종목은
// 매일이지만 그렇지 않은 종목은 며칠~몇 주씩 공백이 생긴다. 간격 자체
// (daysSinceLastReport)를 프롬프트에 명시하고 구간별로 다른 어조를 쓴다.
const DIAG_FIRST_REPORT_TONE = `## [직전 진단과의 간격] 첫 기업분석

이 종목의 첫 기업분석으로, 비교할 과거 데이터가 없습니다. historyNarrative에는 "이 종목의 첫 기업분석으로 비교할 과거 데이터가 없다"는 사실을 짧게 한 문장으로만 언급하세요. 과장하거나 아쉬워하는 티를 내지 마세요.`;

const DIAG_ONE_DAY_GAP_TONE = `## [직전 진단과의 간격] 1일 (어제)

직전 기업분석이 어제 것입니다. historyNarrative에서 자연스럽게 "어제 대비"라는 표현을 써서, [직전 기업분석과의 차이]에 제공된 수익률·수급·주가 변화 중 의미 있는 것을 근거로 무엇이 달라졌는지 해석하세요. 구체적 수치는 화면에 이미 따로 표시되므로 숫자를 그대로 반복하기보다 그 변화가 어떤 의미인지(수급 방향 전환, 밸류에이션 변화 등)에 집중하세요.`;

const DIAG_FEW_DAYS_GAP_TONE = `## [직전 진단과의 간격] 2~6일

직전 기업분석이 며칠 전 것입니다. historyNarrative에서 "어제 대비"가 아니라 "N일 전 진단 대비"라는 표현을 쓰고(N은 [직전 기업분석과의 차이]에 제시된 실제 일수), 그 사이 무엇이 달라졌는지 해석하세요. 간격이 왜 생겼는지 사과하거나 설명할 필요는 없습니다 — 이 정도는 흔한 일입니다.`;

const DIAG_LONG_GAP_TONE = `## [직전 진단과의 간격] 7일 이상

직전 기업분석이 오래 전(7일 이상) 것입니다. historyNarrative 맨 앞에 "오랜만에 다시 진단받은 보유 종목"이라는 사실을 위트 있게 짧게 한 문장으로 짚으세요. 예시 톤(그대로 쓰지 말고 매번 다르게 표현할 것):
- "이 종목은 최근 N일간 진단이 뜸했던 모양이다"
- "N일 만에 다시 점검받는 보유 종목이다"
- "한동안 잊혔다가 오늘 다시 소환된 보유 종목"
(N은 [직전 기업분석과의 차이]에 제시된 실제 일수로 채우세요)

이 문장은 비꼬거나 종목을 깎아내리는 톤이 아니라 가볍게 던지는 한 줄 유머여야 합니다. 절대로 "망한 종목", "관심 꺼진 종목" 같은 부정적 낙인 표현이나, "지금이 기회", "저평가" 같은 투자 유인성 표현을 쓰지 마세요 — 컴플라이언스 원칙(매수/매도·목표가 관련 금지 규칙)이 이 문장에도 동일하게 적용됩니다. 이 위트 문장 다음에는 곧바로 [직전 기업분석과의 차이]의 실제 데이터(수익률 변화, 수급 변화 등)로 자연스럽게 이어가세요. 위트 문장은 매번 표현을 다르게 써서 반복되지 않게 하세요(고정 문구 금지).`;

interface PrevDiagnosisResult {
  profitRate?: number;
  profitAmount?: number;
  currentPrice?: number;
  flowType?: 'BUY' | 'SELL' | 'NEUTRAL';
  flowPercentage?: number;
}

interface PrevDiagnosisRow {
  report_date: string;
  avg_price: number;
  quantity: number;
  result: PrevDiagnosisResult | null;
  created_at: string;
}

// 직전 진단(오늘 이전 가장 최근 1건) 대비 차이를 프롬프트에 주입할 텍스트로 변환.
// 수치는 서버가 직접 계산해서 채우고(AI에 맡기지 않음), AI는 이 블록을 해석만 한다.
function buildDiagnosisHistoryBlock(
  prev: PrevDiagnosisRow | null,
  current: { profitRate: number; profitAmount: number; currentPrice: number; flowType: 'BUY' | 'SELL' | 'NEUTRAL'; flowPercentage: number },
  daysSinceLastReport: number | null,
  holdingsChanged: boolean,
): string {
  if (!prev || daysSinceLastReport === null) return '첫 기업분석이라 비교 대상 없음';

  const lines: string[] = [
    `- 직전 진단과의 간격: ${daysSinceLastReport}일`,
    `- 직전 진단일: ${prev.report_date}`,
  ];
  if (typeof prev.result?.profitRate === 'number') {
    lines.push(`- 수익률: 그날 ${prev.result.profitRate >= 0 ? '+' : ''}${prev.result.profitRate}% → 오늘 ${current.profitRate >= 0 ? '+' : ''}${current.profitRate.toFixed(2)}%`);
  }
  if (holdingsChanged) {
    lines.push('- 매입평균가 또는 보유수량이 직전 진단과 달라짐 — 평가손익 금액 비교는 의미가 없으므로 수익률(%) 변화만 근거로 쓸 것');
  } else if (typeof prev.result?.profitAmount === 'number') {
    lines.push(`- 평가손익: 그날 ${prev.result.profitAmount >= 0 ? '+' : ''}${Math.round(prev.result.profitAmount).toLocaleString()}원 → 오늘 ${current.profitAmount >= 0 ? '+' : ''}${Math.round(current.profitAmount).toLocaleString()}원`);
  }
  if (typeof prev.result?.currentPrice === 'number') {
    lines.push(`- 주가: 그날 ${prev.result.currentPrice.toLocaleString()}원 → 오늘 ${Math.round(current.currentPrice).toLocaleString()}원`);
  }
  if (prev.result?.flowType) {
    lines.push(`- 수급(기관+외국인 강도): 그날 ${prev.result.flowType}(${prev.result.flowPercentage ?? '?'}%) → 오늘 ${current.flowType}(${current.flowPercentage}%)`);
  }
  return lines.join('\n');
}

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

// 기업분석 이번 달(결제 사이클) 이용 건수 — 2026-07-14까지는 KST 당일(하루) 기준이었으나
// 요금제 재구성으로 월간 전환. app/api/portfolio-diagnosis/route.ts의 getMonthlyCount와
// 동일 패턴(subscription_start_date 기준 사이클, lib/plan.ts의 getUsageCycleStart 공용).
async function getMonthlyDiagnosisCount(
  supabase: ReturnType<typeof makeSupabase>,
  userId: string,
): Promise<number> {
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('subscription_start_date')
      .eq('id', userId)
      .maybeSingle();

    const { cycleStart } = getUsageCycleStart(userRow?.subscription_start_date ?? null, new Date());

    const { count } = await supabase
      .from('stock_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', cycleStart.toISOString());
    return count ?? 0;
  } catch { return 0; }
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const count = await getMonthlyDiagnosisCount(supabase, user.id);
  const plan  = await checkPlan(supabase, user.id, user.email);
  const limit = resolveDiagnosisLimit(plan);
  return NextResponse.json({ count, remaining: Math.max(0, limit - count) });
}

export async function POST(request: NextRequest) {
  // 최상위 try-catch: 어느 단계에서든 예외 발생 시 반드시 JSON 반환
  try {
    const supabase = makeSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const count = await getMonthlyDiagnosisCount(supabase, user.id);

    // 2026-07-08~2026-07-14까지는 관리자 제외 전원이 하루 1회로 하드코딩돼 pricing 광고
    // (Free 1회/Basic 6회/Pro 11회)와 어긋나 있었음 — 실제 플랜별 한도로 교체.
    // 2026-07-14 요금제 재구성: 일일→월간 한도 전환(Free 5/Basic 30/Pro 50).
    const plan  = await checkPlan(supabase, user.id, user.email);
    const limit = resolveDiagnosisLimit(plan);
    let usedCredit = false;
    if (count >= limit) {
      // 기본 한도 초과 시 1회권 크레딧 원자적 차감(레이스 컨디션 방지) —
      // 분석 성공 여부와 무관하게 사용 처리
      const result = await deductCredit(user.id, 'stock');
      if (result.success === false) {
        if (result.reason === 'error') {
          return NextResponse.json({ error: '크레딧 확인 중 오류가 발생했습니다.' }, { status: 500 });
        }
        const message = plan === 'free'
          ? '이번 달 무료 이용 횟수를 모두 사용했습니다. 베이직/프로로 업그레이드하면 더 많이 이용하실 수 있습니다.'
          : '이번 달 이용 한도를 모두 사용했습니다. 다음 결제일에 초기화됩니다.';
        return NextResponse.json({ error: message }, { status: 429 });
      }
      usedCredit = true;
    }

    const body = await request.json().catch(() => ({}));
    const { ticker, name, avgPrice, quantity, buyDate } = body as {
      ticker?: string; name?: string; avgPrice?: number; quantity?: number; buyDate?: string;
    };

    if (!ticker || !name || !avgPrice || !quantity) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    // ── 1단계: 데이터 병렬 수집 ─────────────────────────────────────────────
    console.log('[DIAGNOSIS] 1. 데이터 수집 시작', { ticker, name });

    const [priceResult, analysisResult, naverNewsResult, chartResult, sectorResult, financialsResult, disclosuresResult] = await Promise.allSettled([
      fetchStockPrice(ticker),
      collectStockAnalysisData(ticker, name),
      fetchNaverNews(name),
      // '1M'→'1Y': computeSurgeHistory(최근 약 5개월 이력)에 필요한 최소 기간 확보.
      // 기존 20거래일 평균 거래대금 계산(chartData.slice(-20))은 배열이 길어져도 동일하게 동작.
      fetchDailyChart(ticker, '1Y'),
      fetchSectorPeers(ticker),
      fetchAnnualFinancials(ticker),
      fetchRecentDisclosures(ticker),
    ]);

    console.log('[DIAGNOSIS] 2. 데이터 수집 완료', {
      price:    priceResult.status,
      analysis: analysisResult.status,
      news:     naverNewsResult.status,
      chart:    chartResult.status,
      sector:   sectorResult.status,
      financials: financialsResult.status,
      disclosures: disclosuresResult.status,
      priceErr:    priceResult.status    === 'rejected' ? String(priceResult.reason)    : null,
      analysisErr: analysisResult.status === 'rejected' ? String(analysisResult.reason) : null,
      newsErr:     naverNewsResult.status === 'rejected' ? String(naverNewsResult.reason): null,
      chartErr:    chartResult.status    === 'rejected' ? String(chartResult.reason)    : null,
      sectorErr:   sectorResult.status   === 'rejected' ? String(sectorResult.reason)   : null,
      financialsErr: financialsResult.status === 'rejected' ? String(financialsResult.reason) : null,
      disclosuresErr: disclosuresResult.status === 'rejected' ? String(disclosuresResult.reason) : null,
    });

    // ── 2단계: 결과 추출 ──────────────────────────────────────────────────────
    const priceData    = priceResult.status    === 'fulfilled' ? priceResult.value    : null;
    const analysisData = analysisResult.status === 'fulfilled' ? analysisResult.value : null;
    const naverNewsRaw = naverNewsResult.status === 'fulfilled' ? naverNewsResult.value.items : [];
    const chartData    = chartResult.status    === 'fulfilled' ? chartResult.value    : [];
    const sectorPeers   = sectorResult.status     === 'fulfilled' ? sectorResult.value     : [];
    const annualFinancials: AnnualFinancialRow[] = financialsResult.status === 'fulfilled' ? financialsResult.value : [];
    const disclosures: DartDisclosure[] = disclosuresResult.status === 'fulfilled' ? disclosuresResult.value : [];

    const currentPrice = (priceData?.price && priceData.price > 0)
      ? priceData.price
      : (analysisData?.currentPrice && analysisData.currentPrice > 0)
        ? analysisData.currentPrice
        : Number(avgPrice);

    const stockName = (priceData?.name && priceData.name !== ticker)
      ? priceData.name
      : (analysisData?.stockName || String(name));

    console.log('[DIAGNOSIS] 3. 가격·종목명', { currentPrice, stockName });

    // ── 3단계: 프롬프트 블록 조립 ─────────────────────────────────────────────
    let technicalBlock = '데이터 없음';
    let investorBlock  = '데이터 없음';
    let newsBlockStr   = '관련 뉴스 없음';

    try {
      if (analysisData) technicalBlock = buildTechnicalBlock(analysisData);
    } catch (e) { console.error('[DIAGNOSIS] buildTechnicalBlock 실패:', e); }

    try {
      if (analysisData) investorBlock = buildInvestorBlock(analysisData);
    } catch (e) { console.error('[DIAGNOSIS] buildInvestorBlock 실패:', e); }

    // DB 뉴스 + Naver 뉴스를 한 풀로 모은 뒤, 종목명·업종 키워드로 관련도 상위 2~3개만 선별
    const newsCandidates = [
      ...(analysisData?.news ?? []).map(n => ({ title: n.title, summary: n.summary, date: n.date, url: n.url })),
      ...naverNewsRaw.map((n) => ({
        title:   n.title,
        summary: n.description,
        url:     n.url,
      })),
    ];
    const relevantNews = pickRelevantNews(newsCandidates, stockName, analysisData?.sector, 3);
    const hasRelevantNews = relevantNews.length > 0;

    try {
      newsBlockStr = buildNewsBlock(relevantNews);
    } catch (e) { console.error('[DIAGNOSIS] buildNewsBlock 실패:', e); }

    const combinedNews = relevantNews.map(n => ({
      title:       n.title,
      description: n.summary ?? '',
      url:         n.url ?? '',
    }));

    const changeRate = (priceData && typeof priceData.changeRate === 'number') ? priceData.changeRate : 0;
    const isBigMove   = Math.abs(changeRate) >= 5;

    const newsInstruction = hasRelevantNews
      ? '위 뉴스는 이 종목과 관련도가 높다고 판단되어 매칭된 실제 기사입니다. mainAnalysis를 작성할 때 반드시 이 뉴스를 근거로 최근 주가 변동 원인을 설명하고, 뉴스에 없는 내용을 지어내지 마세요.'
      : '관련 뉴스가 매칭되지 않았습니다. 이 경우 뉴스를 근거로 등락 원인을 지어내지 말고, mainAnalysis에 "특별한 뉴스 없이 수급·기술적 요인으로 추정됩니다" 취지의 문구를 명확히 포함해 뉴스 기반 분석이 아니라는 점을 밝히세요.';

    const profitRate   = currentPrice > 0 && avgPrice > 0
      ? ((currentPrice - avgPrice) / avgPrice * 100)
      : 0;
    const profitAmount = (currentPrice - avgPrice) * quantity;
    const holdDays = buyDate
      ? Math.floor((Date.now() - new Date(buyDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // ── 벤치마크 비교: 매수일이 있을 때만 계산 (판단 없이 사실 비교 수치만) ──────
    const market = priceData?.market ?? 'KOSPI';
    let benchmark: {
      indexName: 'KOSPI' | 'KOSDAQ'; indexChangeRate: number;
      stockProfitRate: number; fromDate: string; toDate: string;
    } | null = null;

    if (buyDate) {
      try {
        const indexCode = market === 'KOSDAQ' ? '1001' : '0001';
        const idx = await fetchIndexRangeChange(indexCode, new Date(buyDate), new Date());
        if (idx) {
          benchmark = {
            indexName:       market,
            indexChangeRate: parseFloat(idx.changeRate.toFixed(2)),
            stockProfitRate: parseFloat(profitRate.toFixed(2)),
            fromDate:        idx.startDate,
            toDate:          idx.endDate,
          };
        }
      } catch (e) {
        console.error('[DIAGNOSIS] 벤치마크 비교 실패:', e);
      }
    }

    // ── flowType/flowPercentage: 실제 KIS 수급 데이터로 서버가 직접 계산(AI 응답에
    // 의존하지 않음) — 히스토리 비교 블록과 프롬프트에도 필요해 Claude 호출 이전으로
    // 끌어올렸다(기존에는 응답 파싱 후 계산했음). net(외국인+기관 순매수, 억원)을
    // 절대금액으로 캡핑하면 대형주는 항상 상한(95%)에 붙어 변별력이 없으므로, 최근
    // 20거래일 평균 거래대금 대비 비율로 정규화한다. 문턱을 넘겨도 값이 클수록 95%에
    // 더 가까워지도록 tanh로 부드럽게 포화시킨다.
    let flowType: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let flowPercentage = 50;

    if (analysisData?.investorLatest) {
      const { foreign, institution } = analysisData.investorLatest;
      const net = foreign.amount + institution.amount; // 억원
      if (Math.abs(net) > 10) {
        flowType = net > 0 ? 'BUY' : 'SELL';

        const recentDays = chartData.slice(-20).filter(d => d.volume > 0 && d.close > 0);
        const avgTradingValue = recentDays.length > 0
          ? recentDays.reduce((sum, d) => sum + d.volume * d.close, 0) / recentDays.length // 원
          : 0;

        if (avgTradingValue > 0) {
          const netWon    = net * 1e8;                      // 억원 → 원
          const ratio     = Math.abs(netWon) / avgTradingValue; // 거래대금 대비 순매수 비율 (크기만)
          const intensity = Math.tanh(ratio * 10);          // 0~1 범위로 부드럽게 포화
          flowPercentage  = Math.round(25 + intensity * 70); // 25~95 (percent는 방향과 무관한 강도, 방향은 flowType이 담당)
        } else {
          // 거래대금 데이터를 못 가져온 경우 기존 절대금액 캡 방식으로 폴백
          flowPercentage = Math.round(Math.min(Math.abs(net) / 1000 * 70 + 25, 95));
        }
      }
    }

    // ── 그룹 1: 내부 계산 지표 (종목 리포트와 동일 함수 재사용, 2026-07-13) ─────────
    const surgeHistory         = chartData.length ? computeSurgeHistory(chartData) : null;
    const tradingValueMultiple = chartData.length ? computeTradingValueMultiple(chartData) : null;
    const riskMetrics          = chartData.length ? computeRiskMetrics(chartData.map((d) => d.close)) : null;
    const surgeHistoryBlock    = buildSurgeHistoryBlock(surgeHistory);
    const tradingValueBlock    = buildTradingValueBlock(tradingValueMultiple);
    const riskMetricsBlock     = buildRiskMetricsBlock(riskMetrics);

    // ── 그룹 2: 업종 대비 (동종업계 peer 평균 등락률과의 차이) ───────────────────────
    const sectorComparison = computeSectorRelativeChange(changeRate, sectorPeers);
    const sectorBlock = sectorComparison
      ? `- 벤치마크(참고용 수치 비교, 판단 근거로 쓰지 말 것): 이 종목 등락률 ${changeRate >= 0 ? '+' : ''}${changeRate}% vs 동종업계 peer 평균 등락률 ${sectorComparison.peerAvgChangeRate >= 0 ? '+' : ''}${sectorComparison.peerAvgChangeRate}% (${sectorComparison.deltaVsPeer >= 0 ? '+' : ''}${sectorComparison.deltaVsPeer}%p 차이)`
      : '동종업계 비교 데이터 없음';

    // ── 그룹 3-1: 실적 추이 (최근 3개년 확정 연간, 잠정치 아님) ──────────────────────
    const financialsBlock = annualFinancials.length
      ? annualFinancials.map((r) => {
          const parts: string[] = [];
          if (r.revenue !== null)         parts.push(`매출액 ${r.revenue.toLocaleString()}억원`);
          if (r.operatingProfit !== null) parts.push(`영업이익 ${r.operatingProfit.toLocaleString()}억원`);
          if (r.netIncome !== null)       parts.push(`순이익 ${r.netIncome.toLocaleString()}억원`);
          if (r.roe !== null)             parts.push(`ROE ${r.roe}%`);
          return `- ${r.year}년: ${parts.join(', ') || '데이터 없음'}`;
        }).join('\n')
      : '실적 데이터 없음';

    // ── DART 주요 공시 (최근 14일, 임원 지분보고 등 관행적 공시는 이미 필터링됨) ─────
    const disclosureBlock = disclosures.length
      ? disclosures.map((d) => `- [${d.date}] ${d.title} (제출: ${d.filer})`).join('\n')
      : '최근 14일 내 주요 공시 없음';

    // ── 직전 진단(오늘 이전 가장 최근 1건) 조회 — "직전 진단 대비" 계산용.
    // 하루 여러 번 진단하는 것을 막지 않으므로(플랜 한도 내에서는 허용), 정확히
    // "어제"만 보지 않고 report_date < 오늘 중 가장 최근 1건을 가져온다.
    const todayStr = kstDateStr();
    let prevRow: PrevDiagnosisRow | null = null;
    try {
      const { data } = await supabase
        .from('stock_diagnosis')
        .select('report_date, avg_price, quantity, result, created_at')
        .eq('user_id', user.id)
        .eq('ticker', ticker)
        .lt('report_date', todayStr)
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      prevRow = data as PrevDiagnosisRow | null;
    } catch (e) {
      console.warn('[DIAGNOSIS] 직전 진단 조회 실패, 비교 없이 진행:', e instanceof Error ? e.message : e);
    }
    const daysSinceLastReport = (prevRow && prevRow.report_date) ? daysBetween(todayStr, prevRow.report_date) : null;
    // 보유정보(매입평균가/보유수량)가 직전 진단과 달라졌으면 평가손익 "금액" 비교는
    // 의미가 없다(추가매수 등으로 자연히 달라짐) — 수익률(%) 기준 비교는 항상 유효하므로 유지.
    const holdingsChanged = prevRow ? (prevRow.avg_price !== Number(avgPrice) || prevRow.quantity !== Number(quantity)) : false;
    const historyComparisonBlock = buildDiagnosisHistoryBlock(
      prevRow,
      { profitRate, profitAmount, currentPrice, flowType, flowPercentage },
      daysSinceLastReport,
      holdingsChanged,
    );
    const gapTone =
      daysSinceLastReport === null ? DIAG_FIRST_REPORT_TONE :
      daysSinceLastReport === 1 ? DIAG_ONE_DAY_GAP_TONE :
      daysSinceLastReport <= 6 ? DIAG_FEW_DAYS_GAP_TONE :
      DIAG_LONG_GAP_TONE;

    // ── 4단계: Claude 분석 ────────────────────────────────────────────────────
    const resistance = analysisData?.week52High ?? 0;
    const support     = analysisData?.week52Low  ?? 0;
    const benchmarkLine = benchmark
      ? `\n- 벤치마크(참고용 수치 비교, 판단 근거로 쓰지 말 것): 이 종목 수익률 ${benchmark.stockProfitRate >= 0 ? '+' : ''}${benchmark.stockProfitRate}% vs 같은 기간 ${benchmark.indexName} 등락률 ${benchmark.indexChangeRate >= 0 ? '+' : ''}${benchmark.indexChangeRate}% (${benchmark.fromDate}~${benchmark.toDate})`
      : '';

    const prompt = `아래 실제 데이터를 기반으로 관찰된 사실 위주로 정리하여 반드시 JSON만 출력하세요.

## 기준 시각
현재 시각: ${nowKstString()}

## 종목 기본정보
- 종목명: ${stockName} (${ticker})
- 현재가: ${currentPrice.toLocaleString()}원
- 매입 평균가: ${Number(avgPrice).toLocaleString()}원
- 보유 수량: ${quantity}주
- 수익률: ${profitRate >= 0 ? '+' : ''}${profitRate.toFixed(2)}%
- 평가손익: ${profitAmount >= 0 ? '+' : ''}${Math.round(profitAmount).toLocaleString()}원${holdDays !== null ? `\n- 보유 기간: ${holdDays}일` : ''}${isBigMove ? `\n- ⚠️ 금일 등락률: ${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}% (급${changeRate >= 0 ? '등' : '락'} — 원인 관찰 필요)` : ''}${benchmarkLine}

## 기술적 지표 및 밸류에이션
${technicalBlock}
${resistance > 0 ? `- 52주 고점: ${resistance.toLocaleString()}원` : ''}
${support > 0 ? `- 52주 저가: ${support.toLocaleString()}원` : ''}

## 수급 동향 (최근 5영업일)
${investorBlock}

## 업종 대비
${sectorBlock}

## 실적 추이 (최근 3개년, 확정 연간 실적 — 잠정치 아님)
${financialsBlock}

## 관련 뉴스 (${hasRelevantNews ? '관련도 높은 기사만 선별' : '매칭 결과'}, ${buildNewsFreshnessLine(relevantNews)})
${newsBlockStr}
${newsInstruction}

## 직전 기업분석과의 차이
${historyComparisonBlock}

## 최근 주요 공시 (DART, 최근 14일)
${disclosureBlock}

## 내부 계산 지표 (서버 계산값 — 증권사 앱에는 없는 고유 지표)
- 과거 유사 급등/급락 이력(최근 약 5개월): ${surgeHistoryBlock}
- 거래대금: ${tradingValueBlock}
- 리스크 지표: ${riskMetricsBlock}

분석 포인트:
1. 52주 레인지 내 현재 위치(고점/저점 대비 몇 % 위치인지)와 PER/PBR 수준을 사실로만 한 번 언급 — mainAnalysis에서 스치듯, 핵심 근거로 쓰지 말 것
2. 외국인·기관 5일 수급 추이 관찰
3. ${isBigMove ? `금일 ${changeRate >= 0 ? '급등' : '급락'}(${changeRate.toFixed(2)}%)의 배경을 위 뉴스 섹션 지침에 따라 명확히 서술 (뉴스 근거 vs 수급/기술적 추정 구분)` : '실적·뉴스와 결합하여 업황 및 촉매 요인 관찰'}
4. 보유 기간·수익률과 함께 관찰된 특징 정리 (매매 전략을 지시하지 말 것)
5. 수급 동향에서 외국인·기관과 개인의 매매 방향이 서로 반대인지 확인 (반대인 경우에만 그 대립 구도를 mainAnalysis에 명시)
6. 뉴스 섹션의 논조(긍정/부정)와 실제 주가 흐름(금일 등락률·수익률)이 서로 반대 방향인지 확인 (괴리가 있는 경우에만 mainAnalysis에서 그 점을 강조)
7. [직전 기업분석과의 차이]를 [직전 진단과의 간격] 지시에 따라 historyNarrative로 해석
8. [내부 계산 지표] 중 최소 1개(급등이력 사례가 있으면 그것을 우선)를 mainAnalysis에서 반드시 활용 — 보유 정보(매입가 대비 관점)와 엮어서, 종목 리포트와는 다른 문장으로 서술
9. [업종 대비]에 peer 데이터가 있으면 sectorNarrative를, [실적 추이]에 데이터가 있으면 financialsNarrative를, [최근 주요 공시]에 사례가 있으면 disclosureNarrative를 채우세요 — 데이터가 없으면 해당 필드는 빈 문자열로 두고 mainAnalysis 등 다른 필드에서 억지로 대신 언급하지 마세요
${benchmark ? `\n벤치마크 수치는 mainAnalysis에서 판단 없이 사실 비교로만 1회 언급하세요 (예: "같은 기간 ${benchmark.indexName}는 ${benchmark.indexChangeRate}%로, 이 종목이 시장 대비 ${(benchmark.stockProfitRate - benchmark.indexChangeRate) >= 0 ? '+' : ''}${(benchmark.stockProfitRate - benchmark.indexChangeRate).toFixed(2)}%p ${benchmark.stockProfitRate >= benchmark.indexChangeRate ? '더 상승' : '더 하락'}한 셈임" 정도의 사실 서술은 가능하나 "그래서 ~해야 한다"는 연결 금지)` : ''}

위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 스키마와 규칙에 따라 정리하세요.`;

    console.log('[DIAGNOSIS] 4. Claude 분석 시작');

    const message = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 3500,
      system: [
        { type: 'text', text: COMPLIANCE_PRINCIPLE },
        { type: 'text', text: DIAGNOSIS_OUTPUT_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: gapTone, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: prompt }],
      // 2026-07-23: SDK 기본값(timeout 10분, maxRetries 2)은 maxDuration(120s)보다 훨씬 커서,
      // Claude가 느려지면 우리 catch가 실행되기 전에 Vercel이 함수를 강제종료해 사용자에게
      // 에러 메시지 없이 연결만 끊길 위험이 있었다 — 명시적으로 짧게 걸어 우리 에러 핸들링이
      // 항상 먼저 발동하도록 함. maxRetries는 0으로 낮춤(SDK 기본 재시도는 타임아웃도
      // 재시도 대상이라 최악의 경우 timeout의 배수만큼 걸릴 수 있어, 예산 계산이 불가능해짐
      // — 재시도 없이 1회 시도(실측 최악 36.6초 대비 2.5배 여유)로 실패하면 즉시 명확한
      // 에러를 반환하는 편이 낫다).
    }, { timeout: 90_000, maxRetries: 0 });

    console.log('[DIAGNOSIS] 5. Claude 응답 수신');
    console.log('[TOKEN_USAGE]', {
      route: 'diagnosis', ticker, hasRelevantNews, disclosureCount: disclosures.length,
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
    });

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
    // 마크다운 코드펜스 제거 후 JSON 추출
    const cleaned   = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    // 히스토리 비교 수치는 AI 응답과 무관하게 서버가 이미 갖고 있으므로, JSON 파싱
    // 실패(fallback) 경로에서도 정상적으로 채운다 — narrative만 AI 의존.
    const buildHistory = (narrative: string) => (
      prevRow && daysSinceLastReport !== null
        ? {
            daysSince:          daysSinceLastReport,
            prevDate:           prevRow.report_date,
            prevProfitRate:     typeof prevRow.result?.profitRate === 'number' ? prevRow.result.profitRate : null,
            prevProfitAmount:   typeof prevRow.result?.profitAmount === 'number' ? prevRow.result.profitAmount : null,
            prevCurrentPrice:   typeof prevRow.result?.currentPrice === 'number' ? prevRow.result.currentPrice : null,
            prevFlowType:       prevRow.result?.flowType ?? null,
            prevFlowPercentage: typeof prevRow.result?.flowPercentage === 'number' ? prevRow.result.flowPercentage : null,
            holdingsChanged,
            narrative,
          }
        : { daysSince: null, narrative }
    );

    // fallback 결과 생성 헬퍼 (JSON 파싱 불가 시 최소한의 데이터라도 반환)
    const buildFallback = (errReason: string) => ({
      mainAnalysis:       rawText.slice(0, 600).trim() || 'AI 분석 결과를 가져오는 중 형식 오류가 발생했습니다.',
      currentPrice:       Math.round(currentPrice),
      avgPrice:           Math.round(Number(avgPrice)),
      quantity:           Number(quantity),
      profitRate:         parseFloat(profitRate.toFixed(2)),
      profitAmount:       Math.round(profitAmount),
      resistance:         Math.round(resistance),
      support:            Math.round(support),
      benchmark,
      isCached:           analysisData?.isCached,
      cachedAt:           analysisData?.cachedAt,
      institutionalFlow:  '응답 형식 오류로 분석 불가',
      foreignFlow:        '응답 형식 오류로 분석 불가',
      riskFactors:        ['응답 형식 오류로 리스크 요인 제공 불가'],
      flowType,
      flowPercentage,
      news:               combinedNews,
      newsBasis:          (hasRelevantNews ? 'news' : 'estimated') as 'news' | 'estimated',
      history:            buildHistory(`AI 응답 형식 오류(${errReason})로 히스토리 해석을 가져오지 못했습니다.`),
      sectorComparison,   // 서버 계산값 — AI 응답과 무관하게 항상 채움
      sectorNarrative:    '',
      annualFinancials,   // 서버 계산값 — AI 응답과 무관하게 항상 채움
      financialsNarrative: '',
      disclosures,        // 서버 계산값 — AI 응답과 무관하게 항상 채움
      disclosureNarrative: '',
    });

    if (!jsonMatch) {
      console.error('[DIAGNOSIS] JSON 없음, 원문 앞 300자:', rawText.slice(0, 300));
      return NextResponse.json(buildFallback('JSON 없음'));
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('[DIAGNOSIS] JSON.parse 실패:', e, jsonMatch[0].slice(0, 300));
      return NextResponse.json(buildFallback('JSON 파싱 실패'));
    }

    // 배열 필드 방어적 정규화 (Claude가 string으로 반환할 경우 변환)
    const toArr = (v: unknown): string[] => {
      if (Array.isArray(v)) return (v as unknown[]).map(String).filter(Boolean);
      if (typeof v === 'string' && v)
        return v.split(/\n/).map(s => s.replace(/^[-·•\d]+[.)]\s*/, '').trim()).filter(Boolean);
      return [];
    };

    const historyNarrative = typeof result.historyNarrative === 'string' && result.historyNarrative
      ? result.historyNarrative
      : (daysSinceLastReport === null ? '이 종목의 첫 기업분석입니다.' : '');

    const finalResult = {
      // 서버 계산 수치 (Claude 응답 무시)
      currentPrice:  Math.round(currentPrice),
      avgPrice:      Math.round(Number(avgPrice)),
      quantity:      Number(quantity),
      profitRate:    parseFloat(profitRate.toFixed(2)),
      profitAmount:  Math.round(profitAmount),
      news:          combinedNews,
      newsBasis:     (hasRelevantNews ? 'news' : 'estimated') as 'news' | 'estimated',
      flowType,
      flowPercentage,
      resistance:    Math.round(resistance), // AI가 산출하지 않고 실제 52주 고가를 그대로 사용
      support:       Math.round(support),    // AI가 산출하지 않고 실제 52주 저가를 그대로 사용
      benchmark,     // 서버 계산 — KOSPI/KOSDAQ 등락률 비교 (매수일 있을 때만)
      isCached:      analysisData?.isCached, // 휴장일 등 실시간 조회 실패 시 마지막 거래일 기준 값
      cachedAt:      analysisData?.cachedAt,
      history:       buildHistory(historyNarrative), // 서버 계산 델타 + AI 해석 (직전 진단 대비)
      sectorComparison,   // 서버 계산 — peer 평균 등락률과의 차이 (동종업계 없으면 null)
      annualFinancials,   // 서버 계산 — 최근 3개년 확정 연간 실적 (없으면 빈 배열)
      disclosures,        // 서버 계산 — DART 최근 14일 주요 공시 (없으면 빈 배열, UI는 있을 때만 강조 카드)
      // Claude 응답 필드 (정규화)
      mainAnalysis:       typeof result.mainAnalysis      === 'string' ? result.mainAnalysis      : '',
      riskFactors:        toArr(result.riskFactors),
      institutionalFlow:  typeof result.institutionalFlow === 'string' ? result.institutionalFlow : '',
      foreignFlow:        typeof result.foreignFlow       === 'string' ? result.foreignFlow       : '',
      shortTermOutlook:   typeof result.shortTermOutlook  === 'string' ? result.shortTermOutlook  : undefined,
      midTermOutlook:     typeof result.midTermOutlook    === 'string' ? result.midTermOutlook    : undefined,
      sectorNarrative:     sectorComparison ? (typeof result.sectorNarrative === 'string' ? result.sectorNarrative : '') : '',
      financialsNarrative: annualFinancials.length > 0 ? (typeof result.financialsNarrative === 'string' ? result.financialsNarrative : '') : '',
      disclosureNarrative: disclosures.length > 0 ? (typeof result.disclosureNarrative === 'string' ? result.disclosureNarrative : '') : '',
    };

    // 시간적 사실관계 사후 검증 — 이 라우트는 실패 시 buildFallback으로 이미 복구 경로가
    // 얽혀 있어 자동 재생성은 붙이지 않고(비용/복잡도 판단), 불일치만 로그로 남겨 모니터링한다.
    const diagnosisReportText = [
      finalResult.mainAnalysis, ...finalResult.riskFactors, finalResult.history.narrative,
      finalResult.shortTermOutlook, finalResult.midTermOutlook,
      finalResult.sectorNarrative, finalResult.financialsNarrative, finalResult.disclosureNarrative,
    ].filter(Boolean).join(' ');
    const diagnosisNewsText = combinedNews.map((n) => `${n.title} ${n.description}`).join(' ');
    const temporalCheck = checkTemporalConsistency(diagnosisReportText, diagnosisNewsText);
    if (temporalCheck.flagged) {
      console.warn('[DIAGNOSIS] 시간적 사실관계 불일치 감지 (재생성 없음, 모니터링용):', temporalCheck);
    }

    // DB 저장 (실패해도 결과 반환)
    try {
      await supabase.from('stock_diagnosis').insert({
        user_id:     user.id,
        ticker,
        name:        stockName,
        avg_price:   avgPrice,
        quantity,
        buy_date:    buyDate || null,
        report_date: todayStr,
        result:      finalResult,
      });
      console.log(`[DIAGNOSIS] 6. DB 저장 완료${usedCredit ? ' (1회권 사용)' : ''}`);
    } catch (dbErr) {
      console.error('[DIAGNOSIS] DB 저장 실패 (결과는 반환):', dbErr);
    }

    return NextResponse.json(finalResult);

  } catch (e) {
    console.error('[DIAGNOSIS] 최상위 예외:', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
