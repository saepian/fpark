import { NextRequest, NextResponse, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { deductCredit } from '@/lib/credits';
import { checkPlan, resolveDiagnosisLimit, getUsageCycleStart } from '@/lib/plan';
import { fetchStockPrice, fetchIndexRangeChange, fetchDailyChart, fetchFinancialsTrend, type AnnualFinancialRow, type QuarterlyFinancialRow, fetchDividendHistory, type DividendHistoryRow } from '@/lib/kis-api';
import { computeHoldingPosition, buildHoldingPositionBlock, holdingPriceBasisLabel } from '@/lib/holding-position';
import { getCachedChartNear } from '@/lib/chart-near-cache';
import {
  collectStockAnalysisData,
  buildTechnicalBlock,
  buildInvestorBlock,
  buildNewsBlock,
  computeSurgeHistory,
  computeTradingValueMultiple,
  computeRiskMetrics,
  buildSurgeHistoryBlock,
  buildTradingValueBlock,
  buildRiskMetricsBlock,
} from '@/lib/stock-analysis-data';
import { fetchSectorPeers, computeSectorRelativeChange, computeSectorRelativeChangeFromCloses, shouldUsePrevCloseSectorBasis, type SectorBasis } from '@/lib/sector-peers';
import { stripFlowSubject } from '@/lib/flow-caption';
import { fetchUsdKrwDaily1Y, computeFxCorrelation, isFxCorrelationMeaningful } from '@/lib/fx-correlation';
import { fetchRecentDisclosures, type DartDisclosure, fetchDividendSummary, type DartDividendSummary } from '@/lib/dart-api';
import { COMPLIANCE_PRINCIPLE, scanComplianceViolations } from '@/lib/ai-compliance';
import { selectRelevantNews, type NewsCandidate } from '@/lib/news-selection';
import { selectSectorMacroNews } from '@/lib/sector-news';
import { fetchNewsSentimentTrend } from '@/lib/news-sentiment';
import {
  nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, MARKET_DAY_GROUNDING_INSTRUCTION, checkTemporalConsistency,
  kstDateStr, daysBetween,
} from '@/lib/ai-grounding';
import { getDomesticMarketDayContext, buildMarketDayBlock } from '@/lib/market-day-context';
import { StreamingFieldParser, DIAGNOSIS_FIELD_SPECS } from '@/lib/streaming-json-fields';
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
// 2026-09-01 전면 재편 — "카드 단일역할" 원칙. 예전엔 같은 수치(자사주 매입, 등락률, PER, 외국인
// 유출액…)가 주가 배경·수급 동향·관찰 포인트·리스크·단기/중기·종합진단에 4~7회씩 반복됐다
// (실측: 삼성전자 33개 고유 수치 중 자사주 5곳, 현대차 91% 4곳). 필드마다 "담당 수치"를 정하고
// 다른 필드의 수치는 표현을 바꿔도 반복으로 간주한다. 수급 서술처는 flowInsight(기관/외국인 카드)
// 한 곳으로 줄이고(1층 flowSummary 삭제), 관찰 포인트는 서버가 계산해 주입하는 [내 포지션 데이터]
// 기준의 "내 위치" 서술로 재정의했다. 키 순서는 lib/streaming-json-fields.ts DIAGNOSIS_FIELD_SPECS와
// 반드시 일치.
const DIAGNOSIS_OUTPUT_INSTRUCTIONS = `## 출력 JSON 스키마 (반드시 아래 구조 그대로 출력)
{
  "mainAnalysisSections_background": "【최대 200자, 절대 넘기지 말 것 — 1~2문장, 서술형】오늘 주가 움직임의 배경. 구조는 [원인 1개] + [판단 1개]입니다. 원인은 뉴스·업종 배경·수급/기술적 요인 중 오늘 움직임을 가장 잘 설명하는 것 하나만 고르세요(둘 이상 나열 금지, 기사 문장 15단어 이상 인용 금지). 판단은 '이 종목만의 개별 이슈인지, 업종·시장 전체가 함께 움직인 것인지'를 반드시 결론까지 명시하세요(예: '...로 업종 전체가 함께 밀린 날이며, 이 종목만의 개별 악재는 확인되지 않는다'). 뉴스가 없으면 '특별한 뉴스 없이 수급·기술적 요인으로 추정된다'도 유효한 판단입니다. 금지: 수급 금액·PER/PBR·52주 위치·거래대금 배수·MDD 같은 수치 나열(등락률은 급등락일 때 1회만 허용), 매수/매도/홀딩 지시·권유, 목표가·손절가·저항선·지지선·매물대, 미래 가격 예측, ①②③·bullet식 나열",
  "mainAnalysisSections_valuationNote": "【최대 90자, 절대 넘기지 말 것 — 1문장】PER/PBR을 다루는 유일한 자리입니다. PER·PBR 수준을 오늘 움직임 또는 실적 추세와 연결해 해석하세요(단순히 높다/낮다만 재서술 금지). 예) 'PER 36.5배로 업종 평균보다 높게 거래돼온 만큼, 오늘 같은 급락은 그 프리미엄이 일부 되돌려지는 과정으로도 해석될 수 있다.' 데이터 없으면 빈 문자열 \\"\\". 동종업계 등락률·수급·매입가 대비 언급 금지",
  "mainAnalysisSections_watchPoint": "【최대 150자, 절대 넘기지 말 것 — 1~2문장, 내 포지션 관점】아래 [내 포지션 데이터]의 수치만 사용해 '지금 내 위치'를 서술하세요. 반드시 포함: (1) 매입가 대비 수익/손실 구간 (2) 보유 중 고점 또는 저점 대비 현재 위치. 여기에 ±15% 변동일 수·PER 변화·지수 대비 중 1개만 골라 덧붙일 수 있습니다(수치는 총 3개 이하 — 카드 타일에 전부 표시되므로 나열하지 말 것). 예) '매입가 대비 -10% 구간에서, 보유 중 고점(374,500원) 대비 -30%를 되돌린 위치다. 보유기간 중 ±15% 변동일은 없었다.' [내 포지션 데이터]에 없는 수치를 만들지 말 것. 업종 대비·실적·수급·급등락 사례·거래대금·뉴스는 다른 필드의 몫이므로 언급 금지. '회복', '반등', '되찾', '만회' 같은 방향 표현 금지 — 위치만 서술",
  "historyNarrative": "【1~2문장, 아래 [직전 진단과의 간격] 지시를 그대로 따를 것】구체적 수치는 화면에 별도로 표시되므로 여기서는 그 변화가 어떤 의미인지 해석 위주로 서술",
  "sectorNarrative": "【[업종 대비]에 peer 데이터가 있을 때만 1~2문장 — 없으면 빈 문자열 \\"\\"】오늘 이 종목의 등락률이 동종업계 대비 어떻게 움직였는지만 집중 해석([업종 대비]에 '전일 … 마감 기준' 표시가 있으면 '오늘' 대신 '전일(날짜)' 기준으로 서술). 예) '오늘 반도체 업종 평균은 +0.81%인 반면 이 종목은 -7.71%로 업종 내에서도 두드러진 약세를 보였습니다.' 수치 나열보다 그 격차가 업종 공통 이슈인지 이 종목만의 개별 이슈인지 짚는 데 집중 — 격차의 '원인'(자사주·수급·뉴스 등)은 background·flowInsight가 이미 다뤘으므로 여기서 다시 쓰지 말 것. PER/PBR(valuationNote)·수급(flowInsight)과 겹치지 않음",
  "financialsNarrative": "【[실적 추이]에 데이터가 있을 때만 2문장 — 없으면 빈 문자열 \\"\\"】연간 추세 1문장 + 최근 분기(전년 동기 대비) 1문장. 숫자를 전부 나열하지 말고 추세(개선/악화/횡보)와 그 의미 위주로, 향후 실적을 예측하지 말고 '다음 분기 실적에서 확인' 같은 관찰형으로 마무리",
  "disclosureNarrative": "【[최근 주요 공시]에 사례가 있을 때만 1~2문장 — 없으면 빈 문자열 \\"\\"】공시는 사실관계가 명확하므로 구체적 수치·날짜를 그대로 인용해도 됨(예: '7월 10일 자기주식 500억원 규모 처분을 공시했다'). 이 공시가 무엇을 의미하는지 관찰형으로 해석. 공시 수치는 이 필드에서만 인용(background·riskFactors에서 반복 금지)",
  "riskFactors": ["종목 고유 리스크 1 (25~40자)", "종목 고유 리스크 2 (25~40자)", "종목 고유 리스크 3 (25~40자)"],
  "flowInsight": "【최대 110자, 절대 넘기지 말 것 — 1문장】수급을 해석하는 유일한 자리(기관/외국인 카드 안). 외국인·기관 5일 추이 중 방향이 뚜렷한 쪽 하나를 골라 개인 수급 방향 또는 오늘 등락률과 연결해 해석하세요(유입·유출 금액 재서술 금지, 금액 수치는 최대 1개). 개인과 방향이 반대라면 그 대립이 왜 눈에 띄는지까지. 근거가 부족하면 '아직 명확하지 않다'도 정답. 미래 가격 예측 금지",
  "institutionalFlow": "기관 수급 한 줄 캡션 (도넛 차트 옆 '기관' 라벨 뒤에 표시되므로 '기관'이라는 주어 없이 서술, 1문장, '순매수 우위' 같은 방향성 판단 표현 대신 관찰된 유입/유출 규모를 그대로 서술 — 예: '최근 5거래일 중 3일 순유입, 누적 +120억원')",
  "foreignFlow": "외국인 수급 한 줄 캡션 ('외국인' 라벨 뒤에 표시되므로 주어 없이, 1문장, 동일 기준)",
  "shortTermOutlook": "【최대 100자, 절대 넘기지 말 것 — 1문장】수주 내 확인할 이 종목 고유의 이벤트·지표 1개(실적 발표, 공시, 신제품·수주·규제 결정, 주주환원 집행 등) + 그것이 무엇을 확인시켜 주는지. 금리·환율·지수 같은 매크로 일반론, 수급 추이(외국인·기관·개인·공매도 등 수급 단어 자체 금지), '주가 방향이 갈릴 수 있다'·'~구간이다'·'상승/하락 여력' 같은 가격 표현, 목표가·저항선·지지선 금지",
  "midTermOutlook": "【최대 100자, 절대 넘기지 말 것 — 1문장】수개월 내 확인할 이 종목 고유의 이벤트·지표 1개 + 그것이 무엇을 확인시켜 주는지. shortTermOutlook과 다른 이벤트. 동일한 금지 규칙(매크로 일반론·수급·가격 방향·목표가·저항선·지지선 금지)",
  "finalVerdict": "【최대 180자, 절대 넘기지 말 것 — 1~2문장, 순수 서술형】앞선 필드들이 내린 '판단'(개별 이슈인지 업종 동반인지, 밸류에이션 부담 여부, 수급 대립 여부, 실적 추세)만 서로 연결해 종합하는 자리 — 개별 사실·수치(등락률·금액·PER·매입가 대비 등)를 다시 인용하지 마세요. 오늘의 반응(가격 변동 폭)이 실제 근거(뉴스·실적·수급·밸류에이션) 대비 (a) 과도한 반응인지 (b) 타당한 반응인지 (c) 근거가 엇갈려 판단을 유보하는 게 맞는지 하나를 명확히 고르고 그 근거를 같은 문장 안에 붙이세요 — (c)라도 '지켜보자'로 끝내지 말고 무엇이 확인되면 판단이 바뀔지까지 밝힐 것. 점수·등급·별점·숫자 표기 절대 금지, (a)/(b)/(c) 같은 선택지 기호도 문장에 쓰지 말 것. 매매행위(매수/매도/추격매수/진입/청산 등) 직접 지목 금지, 목표가·저항선·지지선·가격 방향 예측 금지",
  "newsIssueClusters": [{"label": "이슈 라벨(8~16자 명사구, 예: 'HBM 신기술 표준 공개')", "articleIndexes": [0, 2]}]
}

위 JSON 스키마를 반드시 준수하세요. mainAnalysisSections_background/valuationNote/watchPoint 3개 필드는 반드시 포함되어야 합니다(valuationNote는 데이터 없으면 빈 문자열 허용).
규칙:
- ${COMPLIANCE_PRINCIPLE}
- JSON 키 순서 및 구조 변경 금지
- 【수치 반복 금지 — 가장 중요】같은 수치·같은 사실을 두 필드 이상에서 쓰지 마세요. 다른 필드가 이미 인용한 수치는 표현을 바꿔도('약 X%', 'X배 수준', '두 자릿수 하락') 반복으로 간주합니다. 수치는 아래 담당 필드에서만 인용하세요: 오늘 등락률·움직임의 원인 → mainAnalysisSections_background / PER·PBR → mainAnalysisSections_valuationNote / 매입가·보유 중 고점·저점 대비·±15% 변동일·PER 변화·지수 대비 → mainAnalysisSections_watchPoint / 외국인·기관·개인 수급 → flowInsight·institutionalFlow·foreignFlow / 업종 peer 등락률 → sectorNarrative / 매출·영업이익·분기 실적 → financialsNarrative / 공시 수치·날짜 → disclosureNarrative / 직전 진단 대비 변화 → historyNarrative. riskFactors·shortTermOutlook·midTermOutlook·finalVerdict는 어떤 수치도 새로 인용하지 않습니다.
- 【테마 반복 금지】mainAnalysisSections_background에서 오늘 움직임의 원인으로 쓴 사건·테마(예: 자사주 취득, MSCI 편입, 특정 뉴스)는 sectorNarrative·flowInsight·riskFactors·shortTermOutlook·midTermOutlook에서 같은 사건을 다시 서술하지 마세요 — 그 사건의 '다음 확인 이벤트'(공시 이행·실적 반영 등)로 shortTermOutlook 또는 midTermOutlook 중 한 곳에서 1회만 허용, finalVerdict는 판단 종합이므로 예외
- riskFactors는 반드시 문자열 배열(JSON array), 각 항목 25~40자, 이 종목 고유 이슈(사업·규제·경쟁·고객사·공급망·소송·실적 변수·자사주 등 주주환원 실행 여부)만. 수급·PER/PBR·거래대금 배수·MDD/변동성·52주 위치·시장 전체 매크로(금리·환율·지수 일반론)는 절대 금지 — 다른 카드가 담당합니다. 고유 이슈가 부족하면 2개만 써도 됩니다(억지로 3개 채우지 말 것). '외국인·기관·개인·공매도·패시브·순매수·순매도·유입·유출·차익실현' 같은 수급 단어는 riskFactors·shortTermOutlook·midTermOutlook에 아예 쓰지 마세요 — 수급 이야기는 flowInsight 한 곳뿐입니다
- "목표가", "손절가", "매수 추천", "매도 추천", "권고", "정당화", "저항선", "지지선", "매물대", "과매수", "과매도", "지지 시험", "가격 방향", "우위를 점하는지", "상승 여력을 기대", "신호로 해석" 단어·표현을 사용하지 마세요
- mainAnalysisSections_background/valuationNote/watchPoint·flowInsight·shortTermOutlook·midTermOutlook은 사실 서술에 전체 분량의 절반을 넘기지 말고, 나머지 절반은 "그 사실이 왜 유의미한지"에 쓰세요. 단, 그 유의미함이 향후 가격 방향 예측이어선 안 됩니다(가격이 오른다/내린다는 판단 금지, 지표의 성격·신뢰도·희소성에 대한 해석은 허용)
- 데이터 포인트를 연결해서 해석하라는 지시가 있다고 근거 없이 억지로 연결하지 마세요 — 연결 지을 근거가 부족하면 "아직 명확하지 않다", "뚜렷한 연결고리는 확인되지 않는다"처럼 솔직하게 쓰는 것도 정답입니다
- financialsNarrative: [실적 추이]의 연간은 확정 실적, 분기는 단독 분기 실적(회계연도 누적 차감)입니다 — "향후 실적이 개선될 것" 같은 전망이 아니라 추세 관찰로만 서술하세요
- sectorNarrative: [업종 대비]는 "판단이 아닌 수치 비교"입니다 — 시장(KOSPI) 대비 비교와 같은 어투로, 우열을 평가하는 뉘앙스 없이 사실만 전달하세요
- finalVerdict는 점수·등급·별점·숫자를 절대 포함하지 말고 순수 문장으로만 최종 판단을 전달하세요. "관찰이 필요하다", "지켜볼 필요가 있다", "추가 확인이 필요하다" 류의 문장으로 판단을 얼버무리며 끝내지 마세요. 판단을 유보할 때조차 무엇이 확인되면 판단이 바뀌는지까지 구체적으로 밝혀야 유효한 유보입니다.
- newsIssueClusters: [뉴스 이슈 클러스터링용 전체 목록]의 기사가 2건 이상이고 서로 다른 사건(이슈)을 대표할 때만 채우세요(3~4개 이하 클러스터). label은 8~16자 명사구로 간결하게(문장형·완결된 문장 금지). 기사가 1건뿐이거나 사실상 하나의 사건만 다루고 있으면 억지로 나누지 말고 빈 배열 []을 반환하세요. 각 인덱스는 최대 하나의 클러스터에만 넣으세요(중복 금지)
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- ${MARKET_DAY_GROUNDING_INSTRUCTION}
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
  // 2026-07-30 발견: 매입평균가가 직전 진단과 달라지면(추가매수 등) 수익률(%)도
  // 손익 금액과 마찬가지로 서로 다른 기준(분모)으로 계산된 값이라 단순 비교가
  // 무의미해진다(실측 사례 — avgPrice 70,000→290,000, rateDelta가 -313.12%p로
  // 왜곡됨). 손익 금액과 동일하게 holdingsChanged면 둘 다 생략하고 AI에게도
  // 언급하지 말라고 명시한다 — 주가는 매입가와 무관해 계속 비교 가능.
  if (holdingsChanged) {
    lines.push('- 매입평균가 또는 보유수량이 직전 진단과 달라짐 — 평가손익 금액·수익률(%) 비교 모두 서로 다른 기준으로 계산된 값이라 의미가 없으므로 절대 언급하지 말 것. 주가 변화만 사실로 언급할 것');
  } else {
    if (typeof prev.result?.profitRate === 'number') {
      lines.push(`- 수익률: 그날 ${prev.result.profitRate >= 0 ? '+' : ''}${prev.result.profitRate}% → 오늘 ${current.profitRate >= 0 ? '+' : ''}${current.profitRate.toFixed(2)}%`);
    }
    if (typeof prev.result?.profitAmount === 'number') {
      lines.push(`- 평가손익: 그날 ${prev.result.profitAmount >= 0 ? '+' : ''}${Math.round(prev.result.profitAmount).toLocaleString()}원 → 오늘 ${current.profitAmount >= 0 ? '+' : ''}${Math.round(current.profitAmount).toLocaleString()}원`);
    }
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

// ── SSE helper — portfolio-diagnosis/route.ts와 동일 패턴 ───────────────────
// 2026-08-11 발견: enqueue가 send(controller,...)를 통해 claudeStream.on('text', ...)
// 콜백 "안에서" 호출되는 구조라, 클라이언트가 스트리밍 도중 연결을 끊으면 controller가
// 즉시 닫혀 enqueue가 예외를 던지고 — 그 예외가 on('text') 밖으로 전파돼 Claude 스트림
// 소비 자체(finalMessage())가 조기 중단됐다. DB 저장은 항상 그 뒤에 있어서 실행되지
// 못했다(실측: 프로덕션 검증 중 "Controller is already closed" + 미저장 확인). 클라이언트가
// 끊긴 건 서버 쪽 생성/저장 로직에 영향을 주면 안 되므로 여기서 조용히 무시한다.
function sseEncode(ctrl: ReadableStreamDefaultController, encoder: TextEncoder, data: object) {
  try {
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  } catch { /* 클라이언트가 이미 끊었으면 무시 — Claude 스트림 소비·DB 저장은 계속돼야 함 */ }
}

export async function POST(request: NextRequest) {
  // ── 1. Auth/크레딧/입력검증 — 스트림 시작 전이라 정상 HTTP status로 반환 가능
  //    (portfolio-diagnosis/route.ts와 동일하게 이 경계 밖은 절대 손대지 않는다) ──────
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

  // ── 2. SSE 스트림 시작 — 2026-08-11 스트리밍 전환. Stage0(서버 계산값 선송신) +
  //    Stage1(단일 Claude 스트림, lib/streaming-json-fields.ts 파서로 필드별 partial/
  //    complete 전송) 구조. app/api/portfolio-diagnosis/route.ts, app/api/stock/[ticker]/
  //    analysis/route.ts와 동일한 SSE 프로토콜(text/event-stream, `data: {...}\n\n`) ──────
  const encoder = new TextEncoder();
  const send = (ctrl: ReadableStreamDefaultController, data: object) => sseEncode(ctrl, encoder, data);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        send(controller, { type: 'progress', label: '종목 데이터 수집 중...' });

        // ── 1단계: 데이터 병렬 수집 ─────────────────────────────────────────────
        console.log('[DIAGNOSIS] 1. 데이터 수집 시작', { ticker, name });

        // 2026-07-23: 뉴스 조회를 종목명 단독 검색(+DB뉴스 병합)에서 종목명+종목코드
        // 병행 검색 후 Haiku 1차 선별로 교체(lib/news-selection.ts, 종목분석에서
        // 이미 검증됨). collectStockAnalysisData의 DB뉴스(analysisData.news)는 계속
        // 보조 후보로 병행 — Promise로 넘겨 collectStockAnalysisData 완료를 기다리지
        // 않고 Naver 조회를 먼저 시작한다(같은 collectStockAnalysisData 호출을
        // 중복 호출하지 않도록 analysisDataPromise를 한 번만 만들어 재사용).
        const analysisDataPromise = collectStockAnalysisData(ticker, name);
        const dbNewsExtraPromise: Promise<NewsCandidate[]> = analysisDataPromise.then(
          (ad) => (ad.news ?? []).map((n) => ({ title: n.title, summary: n.summary, date: n.date, url: n.url })),
          () => [],
        );
        // 2026-08-24: selectRelevantNews에 오늘 등락률을 주입해야 선별 프롬프트의 규칙 1
        // ("오늘 가격변동의 실제 원인 최우선 선택")이 실제로 발동한다(lib/news-selection.ts
        // 참고) — 그러려면 가격을 먼저 알아야 하므로 fetchStockPrice를 독립 promise로 빼
        // 즉시 시작하고, selectRelevantNews만 그 결과를 기다리도록 체이닝한다. 다른 병렬
        // 조회(차트/업종/실적/공시/배당 등)는 이 대기와 무관하게 그대로 동시에 진행된다 —
        // 가격 조회 실패 시에도 changeRate 없이 선별을 계속 진행(폴백).
        const priceDataPromise = fetchStockPrice(ticker);
        const newsSelectionPromise = priceDataPromise.then(
          (priceData) => selectRelevantNews(
            ticker, name, dbNewsExtraPromise,
            typeof priceData?.changeRate === 'number' ? priceData.changeRate : undefined,
          ),
          () => selectRelevantNews(ticker, name, dbNewsExtraPromise),
        );
        // 업종 매크로 뉴스 — 종목분석(app/api/stock/[ticker]/analysis/route.ts)과 동일한
        // lib/sector-news.ts 재사용. collectStockAnalysisData가 이미 계산하는 sector(KIS
        // bstp_kor_isnm)를 그대로 키로 쓰므로 신규 KIS 호출 없음. dbNewsExtraPromise와 같은
        // 방식으로 analysisDataPromise 완료를 체이닝해 나머지 병렬 조회와 동시에 진행한다.
        const sectorMacroPromise = analysisDataPromise.then(
          (ad) => selectSectorMacroNews(ad.sector ?? ''),
          () => selectSectorMacroNews(''),
        );
        // 환율 상관관계용 USD/KRW 1년 시계열 — 종목·다른 데이터와 무관하게 독립적으로 시작해
        // 최대한 일찍부터 겹치게 한다(티커 무관 공유 캐시라 대부분 요청은 Supabase 캐시 히트).
        // 2026-08-11: 예전엔 Claude 호출과 함께 await했지만, 스트리밍 전환으로 Stage0
        // 페이로드에 fxCorrelation을 포함시키려면 Claude 스트림 시작 전에 resolve돼야
        // 한다 — 아래에서 peerChartsPromise와 함께 끌어올려 await한다.
        const fxDailyPromise = fetchUsdKrwDaily1Y().catch(() => []);

        const [priceResult, analysisResult, newsSelectionResult, chartResult, sectorResult, financialsResult, disclosuresResult, dividendSummaryResult, dividendHistoryResult, sectorMacroResult, newsSentimentResult, chart6mResult] = await Promise.allSettled([
          priceDataPromise,
          analysisDataPromise,
          newsSelectionPromise,
          // '1M'→'1Y': computeSurgeHistory(최근 약 5개월 이력)에 필요한 최소 기간 확보.
          // 기존 20거래일 평균 거래대금 계산(chartData.slice(-20))은 배열이 길어져도 동일하게 동작.
          fetchDailyChart(ticker, '1Y'),
          fetchSectorPeers(ticker),
          fetchFinancialsTrend(ticker), // 연간 3개년 + 분기 6개(단독값·전년동기비), 2026-09-01
          fetchRecentDisclosures(ticker),
          fetchDividendSummary(ticker),
          fetchDividendHistory(ticker),
          sectorMacroPromise,
          // 뉴스 논조 추이(2단계 UI 노출, 2026-08-21) — news_sentiment_daily는 CURATED_TICKERS_MKT
          // (대형주 100종목) 한정 크론이라 그 밖의 종목은 null이 정상. fetchNewsSentimentTrend
          // 내부에서 이미 5거래일 미만이면 null을 반환하므로 여기선 그대로 통과시키면 됨.
          fetchNewsSentimentTrend(ticker),
          // 내 포지션 관찰 구간용 최근 6개월 일별 시세(2026-09-02) — fetchDailyChart('1Y')는 KIS 100거래일
          // 캡 때문에 실제로는 약 5개월치라 "오늘 기준 6개월"에 못 미쳤다. 기간별 등락률 표의 6개월 칸이
          // 이미 쓰는 연쇄 백필 + 1일 캐시(lib/chart-near-cache.ts)를 그대로 재사용(캐시 적중 시 추가 호출 없음).
          getCachedChartNear(ticker, 6),
        ]);

        console.log('[DIAGNOSIS] 2. 데이터 수집 완료', {
          price:    priceResult.status,
          analysis: analysisResult.status,
          news:     newsSelectionResult.status,
          chart:    chartResult.status,
          sector:   sectorResult.status,
          financials: financialsResult.status,
          disclosures: disclosuresResult.status,
          dividendSummary: dividendSummaryResult.status,
          dividendHistory: dividendHistoryResult.status,
          sectorMacro: sectorMacroResult.status,
          newsSentiment: newsSentimentResult.status,
          priceErr:    priceResult.status    === 'rejected' ? String(priceResult.reason)    : null,
          analysisErr: analysisResult.status === 'rejected' ? String(analysisResult.reason) : null,
          newsErr:     newsSelectionResult.status === 'rejected' ? String(newsSelectionResult.reason): null,
          chartErr:    chartResult.status    === 'rejected' ? String(chartResult.reason)    : null,
          sectorErr:   sectorResult.status   === 'rejected' ? String(sectorResult.reason)   : null,
          financialsErr: financialsResult.status === 'rejected' ? String(financialsResult.reason) : null,
          disclosuresErr: disclosuresResult.status === 'rejected' ? String(disclosuresResult.reason) : null,
          dividendSummaryErr: dividendSummaryResult.status === 'rejected' ? String(dividendSummaryResult.reason) : null,
          dividendHistoryErr: dividendHistoryResult.status === 'rejected' ? String(dividendHistoryResult.reason) : null,
          newsSentimentErr: newsSentimentResult.status === 'rejected' ? String(newsSentimentResult.reason) : null,
        });

        // ── 2단계: 결과 추출 ──────────────────────────────────────────────────────
        const priceData    = priceResult.status    === 'fulfilled' ? priceResult.value    : null;
        const analysisData = analysisResult.status === 'fulfilled' ? analysisResult.value : null;
        const chartData    = chartResult.status    === 'fulfilled' ? chartResult.value    : [];
        const sectorMacroNews = sectorMacroResult.status === 'fulfilled' ? sectorMacroResult.value.items : [];
        const sectorNameForMacro = analysisData?.sector || priceData?.sector || '';
        const sectorPeers   = sectorResult.status     === 'fulfilled' ? sectorResult.value     : [];

        // 거래일 상태 — 별도 KIS 재조회 없이 위에서 이미 받은 차트의 마지막 행 날짜를 재사용
        // 해 휴장일(주말/공휴일)을 판정한다(lib/market-day-context.ts 참고).
        const marketDayContext = getDomesticMarketDayContext(chartData);
        if (!marketDayContext.isTradingDay) {
          console.log(`[DIAGNOSIS] ${ticker} 휴장일 감지(${marketDayContext.reason}) — 마지막 거래일 ${marketDayContext.lastTradingDate} 기준으로 서술 지시`);
        }
        const financialsTrend = financialsResult.status === 'fulfilled' ? financialsResult.value : { annual: [] as AnnualFinancialRow[], quarterly: [] as QuarterlyFinancialRow[], yearEndMonth: '12' };
        const annualFinancials: AnnualFinancialRow[] = financialsTrend.annual;
        const quarterlyFinancials: QuarterlyFinancialRow[] = financialsTrend.quarterly;
        const financialsYearEndMonth = financialsTrend.yearEndMonth;
        const disclosures: DartDisclosure[] = disclosuresResult.status === 'fulfilled' ? disclosuresResult.value : [];
        const dividendSummary: DartDividendSummary | null = dividendSummaryResult.status === 'fulfilled' ? dividendSummaryResult.value : null;
        const dividendHistory: DividendHistoryRow[] = dividendHistoryResult.status === 'fulfilled' ? dividendHistoryResult.value : [];
        const newsSentiment = newsSentimentResult.status === 'fulfilled' ? newsSentimentResult.value : null;

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
        let sectorNewsBlockStr = '업종 관련 매크로 뉴스 없음';

        try {
          if (analysisData) technicalBlock = buildTechnicalBlock(analysisData);
        } catch (e) { console.error('[DIAGNOSIS] buildTechnicalBlock 실패:', e); }

        try {
          if (analysisData) investorBlock = buildInvestorBlock(analysisData);
        } catch (e) { console.error('[DIAGNOSIS] buildInvestorBlock 실패:', e); }

        // 종목명+종목코드 병행 검색 + Haiku 1차 선별 결과(최대 5건, 이미 관련성 검증됨)
        const relevantNews = newsSelectionResult.status === 'fulfilled' ? newsSelectionResult.value.items : [];
        const hasRelevantNews = relevantNews.length > 0;

        try {
          // changeRate를 넘겨야 buildNewsBlock의 5→3 캡이 "최신순"이 아니라 "오늘 가격변동
          // 관련성 우선순위"로 절삭한다(lib/stock-analysis-data.ts 참고).
          newsBlockStr = buildNewsBlock(relevantNews, priceData?.changeRate);
        } catch (e) { console.error('[DIAGNOSIS] buildNewsBlock 실패:', e); }

        try {
          sectorNewsBlockStr = buildNewsBlock(sectorMacroNews);
        } catch (e) { console.error('[DIAGNOSIS] buildNewsBlock(업종) 실패:', e); }

        // date(원문 pubDate)는 아래 newsClusterListBlock(AI 클러스터링 프롬프트 컨텍스트)에서
        // 쓴다 — 프론트엔드는 더 이상 소비하지 않음(모멘텀 타임라인 카드 삭제, 2026-08-26).
        // relevantNews에 이미 있던 값을 그대로 실어보내는 것뿐, 신규 조회 없음.
        const combinedNews = relevantNews.map(n => ({
          title:       n.title,
          description: n.summary ?? '',
          url:         n.url ?? '',
          date:        n.date ?? '',
        }));

        // 뉴스 이슈 클러스터링(newsIssueClusters)용 인덱스 목록 — buildNewsBlock은 프롬프트
        // 본문(관련 뉴스 섹션)에 최대 3건만 넣지만, 클러스터링은 combinedNews(최대 5건, UI에
        // 그대로 노출되는 배열)와 인덱스가 정확히 일치해야 하므로 별도로 전체를 나열한다.
        // 신규 조회 없음 — 이미 갖고 있는 relevantNews를 다른 포맷으로 다시 나열할 뿐.
        const newsClusterListBlock = hasRelevantNews
          ? relevantNews.map((n, i) => `${i}: [${n.date ?? '날짜 미상'}] ${n.title}`).join('\n')
          : '해당 없음';

        const changeRate = (priceData && typeof priceData.changeRate === 'number') ? priceData.changeRate : 0;
        const isBigMove   = Math.abs(changeRate) >= 5;

        // 2026-07-27: 휴장일이면 뉴스를 "오늘 이 뉴스로 움직였다"는 실시간 반응으로 서술하지
        // 못하게 별도 문구를 덧붙인다(app/api/stock/[ticker]/analysis의 NON_TRADING_DAY_NEWS_
        // FRAMING과 같은 취지 — 이 라우트는 뉴스 지침이 시스템 블록이 아니라 프롬프트 본문에
        // 인라인으로 들어가는 구조라 여기서 직접 이어붙인다).
        const marketDayNewsNote = marketDayContext.isTradingDay
          ? ''
          : ' 단, 오늘은 휴장일이므로 이 뉴스를 "오늘 이 뉴스로 주가가 움직였다"는 실시간 반응으로 서술하지 말고 "다음 거래일 개장 시 참고할 만한 소식"으로 다루세요.';

        const hasSectorMacroNews = sectorMacroNews.length > 0;
        const newsInstruction = (hasRelevantNews
          ? '위 뉴스는 이 종목과 관련도가 높다고 판단되어 매칭된 실제 기사입니다. mainAnalysis를 작성할 때 반드시 이 뉴스를 근거로 최근 주가 변동 원인을 설명하고, 뉴스에 없는 내용을 지어내지 마세요.'
          : hasSectorMacroNews
            ? '이 종목과 직접 관련된 뉴스는 매칭되지 않았지만, 아래 [업종/시장 배경]에 이 종목이 속한 업종·시장 전체에 영향을 줄 만한 매크로 뉴스가 있습니다. mainAnalysis를 작성할 때 "이 종목만의 뉴스는 없지만 업종 전체가 영향을 받고 있다"는 취지를 밝히고, 그 배경을 근거로 오늘 움직임을 서술하세요 — 이 종목 개별 뉴스가 있는 것처럼 단정하지 마세요.'
            : '관련 뉴스가 매칭되지 않았습니다. 이 경우 뉴스를 근거로 등락 원인을 지어내지 말고, mainAnalysis에 "특별한 뉴스 없이 수급·기술적 요인으로 추정됩니다" 취지의 문구를 명확히 포함해 뉴스 기반 분석이 아니라는 점을 밝히세요.')
          + marketDayNewsNote;

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
        // 더 가까워지도록 tanh로 부드럽게 포화시킨다. 2026-08-11: 이 값은 Claude 응답과
        // 무관하게 항상 서버가 확정하므로 AI 출력 스키마에서도 flowPercentage를 제거했다
        // (lib/streaming-json-fields.ts의 DIAGNOSIS_FIELD_SPECS 주석 참고 — 숫자 리터럴은
        // 파서가 처리 못해 그 이후 필드가 전부 증분 스트리밍에서 멈추는 문제가 있었음).
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

        // ── 내 포지션 (2026-09-01 신설, lib/holding-position.ts 순수 계산) — 매입가 대비·보유 중
        // 고점/저점·최대/최저 평가손익·±15% 변동일·PER 변화(현재 EPS 동일 가정)·보유기간 지수 대비.
        // 결과는 DB(result.holdingPosition)에 저장되고 [내 포지션 데이터] 블록으로 프롬프트에 주입된다
        // (watchPoint는 이 수치만 인용). buyDate가 없으면 최근 1년 폴백이며 basis에 명시된다.
        // 6개월 백필 차트(1일 캐시라 오늘 행이 없거나 장중 스냅샷일 수 있음)에 chartData(1Y, 5분 TTL)의
        // 행을 날짜 기준으로 덮어써 최신 행을 보장한다. 백필이 실패하면 chartData만으로 폴백(≈5개월).
        const chart6m = chart6mResult.status === 'fulfilled' ? chart6mResult.value : [];
        const holdingChart = ((): typeof chartData => {
          if (chart6m.length === 0) return chartData;
          const merged = new Map<string, (typeof chartData)[number]>();
          for (const d of chart6m) merged.set(d.date, d);
          for (const d of chartData) merged.set(d.date, d);
          return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
        })();
        if (chart6m.length === 0) console.warn(`[DIAGNOSIS] ${ticker} 6개월 차트 백필 실패 — 내 포지션은 1Y 차트(${chartData.length}행)로 폴백`);
        const holdingPosition = computeHoldingPosition({
          avgPrice: Number(avgPrice),
          quantity: Number(quantity),
          currentPrice,
          buyDate: buyDate ? String(buyDate).slice(0, 10) : null,
          chart: holdingChart.map((d) => ({ date: d.date, close: d.close, high: d.high, low: d.low })),
          eps: analysisData?.eps && analysisData.eps > 0 ? analysisData.eps : null,
          benchmark,
        });
        const holdingPositionBlock = buildHoldingPositionBlock(holdingPosition);

        // 국내 peer 스파크라인(최근 1개월 상대수익률)용 종가 조회 — sectorPeers는 이미 위에서
        // resolve됐으므로 여기서 병렬로 미리 시작해둔다.
        // 2026-08-11: 예전엔 아래 Claude 호출과 Promise.all로 함께 await했지만(체감 지연
        // 없음 — peer 6개 병렬 조회 실측 ~70ms), 스트리밍 전환으로 Stage0 페이로드에
        // sectorComparison.sparkline을 포함시키려면 Claude 스트림 시작 전에 resolve돼야
        // 한다 — fxDailyPromise와 함께 아래에서 끌어올려 await한다.
        const peerChartsPromise = Promise.allSettled(
          sectorPeers.map((p) => fetchDailyChart(p.ticker, '1M')),
        );

        // ── 그룹 2: 업종 대비 (동종업계 peer 평균 등락률과의 차이) ───────────────────────
        // sectorName·peerNames는 UI가 "어떤 업종/종목과 비교했는지"를 표시하기 위한 것 —
        // sectorNameForMacro(KIS bstp_kor_isnm, 이미 위에서 계산됨)와 sectorPeers(이미 fetch됨)를
        // 그대로 재사용하므로 신규 조회 없음.
        // 2026-09-02: 평일 개장(09:00) 전 생성이면 네이버 peer 등락률·KIS 당일 등락률이 전부 0이라
        // "업종 평균 +0.00% / 차이 +0.00%p"가 나왔다(S-Oil 08:38 실화면). 그 구간엔 위에서 이미 시작한
        // peer 1M 차트와 종목 1Y 차트의 마지막 두 종가로 "전일 마감 기준" 등락률을 계산하고
        // basis='prevClose'·basisDate를 함께 내려 카드·프롬프트가 전일 기준임을 밝힌다(AI 주가 배경
        // 서술이 이미 "어제" 기준이라 일관). 전일 기준 계산이 불가하면(유효 peer 없음) 0.00%를 보여주는
        // 대신 카드를 생략한다(근거 부족 시 생략 관례). 장중·장마감 후는 기존 당일 기준 그대로.
        type SectorComparisonBase = { peerAvgChangeRate: number; deltaVsPeer: number; basis: SectorBasis; basisDate?: string; sectorName?: string; peerNames: string[] };
        let sectorComparisonBase: SectorComparisonBase | null = null;
        let sectorStockChangeRate = changeRate; // 프롬프트에 적는 "이 종목 등락률" — 전일 기준이면 그 기준으로 맞춘다
        if (shouldUsePrevCloseSectorBasis(marketDayContext)) {
          const settled = await peerChartsPromise; // 스파크라인용 조회를 여기서 먼저 소비(추가 호출 없음, ~70ms)
          const prevClose = computeSectorRelativeChangeFromCloses(
            chartData,
            sectorPeers.map((p, i) => ({ peer: p, chart: settled[i]?.status === 'fulfilled' ? settled[i].value : [] })),
          );
          if (prevClose) {
            sectorComparisonBase = {
              peerAvgChangeRate: prevClose.peerAvgChangeRate,
              deltaVsPeer: prevClose.deltaVsPeer,
              basis: 'prevClose',
              basisDate: prevClose.basisDate,
              sectorName: sectorNameForMacro || undefined,
              peerNames: prevClose.peerNames,
            };
            sectorStockChangeRate = prevClose.stockChangeRate;
          }
          console.log(`[DIAGNOSIS] ${ticker} 개장 전 생성 — 업종 대비를 전일(${prevClose?.basisDate ?? '계산 불가'}) 마감 기준으로 계산 (peer ${prevClose?.peerNames.length ?? 0}/${sectorPeers.length})`);
        } else {
          const rawSectorComparison = computeSectorRelativeChange(changeRate, sectorPeers);
          sectorComparisonBase = rawSectorComparison
            ? { ...rawSectorComparison, basis: 'today', sectorName: sectorNameForMacro || undefined, peerNames: sectorPeers.map((p) => p.name) }
            : null;
        }
        const sectorBasisNote = sectorComparisonBase?.basis === 'prevClose'
          ? `[전일 ${sectorComparisonBase.basisDate} 마감 기준 — 개장 전 생성이라 당일 등락률이 아직 없음. sectorNarrative에서 '오늘'이 아니라 '전일(${sectorComparisonBase.basisDate})' 기준임을 명시해 서술할 것] `
          : '';
        const sectorBlock = sectorComparisonBase
          ? `- 벤치마크(참고용 수치 비교, 판단 근거로 쓰지 말 것): ${sectorBasisNote}이 종목 등락률 ${sectorStockChangeRate >= 0 ? '+' : ''}${sectorStockChangeRate}% vs 동종업계 peer 평균 등락률 ${sectorComparisonBase.peerAvgChangeRate >= 0 ? '+' : ''}${sectorComparisonBase.peerAvgChangeRate}% (${sectorComparisonBase.deltaVsPeer >= 0 ? '+' : ''}${sectorComparisonBase.deltaVsPeer}%p 차이)`
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
          : '연간 실적 데이터 없음';
        // 분기 단독 실적(회계연도 누적 차감, lib/kis-api.ts deriveQuarterlyRows) + 전년 동기 대비
        const quarterlyBlock = quarterlyFinancials.length
          ? quarterlyFinancials.map((q) => {
              const parts: string[] = [];
              if (q.revenue !== null) parts.push(`매출액 ${q.revenue.toLocaleString()}억원${q.revenueYoy !== null ? `(전년동기비 ${q.revenueYoy >= 0 ? '+' : ''}${q.revenueYoy}%)` : ''}`);
              if (q.operatingProfit !== null) parts.push(`영업이익 ${q.operatingProfit.toLocaleString()}억원${q.operatingProfitYoy !== null ? `(전년동기비 ${q.operatingProfitYoy >= 0 ? '+' : ''}${q.operatingProfitYoy}%)` : q.operatingProfitTurn ? `(${q.operatingProfitTurn})` : ''}`);
              return `- ${q.label}: ${parts.join(', ') || '데이터 없음'}`;
            }).join('\n') + (financialsYearEndMonth !== '12' ? `\n(${Number(financialsYearEndMonth)}월 결산 기업 — 분기 순번은 회계연도 기준)` : '')
          : '분기 실적 데이터 없음';

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

        // 히스토리 비교 수치는 AI 응답과 무관하게 서버가 이미 갖고 있으므로, narrative만
        // AI 의존 — Stage0에서는 빈 문자열로, Stage1에서 historyNarrative 필드로 채운다.
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

        // ── 4단계: Claude 분석 준비 ────────────────────────────────────────────────
        const resistance = analysisData?.week52High ?? 0;
        const support     = analysisData?.week52Low  ?? 0;
        const benchmarkLine = benchmark
          ? `\n- 벤치마크(참고용 수치 비교, 판단 근거로 쓰지 말 것): 이 종목 수익률 ${benchmark.stockProfitRate >= 0 ? '+' : ''}${benchmark.stockProfitRate}% vs 같은 기간 ${benchmark.indexName} 등락률 ${benchmark.indexChangeRate >= 0 ? '+' : ''}${benchmark.indexChangeRate}% (${benchmark.fromDate}~${benchmark.toDate})`
          : '';

        const prompt = `아래 실제 데이터를 기반으로 관찰된 사실 위주로 정리하여 반드시 JSON만 출력하세요.

## 기준 시각
현재 시각: ${nowKstString()}

## 거래일 상태
${buildMarketDayBlock(marketDayContext)}

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

## 실적 추이
[연간 — 최근 3개년 확정 실적, 잠정치 아님]
${financialsBlock}
[분기 — 최근 분기 단독 실적(누적 차감), 전년 동기 대비]
${quarterlyBlock}

## 내 포지션 데이터 (서버 계산값 — mainAnalysisSections_watchPoint는 이 수치만 사용, 다른 필드에서 인용 금지. 고점/저점은 ${holdingPosition ? holdingPriceBasisLabel(holdingPosition) : '종가 기준'})
${holdingPositionBlock}

## 관련 뉴스 (${hasRelevantNews ? '관련도 높은 기사만 선별' : '매칭 결과'}, ${buildNewsFreshnessLine(relevantNews)})
${newsBlockStr}
${newsInstruction}

## 뉴스 이슈 클러스터링용 전체 목록 (newsIssueClusters 작성 시에만 참고, 인덱스는 0부터)
${newsClusterListBlock}

## 업종/시장 배경 (${sectorNameForMacro || '업종 정보 없음'}, ${buildNewsFreshnessLine(sectorMacroNews)})
※ 위 [관련 뉴스]와는 별개로, 이 종목이 속한 업종·시장 전체에 영향을 줄 만한 매크로 뉴스입니다. 이 종목명이 직접 언급되지 않을 수 있습니다.
${sectorNewsBlockStr}

## 직전 기업분석과의 차이
${historyComparisonBlock}

## 최근 주요 공시 (DART, 최근 14일)
${disclosureBlock}

## 내부 계산 지표 (서버 계산값 — 증권사 앱에는 없는 고유 지표)
- 과거 유사 급등/급락 이력(최근 약 5개월): ${surgeHistoryBlock}
- 거래대금: ${tradingValueBlock}
- 리스크 지표: ${riskMetricsBlock}

분석 포인트:
1. PER/PBR 수준은 mainAnalysisSections_valuationNote에서만 1회 해석 — 다른 필드에서 반복 금지. 52주 위치는 어느 필드에서도 핵심 근거로 쓰지 말 것
2. 외국인·기관 5일 수급 추이 관찰 — flowInsight에서만 방향·의미 해석(background에서 수급 금액 반복 금지)
3. ${isBigMove ? `금일 ${changeRate >= 0 ? '급등' : '급락'}(${changeRate.toFixed(2)}%)의 배경을 위 뉴스 섹션 지침에 따라 mainAnalysisSections_background에서 명확히 서술 (뉴스 근거 vs 수급/기술적 추정 구분)` : '실적·뉴스와 결합하여 업황 및 촉매 요인을 mainAnalysisSections_background에서 관찰'}
4. [내 포지션 데이터]를 mainAnalysisSections_watchPoint에서 '지금 내 위치'로 정리 (매매 전략을 지시하지 말 것, 회복·반등 표현 금지)
5. 수급 동향에서 외국인·기관과 개인의 매매 방향이 서로 반대인지 확인 (반대인 경우에만 그 대립 구도를 flowInsight에 명시)
6. 뉴스 섹션의 논조(긍정/부정)와 실제 주가 흐름(금일 등락률·수익률)이 서로 반대 방향인지 확인 (괴리가 있는 경우에만 mainAnalysisSections_background에서 그 점을 강조)
7. [직전 기업분석과의 차이]를 [직전 진단과의 간격] 지시에 따라 historyNarrative로 해석
8. [내부 계산 지표](급등이력·거래대금 배수·MDD)는 화면에 원자료 카드로 별도 표시되므로 어떤 서술 필드에서도 그 수치를 인용하지 말 것 — riskFactors에 넣는 것도 금지
9. [업종 대비]에 peer 데이터가 있으면 sectorNarrative를, [실적 추이]에 데이터가 있으면 financialsNarrative를, [최근 주요 공시]에 사례가 있으면 disclosureNarrative를 채우세요 — 데이터가 없으면 해당 필드는 빈 문자열로 두고 mainAnalysisSections_* 등 다른 필드에서 억지로 대신 언급하지 마세요. mainAnalysisSections_valuationNote(PER/PBR)와 sectorNarrative(등락률)는 서로 다른 지표이므로 데이터가 있어도 서로 겹치지 않게
${benchmark ? `\n벤치마크(보유기간 ${benchmark.indexName} 대비) 수치는 mainAnalysisSections_watchPoint에서만, 판단 없이 사실 비교로 1회 언급 가능 — background 등 다른 필드에서 인용 금지, "그래서 ~해야 한다"는 연결 금지` : ''}

위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 스키마와 규칙에 따라 정리하세요.`;

        // ── 5단계: Stage0 — peerCharts/fxDaily를 Claude 스트림 시작 전으로 끌어올려
        // await하고, 서버 계산값을 전부 하나의 이벤트로 선송신한다. 2026-08-11 스트리밍
        // 전환의 핵심 — 기업분석에 이미 있던 배당/실적/공시/업종대비/수급강도/서지히스토리는
        // 전부 AI 호출과 무관한 순수 계산값인데, 예전엔 Claude 응답을 기다려야만 함께
        // 보였다. AI 필드는 전부 빈 값으로 미리 채워 DiagnosisResult 타입을 그대로
        // 유지한다(components/diagnosis/DiagnosisReport.tsx가 옵셔널 체이닝을 늘릴 필요
        // 없게) — app/diagnosis/page.tsx가 이 stage0 페이로드로 완전한 형태의 result를
        // 만들고, 이후 field/field-partial 이벤트가 개별 키만 덮어쓴다.
        console.log('[DIAGNOSIS] 4. peer 스파크라인/환율 상관관계 수집');
        const [peerChartsSettled, fxDaily] = await Promise.all([peerChartsPromise, fxDailyPromise]);

        // 국내 peer 스파크라인 계산 — peer 6개(각 1개월 종가)를 첫날 대비 누적%로 정규화한 뒤
        // 평균 내고, 대상 종목은 이미 있는 chartData(1Y 조회)에서 마지막 ~21거래일만 잘라
        // 같은 방식으로 정규화한다(신규 호출 없음). 유효 peer가 없거나 구간이 너무 짧으면
        // null(카드에서 스파크라인만 생략, 나머지 업종 대비 카드는 그대로 표시).
        const sectorSparkline = ((): { dates: string[]; stockReturns: number[]; peerAvgReturns: number[] } | null => {
          if (!sectorComparisonBase) return null;
          const validPeerCharts = peerChartsSettled
            .map((r) => (r.status === 'fulfilled' ? r.value : []))
            .filter((c) => c.length >= 2);
          if (validPeerCharts.length === 0) return null;
          const targetSlice = chartData.slice(-21);
          if (targetSlice.length < 2) return null;
          const n = Math.min(targetSlice.length, ...validPeerCharts.map((c) => c.length));
          if (n < 2) return null;
          const targetWindow = targetSlice.slice(-n);
          const peerWindows  = validPeerCharts.map((c) => c.slice(-n));
          const stockBase = targetWindow[0].close;
          const stockReturns = targetWindow.map((d) => parseFloat((((d.close - stockBase) / stockBase) * 100).toFixed(2)));
          const peerAvgReturns: number[] = [];
          for (let i = 0; i < n; i++) {
            const rates = peerWindows.map((w) => ((w[i].close - w[0].close) / w[0].close) * 100);
            peerAvgReturns.push(parseFloat((rates.reduce((s, r) => s + r, 0) / rates.length).toFixed(2)));
          }
          return { dates: targetWindow.map((d) => d.date), stockReturns, peerAvgReturns };
        })();

        const sectorComparison = sectorComparisonBase
          ? { ...sectorComparisonBase, sparkline: sectorSparkline }
          : null;

        // 환율 상관관계 — 종목 1년 일별 종가(chartData, 이미 있음) vs 환율 1년 일별 종가(fxDaily,
        // 위에서 함께 받음)의 피어슨 상관계수. |r| < 0.3(약한 상관)이거나 표본이 부족하면
        // null로 취급해 카드 자체를 생략한다 — 다른 카드들(sectorComparison 등)과 동일하게
        // "근거 부족하면 생략" 관례.
        const rawFxCorrelation = computeFxCorrelation(chartData, fxDaily);
        const fxCorrelation = isFxCorrelationMeaningful(rawFxCorrelation) ? rawFxCorrelation : null;

        send(controller, {
          type: 'stage0',
          // 서버 계산 수치 — Claude 응답과 무관
          currentPrice:  Math.round(currentPrice),
          avgPrice:      Math.round(Number(avgPrice)),
          quantity:      Number(quantity),
          profitRate:    parseFloat(profitRate.toFixed(2)),
          profitAmount:  Math.round(profitAmount),
          news:          combinedNews,
          newsBasis:     (hasRelevantNews ? 'news' : 'estimated') as 'news' | 'estimated',
          flowType,
          flowPercentage,
          resistance:    Math.round(resistance),
          support:       Math.round(support),
          benchmark,
          isCached:      analysisData?.isCached,
          cachedAt:      analysisData?.cachedAt,
          history:       buildHistory(''), // narrative는 Stage1의 historyNarrative 필드가 채움
          sectorComparison,
          fxCorrelation,
          surgeHistory,        // 서버 계산 — 최근 약 5개월 내 오늘과 유사 규모의 과거 급등/급락 이력 (hasMatches:false면 프론트가 '이력 없음' 빈 상태로 표시, 2026-08-28)
          tradingValueMultiple, // 서버 계산 — 오늘 거래대금의 최근 20거래일 평균 대비 배수 (valid:false면 카드 생략)
          annualFinancials,
          quarterlyFinancials,      // 서버 계산 — 최근 분기 단독 실적(2026-09-01)
          financialsYearEndMonth,   // 결산월('12' 외면 실적 카드가 "N월 결산" 캡션 표시)
          holdingPosition,          // 서버 계산 — 내 포지션 카드(2026-09-01)
          disclosures,
          dividendSummary,
          dividendHistory,
          newsSentiment,
          // AI 필드 — DiagnosisResult 타입을 그대로 만족시키기 위한 빈 값 초기 상태.
          // finalVerdict/shortTermOutlook/midTermOutlook은 undefined로 둬 컴포넌트의
          // 기존 `result.finalVerdict &&` 같은 조건문이 자동으로 "아직 없음"으로 처리하게
          // 한다(사용자가 선택한 설계: finalVerdict는 도착 전까지 스켈레톤 없이 미노출).
          mainAnalysis: '',
          mainAnalysisSections: undefined,
          riskFactors: [] as string[],
          flowInsight: '',
          institutionalFlow: '',
          foreignFlow: '',
          sectorNarrative: '',
          financialsNarrative: '',
          disclosureNarrative: '',
          newsIssueClusters: [] as { label: string; articleIndexes: number[] }[],
          shortTermOutlook: undefined,
          midTermOutlook: undefined,
          finalVerdict: undefined,
        });

        // ── 6단계: Claude 스트리밍 분석 ────────────────────────────────────────────
        send(controller, { type: 'progress', label: 'AI 분석 생성 중...' });
        console.log('[DIAGNOSIS] 5. Claude 분석 시작');

        const sentValues: Record<string, unknown> = {};
        const emitIfChanged = (key: string, value: unknown) => {
          if (JSON.stringify(sentValues[key]) === JSON.stringify(value)) return;
          sentValues[key] = value;
          send(controller, { type: 'field', key, value });
        };

        // fallback 필드 방출 헬퍼 — 기존 buildFallback()과 동일한 값들을 emitIfChanged로
        // 흘려보낸다. Stage0에서 이미 보낸 서버 계산 필드(currentPrice/dividendSummary/
        // annualFinancials/disclosures/sectorComparison/fxCorrelation 등)는 다시 보낼
        // 필요 없음 — AI 전용 필드만 오류 상태로 채운다.
        const rawTextRef = { current: '' };
        const emitFallbackFields = (errReason: string) => {
          emitIfChanged('mainAnalysis', rawTextRef.current.slice(0, 600).trim() || 'AI 분석 결과를 가져오는 중 형식 오류가 발생했습니다.');
          emitIfChanged('flowInsight', '');
          emitIfChanged('institutionalFlow', '응답 형식 오류로 분석 불가');
          emitIfChanged('foreignFlow', '응답 형식 오류로 분석 불가');
          emitIfChanged('riskFactors', ['응답 형식 오류로 리스크 요인 제공 불가']);
          emitIfChanged('newsIssueClusters', []);
          emitIfChanged('historyNarrative', `AI 응답 형식 오류(${errReason})로 히스토리 해석을 가져오지 못했습니다.`);
          emitIfChanged('sectorNarrative', '');
          emitIfChanged('financialsNarrative', '');
          emitIfChanged('disclosureNarrative', '');
        };

        let result: Record<string, unknown> | null = null;
        try {
          const parser = new StreamingFieldParser(DIAGNOSIS_FIELD_SPECS);
          let fullText = '';
          const lastPartialEmitAt: Record<string, number> = {};
          const PARTIAL_THROTTLE_MS = 80; // 종목분석/포트폴리오진단 스트리밍에서 검증된 값

          const claudeStream = claude.messages.stream({
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

          claudeStream.on('text', (delta) => {
            fullText += delta;
            rawTextRef.current = fullText;
            const { fields, partial } = parser.feedWithPartial(delta);
            for (const f of fields) emitIfChanged(f.key, f.value);
            if (partial) {
              const now = Date.now();
              const last = lastPartialEmitAt[partial.key] ?? 0;
              if (now - last >= PARTIAL_THROTTLE_MS) {
                lastPartialEmitAt[partial.key] = now;
                send(controller, { type: 'field-partial', key: partial.key, value: partial.value });
              }
            }
          });

          const message = await claudeStream.finalMessage();
          console.log('[DIAGNOSIS] 6. Claude 응답 수신');
          console.log('[TOKEN_USAGE]', {
            route: 'diagnosis', ticker, hasRelevantNews, hasSectorMacroNews, disclosureCount: disclosures.length,
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
            cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
          });

          const rawText = fullText;
          // 마크다운 코드펜스 제거 후 JSON 추출
          const cleaned   = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

          if (!jsonMatch) {
            console.error('[DIAGNOSIS] JSON 없음, 원문 앞 300자:', rawText.slice(0, 300));
            emitFallbackFields('JSON 없음');
            send(controller, { type: 'stage1-error' });
            send(controller, { type: 'done' });
            return;
          }

          try {
            result = JSON.parse(jsonMatch[0]);
          } catch (e) {
            console.error('[DIAGNOSIS] JSON.parse 실패:', e, jsonMatch[0].slice(0, 300));
            emitFallbackFields('JSON 파싱 실패');
            send(controller, { type: 'stage1-error' });
            send(controller, { type: 'done' });
            return;
          }
        } catch (aiErr) {
          // Claude 호출 자체가 실패(네트워크/타임아웃 등) — Stage0 데이터는 이미 화면에
          // 있으므로 전체를 에러로 무너뜨리지 않고, AI 섹션만 실패로 표시한다.
          console.error('[DIAGNOSIS] Claude 호출 실패:', aiErr);
          emitFallbackFields('AI 호출 실패');
          send(controller, { type: 'stage1-error' });
          send(controller, { type: 'done' });
          return;
        }

        // ── 7단계: 결과 정규화 + 최종 조립 ────────────────────────────────────────
        // 배열 필드 방어적 정규화 (Claude가 string으로 반환할 경우 변환)
        const toArr = (v: unknown): string[] => {
          if (Array.isArray(v)) return (v as unknown[]).map(String).filter(Boolean);
          if (typeof v === 'string' && v)
            return v.split(/\n/).map(s => s.replace(/^[-·•\d]+[.)]\s*/, '').trim()).filter(Boolean);
          return [];
        };

        const toStr = (v: unknown): string => typeof v === 'string' ? v : '';
        const stripChoiceLabels = (t: string): string => t.replace(/\(\s*[abc]\s*\)\s*/g, '').replace(/\s{2,}/g, ' ').trim();

        // newsIssueClusters 정규화 — combinedNews 인덱스 범위를 벗어나거나 형식이 어긋난
        // 항목은 버린다. 모델이 일부 기사를 어느 클러스터에도 안 넣었을 수 있는데(전체
        // 커버 강제는 안 시켰음), 남은 기사는 프론트가 "기타" 묶음으로 자동 처리한다.
        const toNewsIssueClusters = (v: unknown): { label: string; articleIndexes: number[] }[] => {
          if (!Array.isArray(v)) return [];
          return v
            .map((c) => {
              if (!c || typeof c !== 'object') return null;
              const label = typeof (c as Record<string, unknown>).label === 'string'
                ? (c as Record<string, unknown>).label as string : '';
              const rawIndexes = (c as Record<string, unknown>).articleIndexes;
              const articleIndexes = Array.isArray(rawIndexes)
                ? rawIndexes.filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < combinedNews.length)
                : [];
              return label && articleIndexes.length > 0 ? { label, articleIndexes } : null;
            })
            .filter((c): c is { label: string; articleIndexes: number[] } => c !== null);
        };

        // mainAnalysisSections_background/flowSummary/valuationNote/watchPoint 정규화.
        // 2026-08-12: 타이핑 효과를 위해 하나의 'json' 필드였던 mainAnalysisSections를
        // 4개의 독립 top-level 'string' 필드로 스키마 분리(lib/streaming-json-fields.ts
        // DIAGNOSIS_FIELD_SPECS 참고) — 여기서 다시 하나의 객체로 재조립해 과거
        // mainAnalysis(단일 문자열) 소비처(공유페이지 DiagnosisView, ShareDropdown의
        // description 슬라이스)와 DB 저장 포맷을 그대로 유지한다(토큰 절약을 위해
        // AI에게 flat 문자열을 별도로 다시 쓰게 하지 않고 서버가 4개 조각을 이어붙임).
        // 2026-09-01: flowSummary(수급 소제목) 삭제 — 수급 해석은 flowInsight(기관/외국인 카드) 1곳.
        const rawBackground    = result!.mainAnalysisSections_background;
        const rawValuationNote = result!.mainAnalysisSections_valuationNote;
        const rawWatchPoint    = result!.mainAnalysisSections_watchPoint;
        const mainAnalysisSections = (rawBackground !== undefined || rawValuationNote !== undefined || rawWatchPoint !== undefined)
          ? {
              background:    toStr(rawBackground),
              valuationNote: toStr(rawValuationNote),
              watchPoint:    toStr(rawWatchPoint),
            }
          : null;
        const mainAnalysis = mainAnalysisSections
          ? [mainAnalysisSections.background, mainAnalysisSections.valuationNote, mainAnalysisSections.watchPoint]
              .filter(Boolean).join(' ')
          : toStr(result!.mainAnalysis); // 구 스키마 응답 대비 폴백

        const historyNarrative = typeof result!.historyNarrative === 'string' && result!.historyNarrative
          ? result!.historyNarrative
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
          newsIssueClusters: hasRelevantNews ? toNewsIssueClusters(result!.newsIssueClusters) : [],
          flowType,
          flowPercentage,
          resistance:    Math.round(resistance), // AI가 산출하지 않고 실제 52주 고가를 그대로 사용
          support:       Math.round(support),    // AI가 산출하지 않고 실제 52주 저가를 그대로 사용
          benchmark,     // 서버 계산 — KOSPI/KOSDAQ 등락률 비교 (매수일 있을 때만)
          isCached:      analysisData?.isCached, // 휴장일 등 실시간 조회 실패 시 마지막 거래일 기준 값
          cachedAt:      analysisData?.cachedAt,
          history:       buildHistory(historyNarrative), // 서버 계산 델타 + AI 해석 (직전 진단 대비)
          sectorComparison,   // 서버 계산 — peer 평균 등락률과의 차이 (동종업계 없으면 null)
          fxCorrelation,      // 서버 계산 — 최근 1년 원/달러 환율과의 피어슨 상관계수 (|r|<0.3이거나 표본 부족이면 null)
          surgeHistory,        // 서버 계산 — 최근 약 5개월 내 오늘과 유사 규모의 과거 급등/급락 이력 (hasMatches:false면 프론트가 '이력 없음' 빈 상태로 표시, 2026-08-28)
          tradingValueMultiple, // 서버 계산 — 오늘 거래대금의 최근 20거래일 평균 대비 배수 (valid:false면 카드 생략)
          annualFinancials,   // 서버 계산 — 최근 3개년 확정 연간 실적 (없으면 빈 배열)
          quarterlyFinancials, // 서버 계산 — 최근 분기 단독 실적(누적 차감)·전년동기비 (없으면 빈 배열, 2026-09-01)
          financialsYearEndMonth, // 결산월
          holdingPosition,    // 서버 계산 — 내 포지션(lib/holding-position.ts, 2026-09-01)
          disclosures,        // 서버 계산 — DART 최근 14일 주요 공시 (없으면 빈 배열, UI는 있을 때만 강조 카드)
          dividendSummary,    // 서버 계산 — DART 최신 사업연도 배당 요약 (무배당이면 null)
          dividendHistory,    // 서버 계산 — KIS 최근 5년 배당 지급 이력 (없으면 빈 배열)
          // Claude 응답 필드 (정규화)
          mainAnalysis:         mainAnalysis,             // 4개 섹션을 이어붙인 값(과거 소비처 호환) — 신 스키마 응답이면 항상 이 값
          mainAnalysisSections: mainAnalysisSections ?? undefined, // 있으면 프론트가 소제목 렌더링, 없으면(과거 레코드/폴백) mainAnalysis 문자열로 폴백
          riskFactors:        toArr(result!.riskFactors),
          flowInsight:        typeof result!.flowInsight       === 'string' ? result!.flowInsight       : '',
          // 카드가 '기관'/'외국인' 라벨을 직접 붙이므로 AI가 넣은 주어 접두어는 저장 전에 뗀다(2026-09-02)
          institutionalFlow:  typeof result!.institutionalFlow === 'string' ? stripFlowSubject(result!.institutionalFlow) : '',
          foreignFlow:        typeof result!.foreignFlow       === 'string' ? stripFlowSubject(result!.foreignFlow)       : '',
          shortTermOutlook:   typeof result!.shortTermOutlook  === 'string' ? result!.shortTermOutlook  : undefined,
          midTermOutlook:     typeof result!.midTermOutlook    === 'string' ? result!.midTermOutlook    : undefined,
          // 2026-09-01 실측: 프롬프트의 선택지 기호 "(a)/(b)/(c)"가 문장에 그대로 새어 나오고(삼성전자
          // "(a) 타당한 수준… (a) 과도한 프리미엄"처럼 기호가 뒤섞이기도 함) 사용자에겐 무의미하므로
          // 저장·재전송 전에 제거한다(스트리밍 중 잠깐 보였더라도 정합성 보정 전송이 덮어씀).
          finalVerdict:       typeof result!.finalVerdict      === 'string' ? stripChoiceLabels(result!.finalVerdict) : undefined,
          sectorNarrative:     sectorComparison ? (typeof result!.sectorNarrative === 'string' ? result!.sectorNarrative : '') : '',
          financialsNarrative: (annualFinancials.length > 0 || quarterlyFinancials.length > 0) ? (typeof result!.financialsNarrative === 'string' ? result!.financialsNarrative : '') : '',
          disclosureNarrative: disclosures.length > 0 ? (typeof result!.disclosureNarrative === 'string' ? result!.disclosureNarrative : '') : '',
        };

        // 정합성 보정 — 증분 파서가 놓쳤거나 다르게 뽑았어도, 전체 재파싱+정규화를 거친
        // finalResult 값으로 한 번 더 통지해 최종 정확성을 보장한다(emitIfChanged가
        // 이미 같은 값이면 중복 전송을 알아서 억제). historyNarrative는 finalResult에서
        // history.narrative로 중첩돼 있으므로 별도로 꺼내 top-level 키로 되돌려 보낸다
        // (프론트 applyDiagnosisField가 다시 history.narrative로 매핑). mainAnalysisSections도
        // 마찬가지로 finalResult에서는 재조립된 객체 형태지만, DIAGNOSIS_FIELD_SPECS는
        // 4개의 flat 키로 도는 루프이므로 여기서도 4개로 다시 풀어서 넣어야 한다.
        const reconcileValues: Record<string, unknown> = {
          mainAnalysisSections_background:    finalResult.mainAnalysisSections?.background,
          mainAnalysisSections_valuationNote: finalResult.mainAnalysisSections?.valuationNote,
          mainAnalysisSections_watchPoint:    finalResult.mainAnalysisSections?.watchPoint,
          historyNarrative:     finalResult.history.narrative,
          sectorNarrative:      finalResult.sectorNarrative,
          financialsNarrative:  finalResult.financialsNarrative,
          disclosureNarrative:  finalResult.disclosureNarrative,
          riskFactors:          finalResult.riskFactors,
          flowInsight:          finalResult.flowInsight,
          institutionalFlow:    finalResult.institutionalFlow,
          foreignFlow:          finalResult.foreignFlow,
          shortTermOutlook:     finalResult.shortTermOutlook,
          midTermOutlook:       finalResult.midTermOutlook,
          finalVerdict:         finalResult.finalVerdict,
          newsIssueClusters:    finalResult.newsIssueClusters,
        };
        for (const spec of DIAGNOSIS_FIELD_SPECS) {
          if (spec.emit) emitIfChanged(spec.key, reconcileValues[spec.key]);
        }

        // 시간적 사실관계 사후 검증 — 이 라우트는 실패 시 fallback으로 이미 복구 경로가
        // 얽혀 있어 자동 재생성은 붙이지 않고(비용/복잡도 판단), 불일치만 로그로 남겨 모니터링한다.
        const diagnosisReportText = [
          finalResult.mainAnalysis, ...finalResult.riskFactors, finalResult.history.narrative, finalResult.flowInsight,
          finalResult.shortTermOutlook, finalResult.midTermOutlook, finalResult.finalVerdict,
          finalResult.sectorNarrative, finalResult.financialsNarrative, finalResult.disclosureNarrative,
        ].filter(Boolean).join(' ');
        const diagnosisNewsText = combinedNews.map((n) => `${n.title} ${n.description}`).join(' ')
          + ' ' + sectorMacroNews.map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
        const temporalCheck = checkTemporalConsistency(diagnosisReportText, diagnosisNewsText);
        if (temporalCheck.flagged) {
          console.warn('[DIAGNOSIS] 시간적 사실관계 불일치 감지 (재생성 없음, 모니터링용):', temporalCheck);
        }
        // 컴플라이언스 금지어 사후 검사(lib/ai-compliance.ts scanComplianceViolations) —
        // 이 라우트도 위 temporalCheck와 같은 이유로 재생성은 붙이지 않고 로그만 남긴다.
        const complianceHits = scanComplianceViolations(diagnosisReportText);
        if (complianceHits.length > 0) {
          console.error('[DIAGNOSIS] 컴플라이언스 금지어 감지 (재생성 없음, 모니터링 필요):', complianceHits);
        }

        // DB 저장 (실패해도 결과 반환) — JSON 파싱에 성공했을 때만 저장(기존과 동일 조건,
        // fallback 경로는 위에서 이미 return해 여기 도달하지 않음). 2026-08-11: 클라이언트
        // 연결 상태와 완전히 분리하기 위해 next/server의 after()로 감쌌다 — 종목분석
        // (app/api/stock/[ticker]/analysis/route.ts)이 이미 같은 이유로 쓰고 있는 검증된
        // 패턴("응답 직후 실행 컨텍스트가 얼어붙어 저장이 끊기는 문제 방지")과 일관성을
        // 맞춘 것. done 전송은 저장 완료를 기다리지 않지만, 클라이언트는 원래도 저장
        // 성공 여부와 무관하게 done만 보고 화면을 마무리하므로 사용자 경험 변화는 없다.
        after(async () => {
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
            console.log(`[DIAGNOSIS] 7. DB 저장 완료${usedCredit ? ' (1회권 사용)' : ''}`);
          } catch (dbErr) {
            console.error('[DIAGNOSIS] DB 저장 실패 (결과는 반환):', dbErr);
          }
        });

        send(controller, { type: 'done' });
      } catch (e) {
        console.error('[DIAGNOSIS] 최상위 예외:', e);
        try { send(controller, { type: 'error', message: 'AI 분석 생성 실패' }); } catch { /* 클라이언트가 이미 끊었으면 무시 */ }
      } finally {
        try { controller.close(); } catch { /* 이미 취소된 스트림이면 무시 */ }
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
