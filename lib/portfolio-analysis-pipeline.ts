// 2026-08-12 대시보드 신설을 계기로 app/api/portfolio-diagnosis/route.ts의 Stage1(종목별
// 개별 분석)·Stage2(포트폴리오 종합 분석) 스트리밍 로직을 공용 모듈로 추출. 대시보드
// AI분석(app/api/dashboard/analysis/route.ts)이 "매번 입력한 holdings" 대신 "DB에 저장된
// holdings"를 입력 소스로 쓸 뿐, 프롬프트·스트리밍·정합성보정 로직은 완전히 동일해야
// 하므로 이 파일 하나를 두 라우트가 함께 import한다(프롬프트 드리프트 방지가 핵심 목적).
//
// 이 파일에 포함된 것: Stage1/Stage2 실행 함수, 그 둘이 직접 의존하는 프롬프트 상수·타입·
// 순수 헬퍼 함수. Stage0(가격/뉴스/차트 등 원시 데이터 수집·인증·요금제·DB 저장)는 각
// 라우트의 비즈니스 맥락(입력 소스·DB 테이블·과금 모델)이 서로 달라 의도적으로 포함하지
// 않았다 — app/api/portfolio-diagnosis/route.ts, app/api/dashboard/analysis/route.ts 참고.
import Anthropic from '@anthropic-ai/sdk';
import { COMPLIANCE_PRINCIPLE, clampSignal, scanComplianceViolations, type Signal } from '@/lib/ai-compliance';
import { buildInvestorBlock, type StockAnalysisData } from '@/lib/stock-analysis-data';
import type { DartDividendSummary } from '@/lib/dart-api';
import type { DividendHistoryRow } from '@/lib/kis-api';
import type { NewsCandidate } from '@/lib/news-selection';
import type { ChartDataPoint } from '@/lib/types';
import { toDailyReturns, correlateReturnMaps } from '@/lib/fx-correlation';
import {
  nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, MARKET_DAY_GROUNDING_INSTRUCTION,
  checkTemporalConsistency, daysBetween,
} from '@/lib/ai-grounding';
import { buildMarketDayBlock, type MarketDayContext } from '@/lib/market-day-context';
import { StreamingFieldParser, PORTFOLIO_STOCK_FIELD_SPECS, PORTFOLIO_SUMMARY_FIELD_SPECS, PORTFOLIO_SUMMARY_FIELD_SPECS_DASHBOARD } from '@/lib/streaming-json-fields';

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// 2026-08-04 트레이딩 뉘앙스 순화 — "공매도"처럼 매매기법을 직접 지목하거나 "급락"/"급등"처럼
// 가격 움직임의 폭·속도 자체를 강조하는 표현이 컴플라이언스 원칙(COMPLIANCE_PRINCIPLE)의
// 매수/매도 단어 금지만으로는 다 걸러지지 않아 별도 지시 추가. STOCK_SIGNAL_SYSTEM·
// PORTFOLIO_SUMMARY_SYSTEM 양쪽에 공유.
const WORDING_SOFTENING_PRINCIPLE = '"공매도"·"숏"처럼 특정 매매기법을 직접 지목하는 표현은 쓰지 말고, 그로 인해 관찰되는 수급 결과(예: "외국인·기관 자금 이탈 우려", "차입 매도 성격의 수급 공백")로 바꿔 쓰세요. 가격 움직임을 "급락"/"급등"처럼 폭·속도 자체로 강조하는 표현도 피하고, 그 움직임을 유발한 비즈니스 본질에 초점을 맞추세요(예: "급락" → "실적 불확실성 해소 여부"·"펀더멘털 압박 요인", "급등" → "밸류에이션 부담 해소" 등 문맥에 맞는 표현으로). 단, [참고 - 과거 유사 급등락 이력]처럼 이미 제공된 데이터 레이블 자체를 바꾸라는 뜻은 아닙니다.';

const STOCK_SIGNAL_SYSTEM = `${COMPLIANCE_PRINCIPLE} ${WORDING_SOFTENING_PRINCIPLE} 한국주식 데이터를 뉴스·수급·밸류에이션 관점에서 종합 해석하는 애널리스트입니다. 뉴스가 있으면 그 배경("왜 이런 뉴스가 나왔는지")까지 파고들어 설명하고, 없으면 수급·기술적 요인으로만 설명하며 뉴스를 지어내지 마세요. 사실 나열이 아니라 해석을 담으세요. JSON만 출력. reason 작성 시 종목명 사용, 숫자 종목코드 출력 금지.`;

const STOCK_SIGNAL_INSTRUCTIONS = `다음 한국 주식의 관찰된 데이터를 분석하고 JSON만 출력하세요.

{"ticker":"<종목코드>","signal":"순유입 우위"|"중립·관망"|"차익실현 관찰"|"순유출 우위","reason":"【최대 180자, 절대 넘기지 말 것 — 1~2문장】오늘 이 종목에서 가장 중요한 관찰 사실 1개(뉴스·수급·거래대금·과거 이력 중 가장 유의미한 것 하나만 선택, 여러 개를 욱여넣지 말 것)와 그 사실이 왜 유의미한지 판단 1구절","sector":"실제업종명"}

signal은 매매 지시가 아니라 현재 수급·가격 패턴에 대한 관찰 결과입니다 — 외국인·기관의 순매수 자금 유입이 우위면 "순유입 우위", 순매도로 자금이 빠져나가는 흐름이 우위면 "순유출 우위", 수익률이 높고 밸류에이션 부담이 겹쳐 차익실현 패턴이 관찰되면 "차익실현 관찰", 그 외에는 "중립·관망"을 선택하세요. 뉴스 기사 제목에 "목표가"라는 단어가 있어도 reason에서는 그 단어를 그대로 쓰지 말고 "영업이익 추정치 상향" 같은 실적 전망치 표현으로만 언급하세요.
- 관련 뉴스가 주어지면 최우선으로 그 뉴스를 고르되, 제목만 스치듯 언급하지 말고 "누가/무엇을/왜"가 드러나게 압축하고 오늘 수급과 연결되는지까지 짧게 판단하세요.
- 이 종목만의 뉴스는 없지만 업종 배경이 주어지면, 그 배경을 근거로 삼되 "이 종목만의 뉴스는 없지만 업종 전체가 영향받고 있다"는 취지로만 짧게 쓰세요 — 종목 개별 뉴스가 있는 것처럼 단정 금지.
- 뉴스도 업종 배경도 없으면 거래대금·과거 급등락 이력 중 더 근거가 뚜렷한 쪽 하나로 판단을 채우세요.
아래에 주어지는 실제 종목 데이터를 분석 대상으로 삼아, 응답의 "ticker" 필드에는 위 플레이스홀더 대신 그 종목의 실제 코드를 채워 넣으세요. ${TEMPORAL_GROUNDING_INSTRUCTION}`;

const PORTFOLIO_SUMMARY_SYSTEM = `${COMPLIANCE_PRINCIPLE} ${WORDING_SOFTENING_PRINCIPLE} 한국주식 포트폴리오를 섹터·수급·뉴스 관점에서 종합 해석하는 애널리스트입니다. 이 리포트는 fpark의 핵심 유료 콘텐츠입니다 — 사실을 나열하는 데 그치지 말고, 왜 그런 결과가 나왔는지에 대한 판단과 해석을 반드시 포함하세요. 같은 날 만들어지는 개별 기업분석 리포트와 동등하거나 더 깊은 수준이어야 합니다. 숫자(PER·수급 등) 근거와 실제 뉴스 이슈의 배경까지 함께 담아 설명하되, 무엇을 하라고 지시하지 마세요. JSON만 출력. 종목 언급 시 반드시 종목명 사용, 종목코드(숫자 6자리) 출력 금지.`;

// 2026-09-01 포트폴리오분석 AI 종합평가 재설계 — "구조적 배경/뉴스 해석/과거 유사 이력/종합 판단"
// 4소제목이 사실상 뉴스 해설로 채워져 "내 포트폴리오를 분석한 것 같지 않다"는 문제 대응.
// 서버가 이미 계산한 정량 지표([포트폴리오 구조 데이터] 블록 — lib/portfolio-structure-facts.ts)를
// 그대로 인용해 '구조'를 서술하도록 소제목 자체를 포트폴리오 구조/집중·분산도/손익 기여 구조/
// 종합 판단으로 바꿨다. 뉴스는 종합 판단에서 구조 서술을 뒷받침하는 최소한의 배경으로만.
// "직전 진단 대비"(historyNarrative)는 포트폴리오에서 제거 — 종목 구성이 자주 바뀌어 비교가
// 무의미한 경우가 많았고(AI가 "비교 자체가 의미 없다"고 쓰는 상황까지 발생), 시간축 맥락은
// "기간별 평가금액 변동" 카드가 이미 담당한다. 대시보드 경로(_DASHBOARD)는 옛 구조 유지.
const PORTFOLIO_SUMMARY_SYSTEM_STRUCTURE = `${COMPLIANCE_PRINCIPLE} ${WORDING_SOFTENING_PRINCIPLE} 한국주식 포트폴리오를 '구성 구조' — 종목별 평가금액 비중, 섹터 집중도(HHI·실효 업종 수), 종목 간 상관계수, 변동성 기여도, 매입가 대비 손익 구조 — 관점에서 해석하는 애널리스트입니다. 이 리포트는 fpark의 핵심 유료 콘텐츠입니다. 사용자가 알고 싶은 것은 '오늘 어떤 뉴스가 있었는지'가 아니라 '내 포트폴리오가 어떤 구조이고, 그 구조 때문에 손익이 어떻게 만들어지고 있는지'입니다. 따라서 summarySections_* 4개 필드는 반드시 [포트폴리오 구조 데이터]에 제공된 수치(비중 %, 섹터 %, HHI·실효 업종 수, 상관계수, 변동성 기여도 %, 손익 비율 %)를 문장 안에 직접 인용해 서술하고, 그 수치를 임의로 다시 계산하거나 바꿔 쓰지 마세요. 뉴스·수급은 summarySections_judgment에서 구조 서술을 뒷받침하는 최소한의 배경(한 구절 이내)으로만 언급하고, 구조 서술 3개 필드에서는 뉴스를 언급하지 마세요. 사실을 나열하는 데 그치지 말고 그 구조가 무엇을 의미하는지(어떤 이벤트에 얼마나 노출되는지, 분산이 실제로 작동하는지, 손익이 어디에서 결정되는지)까지 판단하되, 비중을 줄이라/늘리라/조정하라/정리하라/분산하라는 리밸런싱·매매 제안은 절대 하지 마세요 — "이런 구조다/이런 비중이다/그래서 이런 성격의 노출이 있다"는 관찰과 의미 해석까지만 하고, 그 다음 행동은 사용자의 몫으로 남기세요. JSON만 출력. 종목 언급 시 반드시 종목명 사용, 종목코드(숫자 6자리) 출력 금지.`;

const PORTFOLIO_SUMMARY_INSTRUCTIONS_DIAGNOSIS = `{"summarySections_structure":"【2~3문장, 필수】[포트폴리오 구조 데이터]만을 근거로 이 포트폴리오가 '어떻게 생겼는지'를 서술 — 종목 수, 평가금액 기준 상위 비중 종목과 그 비중(%), 섹터 구성(어느 섹터가 몇 %를 차지하는지), 그리고 현재 손익 상태의 큰 그림(몇 종목이 손실/이익 구간인지). 제공된 비중 %·섹터 % 수치를 문장 안에 직접 인용할 것. 뉴스·수급·오늘 등락 언급 금지(뉴스 배경은 summarySections_judgment의 몫, 오늘 등락 기여는 contributionNarrative의 몫). 총수익률·총평가손익 숫자는 상단 카드에 이미 표시되므로 반복 금지. 예) '4종목 중 반도체 2종목(삼성전자 45.0%, SK하이닉스 20.0%)이 평가금액의 65%를 차지하고, 자동차·IT 서비스가 각각 25%·10%를 나눠 갖는 구조로, 4종목 중 3종목이 매입가 대비 손실 구간에 있다.'","summarySections_concentration":"【2~3문장, 정량 지표(섹터 집중도·상관계수·변동성 기여도) 중 하나라도 제공됐을 때만 — 전부 '계산 안 함'이면 빈 문자열 \\"\\"】섹터 집중도(HHI·실효 업종 수·등급), 종목 간 상관계수(동조화 강도), 변동성 기여도(어느 종목이 전체 변동성의 몇 %를 차지하는지, 같은 섹터 합산이면 몇 %)를 서로 연결해 '분산이 실제로 작동하는 구조인지'를 판단하세요. 수치 직접 인용 필수. 예) '삼성전자가 변동성 기여도의 30.9%를 차지하고 반도체 2종목 합산으로는 65%에 이르며, 실효 업종 수 2.0개(명목 3개)·상관계수 0.72라는 수치가 말해주듯 종목은 4개지만 사실상 단일 섹터에 가까운 구조로, 반도체 업황 하나에 포트폴리오 전체가 같은 방향으로 노출돼 있다.' 비중을 줄이라/늘리라/조정하라는 제안 절대 금지 — 구조가 이렇다는 관찰과 그 구조의 의미(특정 섹터 이벤트에 얼마나 노출되는지, 분산 효과가 어느 정도인지)까지만.","summarySections_pnlStructure":"【2~3문장, 필수】[포트폴리오 구조 데이터]의 종목별 손익률·평가손익과 손익 구조 집계를 근거로 '손익이 어디서 만들어지고 있는지'를 서술 — 몇 종목이 손실/이익 구간인지, 손실(또는 이익)의 대부분이 어느 종목·섹터에서 나오는지(전체 손실/이익 중 비율 %), 비중이 큰 종목과 손익이 큰 종목이 일치하는지(일치하면 '비중이 손익을 좌우하는 구조', 불일치하면 '비중은 작지만 손익 변동이 큰 종목이 있는 구조'). 예) '4종목 중 3종목이 손실 구간이며, 그중 반도체 2종목의 손실이 전체 손실의 87.5%를 차지해 손익 구조 역시 섹터 집중을 그대로 반영하고 있다. 비중 1위인 삼성전자가 손실 절대액에서도 1위라 포트폴리오 성과는 사실상 이 한 종목의 방향에 좌우되는 셈이다.' 오늘 하루 등락(contributionNarrative의 몫)과 구분해 '매입가 대비 누적 손익' 관점으로만 서술. 매도/손절/비중 조정 제안 절대 금지, 미래 손익 예측 금지.","summarySections_judgment":"【1~2문장, 판단형(필수)】위 세 구조 서술을 하나의 스탠스로 종합 — 이 포트폴리오의 현재 성과가 '구조(집중·동조화·비중)'에서 비롯되는지 '개별 종목 이슈'에서 비롯되는지를 판단하세요. 뉴스·수급은 이 판단을 뒷받침하는 최소한의 배경으로만 한 구절 이내 언급 가능(예: '반도체 업황 뉴스가 오늘 움직임의 배경이긴 하지만, 성과를 좌우하는 건 뉴스보다 65%에 달하는 섹터 집중 구조 쪽이다'). 이 필드는 앞선 필드들에서 이미 내린 '판단'을 교차 종합하는 자리이므로 '겹치는 내용 반복 금지' 규칙의 예외지만, 수치·사실을 새로 나열하지 말고 판단만 연결하세요. 벤치마크·오늘 손익 기여도 수치는 별도 필드가 있으니 여기서 언급 금지. 미래 가격·수익률 예측 금지, 비중 조정·매매 제안 금지.","riskFactors":[{"text":"포트폴리오 전체 관점의 리스크 요인1(수치 포함, 손실 종목 비중·섹터 과집중·변동성 기여 편중·상관계수 등 [포트폴리오 구조 데이터] 근거)","category":"macro"|"company"},{"text":"요인2","category":"macro"|"company"},{"text":"요인3","category":"macro"|"company"}],"opportunityFactors":["포트폴리오 전체 관점에서 관찰 가능한 긍정적 데이터 포인트 1~3개(수치·근거 포함, riskFactors와 동일 형식) — 이미 본문(종목별 문단·summarySections_*)에 나온 개별 사실을 그대로 복사하지 말고, 포트폴리오 관점에서 종합해 새롭게 서술. 예) 'DL이앤씨와 종근당 모두 외국인·기관의 자금 유입이 관찰되는데, 이는 반도체 업황 심리 위축과 달리 개별 밸류에이션 매력에 반응하는 흐름으로 풀이됩니다.' 뚜렷한 긍정 신호가 없으면 억지로 지어내지 말고 [\\"현재 뚜렷한 긍정 신호가 부족합니다\\"] 하나만 반환하거나 1~2개로 줄여도 됨"],"contributionNarrative":"【[오늘 손익 기여도]에 제공된 상위 기여 종목을 근거로 1~2문장 — 구체적 금액은 화면에 이미 별도로 표시되므로 여기서는 숫자를 반복하지 말고(금액을 다시 옮겨 적지 말 것) 어떤 종목이 왜 기여했는지 의미 위주로만 서술, 그 종목의 [종목별 개별 관찰] reason과 같은 문장을 반복하지 말 것】예) '오늘 포트폴리오 평가손익 변화는 대부분 종근당 하락에서 발생했습니다.' 매매 권유가 아니라 순수 관찰 서술, 데이터가 없으면 빈 문자열","holdingPeriodNarrative":"【[보유 기간 비교]에 데이터가 있을 때만 1문장 — 없으면 빈 문자열】구체적 수익률 수치는 화면에 별도 표시되므로 여기서는 편입 시점에 따라 성과가 왜 갈렸는지(업황 변화, 편입 시점의 가격 수준 등) 해석 위주로. 편입 타이밍을 지시하거나 '그래서 지금 사야 한다'는 식으로 연결 금지","coMovementNarrative":"【[섹터 동조화 관찰 데이터]에 상관계수 수치 또는 사례가 있을 때만 1~2문장 — 둘 다 없으면 빈 문자열】summarySections_concentration이 '구조(분산이 작동하는지)'를 다뤘다면, 여기서는 '오늘 실제로 같은 방향으로 움직였는지'라는 당일 관찰에 집중하세요 — 상관계수 수치를 근거로 삼되 concentration과 같은 문장을 반복하지 말고, 오늘의 동조화 사례가 있으면 그 사실과 왜 그런 동조화가 생겼는지(개별 재료보다 업종 심리가 더 강하게 작용했는지 등)를 서술. 각 종목의 개별 이슈(이미 [종목별 개별 관찰] reason에 있음)를 다시 설명하지 말 것.","shortTermOutlook":"【최대 100자, 절대 넘기지 말 것 — 반드시 1문장】포트폴리오 '구조' 관점의 단기 관찰 변수 — 종목 나열 금지, 섹터 비중이 가장 큰 구조로 인해 어떤 단기 이벤트에 노출돼 있는지 사실 1개 + 그것이 왜 지켜볼 가치가 있는지 1구절. 예) '반도체 섹터가 65%를 차지하는 구조상, 다음 주 메모리 가격·실적 발표 결과가 포트폴리오 전체에 영향을 줄 수 있어 지켜볼 변수다.' '수익률이 갈릴 수 있다'/'상승·하락 여력' 같이 가격을 예측하는 표현 절대 금지","midTermOutlook":"【최대 120자, 절대 넘기지 말 것 — 반드시 1문장】포트폴리오 '구조' 관점의 중기 관찰 변수 — 종목 나열 금지, 괄호로 부연 수치를 나열하지 말 것, 섹터 편중·구성 특성에서 비롯되는 중기 취약점/기회 사실 1개 + 그것이 왜 지켜볼 가치가 있는지 1구절만 짧게, 가격 방향·수익률 예측 절대 금지"}

위 JSON 스키마를 반드시 준수하세요. summarySections_structure/concentration/pnlStructure/judgment 4개 필드는 반드시 포함되어야 합니다(summarySections_concentration은 정량 지표가 전부 '계산 안 함'일 때만 빈 문자열 허용, 나머지 3개는 필수).
규칙:
- JSON 키 순서 및 구조 변경 금지
- summarySections_structure/concentration/pnlStructure는 [포트폴리오 구조 데이터]의 수치를 반드시 직접 인용하고, 제공되지 않은 수치를 지어내거나 제공된 수치를 다시 계산해 다른 값으로 쓰지 마세요
- "비중을 줄이세요/조정하세요/분산하세요/정리하세요/편입하세요" 같은 리밸런싱·매매 제안 문장은 어떤 필드에서도 절대 금지 — "이런 구조다/이런 비중이다/그래서 이런 성격의 노출이 있다"는 관찰과 의미 해석까지만 서술하고, 그 다음 행동은 사용자의 판단으로 남기세요
- riskFactors는 개별 종목이 아니라 포트폴리오 전체 구조(손실 비중·섹터 편중·변동성 기여 편중·동조화)를 보는 관점으로 작성하세요
- riskFactors[].category는 그 요인의 성격에 따라 "macro"(업종 전체 심리·거시 환경·섹터 공통 이슈처럼 개별 종목을 넘어선 요인) 또는 "company"(특정 종목의 손실 비중·개별 변동성·그 종목만의 이슈처럼 종목 단위 요인) 중 하나로만 판정하세요 — 두 성격이 섞인 요인이면 더 근본적인 원인 쪽으로 판정
- opportunityFactors는 riskFactors와 동일한 컴플라이언스 원칙이 적용됩니다 — "매수 신호"·"지금이 기회"처럼 투자를 유인하는 표현이 아니라 어디까지나 "관찰 가능한 긍정적 데이터 포인트" 수준으로 서술하세요. 목표가·추천·"상승 여력" 같은 표현 절대 금지
- shortTermOutlook/midTermOutlook은 반드시 "이 포트폴리오 구조가~" 식으로 시작하는 상위 종합 문장이어야 하며, "삼성전자는 ~, SK하이닉스는 ~" 식으로 종목을 순서대로 나열하는 문장은 금지입니다. 목표가·손절가·매매 지시·저항선·지지선·가격 방향 예측 금지 — 관찰된 사실만 서술하고 그 사실이 앞으로 수익률에 어떤 영향을 줄지 예측하지 마세요
- 뉴스가 없는 종목에 대해 뉴스를 지어내지 마세요. 뉴스는 summarySections_judgment·riskFactors·opportunityFactors·contributionNarrative에서만 근거로 쓸 수 있고, summarySections_structure/concentration/pnlStructure에서는 언급하지 마세요
- 벤치마크 수치는 별도 카드로 이미 표시되므로 어디에서도 다시 언급하지 마세요
- summarySections_structure/concentration/pnlStructure/judgment 각 필드·riskFactors·opportunityFactors·contributionNarrative·holdingPeriodNarrative·coMovementNarrative·shortTermOutlook·midTermOutlook은 서로 같은 사실을 반복 서술하지 마세요 — 각 필드는 서로 다른 내용을 담아야 합니다. 위 [종목별 개별 관찰](각 종목의 reason — 이미 "기업별 관찰 지표" 카드로 화면에 별도 표시됨)에 담긴 특정 종목의 구체적 사실(개별 뉴스 이슈 등)도 그대로 옮겨 쓰지 마세요 — 이 필드들은 개별 종목 단위를 넘어서는 포트폴리오 레벨 관점을 각자 전담해야 합니다: structure=구성의 큰 그림(비중·섹터·손익 상태), concentration=집중·분산·동조화·변동성 기여, pnlStructure=매입가 대비 누적 손익이 어디서 나는지, judgment=위 판단들을 종합한 최종 스탠스(예외, 아래 참고), coMovementNarrative=오늘 실제 동조화 관찰, contributionNarrative=오늘 하루 손익 기여 구도, riskFactors/opportunityFactors=포트폴리오 구조적 위험·기회.
- summarySections_judgment은 예외입니다 — 앞선 필드들에서 이미 내린 '판단'을 다시 끌어와 하나의 스탠스로 연결하는 자리이므로 위 반복 금지 규칙이 적용되지 않습니다. 다만 '사실'을 새로 나열하지 말고 '판단'만 종합하세요.
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- ${MARKET_DAY_GROUNDING_INSTRUCTION}
- summarySections_*·riskFactors·contributionNarrative·holdingPeriodNarrative·outlook에서 종목을 언급할 때는 반드시 종목명을 사용하고 종목코드(숫자 6자리)는 절대 출력하지 마세요`;

// 2026-08-14 대시보드 "AI 종합평가"를 "당일 분석"으로 범위 축소 — historicalComparison(과거 급등락
// 비교, 대시보드 Stage0엔 애초에 급등락 이력 데이터를 안 넘겨 항상 빈 문자열이었음)과
// midTermOutlook(중기 관찰 변수)을 스키마에서 아예 제거한다. 같은 날 "관찰 변수" 카드(단기
// 관찰 변수만 담던 shortTermOutlook)도 UI에서 통째로 없애기로 해 함께 제거했다. portfolio-diagnosis는
// 세 필드 모두 여전히 실제로 노출·사용하므로 건드리지 않고, 대시보드 호출 경로에서만 이 변형을 쓴다
// (analyzePortfolioSummary의 scope 파라미터로 분기).
const PORTFOLIO_SUMMARY_INSTRUCTIONS_DASHBOARD = `{"summarySections_background":"【1~2문장】전체 수익률의 구조적 배경(섹터 편중·수급 현황)을 서술하세요. 총수익률·평가손익 숫자(예: '-19.44%', '+123만원')를 문장에 직접 쓰지 마세요 — 이미 상단 카드에 표시됩니다.","summarySections_newsInterpretation":"【1~2문장, 뉴스가 있는 종목이 하나라도 있을 때만 — 없으면 빈 문자열 \\"\\"】뉴스가 있는 종목은 그 뉴스가 '왜' 나왔는지, 시장이 왜 그렇게 반응했는지(또는 반응하지 않았는지)까지 배경 해석하세요 — 제목만 스치듯 언급 금지, 최소 1개 종목은 깊이 있게(예: 컨센서스 조정 근거, 계약 구조 변화 등 구체적 배경). 아래 [종목별 개별 관찰]에 이미 나온 그 종목의 reason 문장(화면에 별도 카드로 표시됨)을 그대로 옮겨 쓰지 말고, reason이 다루지 않은 배경 설명에 집중하세요.","summarySections_judgment":"【1문장, 판단형(필수)】현재 상황의 성격을 판단하는 문장(예: '이번 하락은 개별 종목 이슈보다 업종 전체 심리 위축에 가깝다', '이 흐름이 지속 가능한지는 다음 실적에서 확인될 필요가 있다') — 미래 수익률이나 가격을 예측하는 것이 아니라 현재 상황의 성격을 판단해야 합니다. 벤치마크·직전 진단 대비·손익 기여도 수치는 각각 별도 필드가 있으니 여기서 언급하지 마세요. 이 필드는 앞선 필드들(summarySections_background/newsInterpretation 등)에서 이미 내린 개별 '판단'을 교차 종합하는 자리이므로, 다른 필드에 적용되는 '겹치는 내용 반복 금지' 규칙의 예외입니다 — 단, '사실'(수치·뉴스 제목 등)을 새로 나열하지 말고 이미 내린 '판단'들만 하나의 최종 스탠스로 연결하세요.","riskFactors":[{"text":"포트폴리오 전체 관점의 리스크 요인1(수치 포함, 손실 종목 비중·섹터 과집중·벤치마크 대비 부진·개별 종목 변동성 등 근거)","category":"macro"|"company"},{"text":"요인2","category":"macro"|"company"},{"text":"요인3","category":"macro"|"company"}],"opportunityFactors":["포트폴리오 전체 관점에서 관찰 가능한 긍정적 데이터 포인트 1~3개(수치·근거 포함, riskFactors와 동일 형식) — 이미 본문(종목별 문단·summarySections_*)에 나온 개별 사실을 그대로 복사하지 말고, 포트폴리오 관점에서 종합해 새롭게 서술. 예) 'DL이앤씨와 종근당 모두 외국인·기관의 저점 매수 성격 자금 유입이 관찰되는데, 이는 반도체 업황 심리 위축과 달리 개별 밸류에이션 매력에 반응하는 흐름으로 풀이됩니다.' 뚜렷한 긍정 신호가 없으면 억지로 지어내지 말고 [\\"현재 뚜렷한 긍정 신호가 부족합니다\\"] 하나만 반환하거나 1~2개로 줄여도 됨"],"historyNarrative":"【1~2문장, 아래 [직전 진단과의 간격] 지시를 그대로 따를 것】구체적 수치는 화면에 별도로 표시되므로 여기서는 그 변화가 어떤 의미인지 해석 위주로. 보유 종목 구성이 바뀌었으면([직전 진단과의 차이]에 명시됨) 반드시 그 사실을 언급할 것 — 단, 새로 편입/제거된 개별 종목의 뉴스 배경까지 여기서 설명하지 말고(그건 summarySections_newsInterpretation의 몫) 시간축(직전 대비 무엇이 달라졌는지)에만 집중하세요","contributionNarrative":"【[오늘 손익 기여도]에 제공된 상위 기여 종목을 근거로 1~2문장 — 구체적 금액은 화면에 이미 별도로 표시되므로 여기서는 숫자를 반복하지 말고(금액을 다시 옮겨 적지 말 것) 어떤 종목이 왜 기여했는지 의미 위주로만 서술, 그 종목의 [종목별 개별 관찰] reason과 같은 문장을 반복하지 말 것】예) '오늘 포트폴리오 평가손익 변화는 대부분 종근당 하락에서 발생했습니다.' 매수/매도 권유가 아니라 순수 관찰 서술, 데이터가 없으면 빈 문자열","holdingPeriodNarrative":"【[보유 기간 비교]에 데이터가 있을 때만 1문장 — 없으면 빈 문자열】구체적 수익률 수치는 화면에 별도 표시되므로 여기서는 편입 시점에 따라 성과가 왜 갈렸는지(업황 변화, 매수 시점의 가격 수준 등) 해석 위주로. 매수 타이밍을 지시하거나 '그래서 지금 사야 한다'는 식으로 연결 금지","coMovementNarrative":"【[섹터 동조화 관찰 데이터]에 상관계수 수치 또는 사례가 있을 때만 1~2문장 — 둘 다 없으면 빈 문자열】상관계수 수치가 제공되면 그 수치(강도)를 핵심 근거로 삼아 판단하고, 오늘 같은 방향으로 움직인 사례가 함께 있으면 그 사실도 엮어서 해석하세요 — 상관계수 없이 오늘 하루의 동조화 여부만으로 단정하지 마세요. 단순히 '같은 방향으로 움직였다'는 사실 재진술에 그치지 말고, 왜 그런 동조화가 생겼는지(개별 재료보다 업종 심리가 더 강하게 작용했는지 등)와 포트폴리오 분산 효과 관점에서 어떤 함의가 있는지까지 서술. 예) '개별 종목 재료가 서로 다름에도 최근 상관계수가 0.8을 넘을 만큼 강하게 같은 방향으로 움직였다는 것은 업종 전체 심리가 더 강하게 작용했다는 뜻이며, 분산 투자 효과가 기대만큼 작동하지 않고 있음을 시사합니다.'"}

위 JSON 스키마를 반드시 준수하세요. summarySections_background/newsInterpretation/judgment 3개 필드는 반드시 포함되어야 합니다(summarySections_newsInterpretation은 데이터 없으면 빈 문자열 허용, summarySections_background·summarySections_judgment는 필수).
규칙:
- JSON 키 순서 및 구조 변경 금지
- riskFactors는 개별 종목이 아니라 포트폴리오 전체 구조(손실 비중·섹터 편중·벤치마크 대비·변동성)를 보는 관점으로 작성하세요
- riskFactors[].category는 그 요인의 성격에 따라 "macro"(업종 전체 심리·거시 환경·섹터 공통 이슈처럼 개별 종목을 넘어선 요인) 또는 "company"(특정 종목의 손실 비중·개별 변동성·그 종목만의 이슈처럼 종목 단위 요인) 중 하나로만 판정하세요 — 두 성격이 섞인 요인이면 더 근본적인 원인 쪽으로 판정
- opportunityFactors는 riskFactors와 동일한 컴플라이언스 원칙이 적용됩니다 — "매수 신호"·"지금이 기회"처럼 투자를 유인하는 표현이 아니라 어디까지나 "관찰 가능한 긍정적 데이터 포인트" 수준으로 서술하세요. 목표가·매수 추천·"상승 여력" 같은 표현 절대 금지
- 뉴스가 있는 종목은 그 이슈를 근거로 언급하고, 뉴스가 없는 종목은 수급·기술적 요인으로만 설명하며 뉴스를 지어내지 마세요. "관련 뉴스 없음"이라는 이유만으로 그 종목을 summarySections_newsInterpretation에서 아예 빼지 마세요 — 뉴스가 없다는 사실 자체도 관찰(예: '특별한 뉴스 없이 수급 요인으로 움직였다')로 서술할 수 있습니다
- 벤치마크 수치는 별도 카드로 이미 표시되므로 summarySections_*·historyNarrative 등 어디에서도 다시 언급하지 마세요
- summarySections_background/newsInterpretation/judgment 각 필드·riskFactors·opportunityFactors·historyNarrative·contributionNarrative·holdingPeriodNarrative·coMovementNarrative는 서로 같은 사실을 반복 서술하지 마세요 — 각 필드는 서로 다른 내용을 담아야 합니다. 위 [종목별 개별 관찰](각 종목의 reason — 이미 "기업별 관찰 지표" 카드로 화면에 별도 표시됨)에 담긴 특정 종목의 구체적 사실(개별 뉴스 이슈, 특정 수치 등)도 그대로 옮겨 쓰지 마세요 — 이 필드들은 개별 종목 단위를 넘어서는 포트폴리오 레벨 관점을 각자 전담해야 합니다: newsInterpretation=그 뉴스가 왜 나왔는지의 배경, historyNarrative=직전 진단 대비 시간축 변화, coMovementNarrative=여러 종목에 걸친 동조화, contributionNarrative=오늘 손익 기여 구도, riskFactors/opportunityFactors=포트폴리오 구조적 위험·기회, judgment=위 판단들을 종합한 최종 스탠스(예외, 아래 참고). 여러 종목이 같은 이슈로 얽혀 있으면 종목별로 나열하지 말고 "왜 여러 종목이 동시에 영향받았는지"라는 상위 패턴으로 압축하세요.
- summarySections_judgment은 예외입니다 — 앞선 필드들에서 이미 내린 '판단'을 다시 끌어와 하나의 스탠스로 연결하는 자리이므로 위 반복 금지 규칙이 적용되지 않습니다. 다만 '사실'을 새로 나열하지 말고 '판단'만 종합하세요.
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- ${MARKET_DAY_GROUNDING_INSTRUCTION}
- summarySections_*·riskFactors·historyNarrative·contributionNarrative·holdingPeriodNarrative·outlook에서 종목을 언급할 때는 반드시 종목명을 사용하고 종목코드(숫자 6자리)는 절대 출력하지 마세요`;

// "직전 진단과의 간격"에 따라 어조를 분기 — 진단 빈도가 사용자마다 다르기 때문. 대시보드도
// dashboard_analysis의 "직전 분석"을 같은 개념으로 취급해 그대로 재사용한다.
export const PORTFOLIO_FIRST_TONE = `## [직전 진단과의 간격] 첫 포트폴리오 진단

이 포트폴리오의 첫 진단으로, 비교할 과거 데이터가 없습니다. historyNarrative에는 "첫 포트폴리오 진단으로 비교할 과거 데이터가 없다"는 사실을 짧게 한 문장으로만 언급하세요.`;

export const PORTFOLIO_ONE_DAY_TONE = `## [직전 진단과의 간격] 1일 (어제)

직전 진단이 어제 것입니다. historyNarrative에서 "어제 대비"라는 표현을 써서 [직전 진단과의 차이]에 제공된 총수익률 변화를 해석하세요. 보유 종목 구성이 바뀌었으면([직전 진단과의 차이]에 명시됨) 그 사실(추가/제거된 종목)을 반드시 먼저 언급하세요.`;

export const PORTFOLIO_FEW_DAYS_TONE = `## [직전 진단과의 간격] 2~6일

직전 진단이 며칠 전 것입니다. historyNarrative에서 "어제 대비"가 아니라 "N일 전 진단 대비"라는 표현을 쓰고(N은 [직전 진단과의 차이]에 제시된 실제 일수), 그 사이 무엇이 달라졌는지 해석하세요. 보유 종목 구성이 바뀌었으면 그 사실을 반드시 먼저 언급하세요. 간격이 왜 생겼는지 사과할 필요는 없습니다.`;

export const PORTFOLIO_LONG_GAP_TONE = `## [직전 진단과의 간격] 7일 이상

직전 진단이 오래 전(7일 이상) 것입니다. historyNarrative 맨 앞에 "오랜만에 다시 진단받은 포트폴리오"라는 사실을 위트 있게 짧게 한 문장으로 짚으세요(매번 표현을 다르게, 고정 문구 금지). 비꼬거나 깎아내리는 톤 금지, "지금이 기회"·"저평가" 같은 투자 유인성 표현 금지 — 컴플라이언스 원칙이 이 문장에도 동일 적용됩니다. 위트 문장 다음에는 보유 종목 구성 변화(있으면 반드시)와 총수익률 변화로 자연스럽게 이어가세요.`;

// ── Types ───────────────────────────────────────────────────────────────────

export interface HoldingInput {
  ticker: string; name: string;
  avgPrice: number; quantity: number; buyDate?: string;
}

export interface EnrichedHolding extends HoldingInput {
  currentPrice: number; invested: number; value: number;
  profit: number; profitRate: number;
  analysisData: StockAnalysisData | null;
  relevantNews: { title: string; summary?: string; date?: string; url?: string }[];
  sectorMacroNews: NewsCandidate[]; // 이 종목 업종의 매크로 뉴스(종목명 언급 없어도 잡힘) — 업종별 1회만 조회, distinct sector Set 기반
  mdd: number | null;         // 최근 3개월 최대낙폭(%), 음수
  volatility: number | null;  // 최근 3개월 일별 변동성(표준편차, %)
  todayChangeRate: number | null;  // 오늘 vs 전일 종가 등락률(%) — 차트 마지막 2행에서 계산, 신규 API 호출 없음
  todayContribution: number | null; // 오늘 손익 기여도(원) = (오늘종가-전일종가) × 수량
  surgeHistoryBlock: string | null; // 참고용(있을 때만 Stage 1 프롬프트에 포함), 사례 없으면 null
  tradingValueBlock: string | null; // 거래대금배수 — 우선순위 최상, 있으면 Stage 1 프롬프트에 필수 포함
  dividendSummary: DartDividendSummary | null; // DART 최신 사업연도 배당 요약(무배당이면 null)
  dividendHistory: DividendHistoryRow[];       // KIS 최근 5년 배당 지급 이력(없으면 빈 배열)
}

export interface StockAiResult {
  ticker: string; signal: Signal; reason: string; sector: string;
  newsBasis: 'news' | 'estimated';
}

export interface PrevPortfolioResult {
  totalProfitRate?: number;
  totalProfit?: number;
  holdings?: { ticker: string; name: string }[];
}

export interface PrevPortfolioRow {
  report_date: string;
  result: PrevPortfolioResult | null;
  created_at: string;
}

// 2026-08-03: "AI 종합 평가"가 5-7문장 단일 블록이라 읽기 어렵다는 피드백 — 프롬프트가
// 이미 갖고 있던 [1]~[4] 구조(구조적 배경/뉴스 해석/과거 유사 이력/판단)를 그대로 필드로
// 승격. historicalComparison·newsInterpretation은 근거 데이터가 없으면 빈 문자열.
export interface PortfolioSummarySections {
  // v2 (2026-09-01, 포트폴리오분석) — 포트폴리오 구조 중심 3소제목 + 종합 판단
  structure: string; concentration: string; pnlStructure: string;
  // v1 (대시보드 당일 분석 + 2026-09-01 이전 포트폴리오분석 리포트) — 뉴스 해석 중심
  background: string; newsInterpretation: string; historicalComparison: string;
  judgment: string;
}

// category가 없으면(옛 리포트 폴백 포함) 프론트가 태그 없이 기존처럼 표시한다.
export type RiskFactorItem = { text: string; category?: 'macro' | 'company' };

export interface PortfolioSummaryResult {
  // summary는 더 이상 AI가 직접 채우지 않고, summarySections 4조각을 서버가 이어붙여
  // 계산한다(공유페이지 PortfolioView 등 과거 소비처 호환용 — 기업분석 mainAnalysis와 동일 패턴).
  summary: string; summarySections: PortfolioSummarySections;
  riskFactors: RiskFactorItem[]; opportunityFactors: string[]; historyNarrative: string; contributionNarrative: string;
  holdingPeriodNarrative: string; coMovementNarrative: string;
  shortTermOutlook: string; midTermOutlook: string;
  _failed?: boolean; // 스트림/파싱 실패로 폴백값을 썼는지 — 프론트에 stage2-error를 보낼지 판단용(저장·표시 데이터엔 포함 안 함)
}

export const EMPTY_SUMMARY_SECTIONS: PortfolioSummarySections = {
  structure: '', concentration: '', pnlStructure: '',
  background: '', newsInterpretation: '', historicalComparison: '', judgment: '',
};

export function joinSummarySections(s: PortfolioSummarySections): string {
  return [s.structure, s.concentration, s.pnlStructure, s.background, s.newsInterpretation, s.historicalComparison, s.judgment].filter(Boolean).join(' ');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// 2026-08-04 riskFactors 매크로/기업 태깅 — AI가 category를 빠뜨리거나 macro/company가
// 아닌 값을 낼 경우를 대비한 서버 측 방어(clampSignal과 동일한 원칙). category가 유효하지
// 않으면 undefined로 떨어뜨려 프론트가 "태그 없는 옛 리포트"와 동일하게 처리하도록 한다.
export function sanitizeRiskFactors(raw: unknown): RiskFactorItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item): RiskFactorItem | null => {
    if (typeof item === 'string') return { text: item };
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string') {
      const category = (item as Record<string, unknown>).category;
      return {
        text: (item as Record<string, unknown>).text as string,
        ...(category === 'macro' || category === 'company' ? { category } : {}),
      };
    }
    return null;
  }).filter((v): v is RiskFactorItem => v !== null);
}

export function parseAiJson<T>(text: string, fallback: T): T {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('[PORTFOLIO-PIPELINE] AI 응답에서 JSON을 찾지 못함, 길이:', text.length);
    return fallback;
  }
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('[PORTFOLIO-PIPELINE] JSON.parse 실패 (응답이 잘렸을 가능성):', e instanceof Error ? e.message : e);
    return fallback;
  }
}

// 포트폴리오 전체가 공유하는 거래일 상태 문구(국내 단일 시장이라 종목마다 다르지 않음) —
// Stage 1(종목별)·Stage 2(종합) 프롬프트에 그대로 삽입.
export function buildPortfolioMarketDayBlock(ctx: MarketDayContext): string {
  return buildMarketDayBlock(ctx)
    + (ctx.isTradingDay ? '' : ' 뉴스가 있는 종목은 "오늘 시장이 반응했다"가 아니라 "다음 거래일 참고 소식"으로 다루세요.');
}

// 종목 1개 프롬프트 — PER·52주위치·수급·관련도 상위 뉴스 포함
export function buildStockPrompt(h: EnrichedHolding, marketDayBlock: string): string {
  const ad  = h.analysisData;
  const pr  = h.profitRate >= 0 ? '+' : '';
  const lines: string[] = [
    `현재 시각: ${nowKstString()}`,
    marketDayBlock,
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
    } else if (h.sectorMacroNews.length > 0) {
      const macroLines = h.sectorMacroNews.map(n => n.title).join(' / ');
      lines.push('뉴스: 이 종목만의 뉴스는 없음');
      lines.push(`업종 배경(${ad.sector || '업종'}): ${macroLines}`);
      lines.push('(이 종목 개별 뉴스는 없지만 업종 전체에 영향을 줄 매크로 뉴스가 있음 — reason에서 "이 종목만의 뉴스는 없지만 업종 전체가 영향받고 있다"는 취지로 이 배경을 근거로 활용하되, 종목 개별 뉴스가 있는 것처럼 단정하지 말 것)');
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

// 직전 진단(오늘 이전 가장 최근 1건) 대비 차이를 프롬프트에 주입할 텍스트로 변환.
// 수치·구성변화는 서버가 직접 계산해서 채우고(AI에 맡기지 않음), AI는 해석만 한다.
export function buildPortfolioHistoryBlock(
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

// 종목이 이보다 적으면 A(집중도)/B(상관관계)/C-1(리스크 기여도) 전부 계산 대상 자체가
// 없거나(N=1) 기계적으로 자명해서 무의미 — route.ts·프론트 양쪽이 이 상수 하나로
// "카드 숨김 + 캡션" 게이트를 통일한다(설계 검토에서 합의된 임계치).
export const MIN_HOLDINGS_FOR_QUANT_METRICS = 2;

// ── 포트폴리오 정량 지표(집중도·상관관계·리스크 기여도) ─────────────────────
// 2026-08-28 신설 — "종목분석을 이어붙인 것 같다"는 지적에 대한 대응. 셋 다 AI를
// 거치지 않는 순수 서버 계산(사실 서술이라 컴플라이언스 리스크 없음)이며, sectors도
// 과거처럼 AI가 종목명만 보고 어림한 weight가 아니라 실제 평가금액(value/totalValue)
// 기준으로 여기서 정확히 계산한다.

// 그룹핑 키는 buildCoMovementText·섹터별 뉴스 논조 카드와 동일 원칙 — KIS 원천 분류
// (analysisData.sector)를 우선 쓰고, 없을 때만 AI가 종목마다 붙인 자유 텍스트로 폴백한다
// (2026-08-21 발견: AI 자유텍스트는 같은 업종도 "반도체"/"전기·전자"처럼 표기가 갈려
// 그룹이 어긋나는 버그가 있었다 — 이 사실 하나로 세 카드의 섹터명을 항상 통일시킨다).
// buildCoMovementText는 미확정 섹터('')를 그룹핑에서 제외해야 하므로 폴백 없이 그대로
// 반환한다 — "기타"로 뭉뚱그릴지는 각 호출부(computeSectorBreakdown 등)가 결정한다.
export function resolveSectorLabel(h: EnrichedHolding, aiSector: string | undefined): string {
  return h.analysisData?.sector || aiSector || '';
}

export type SectorBreakdownItem = { name: string; tickers: string[]; weight: number; warning: boolean };

// 종목별 평가금액(value) 기준 섹터 비중 — 최대잔차법(largest remainder)으로 반올림해
// weight 합계가 항상 정확히 100이 되도록 보정한다(과거 AI에게 "합계=100"을 프롬프트로
// 지시하던 것의 서버 계산 버전 — 계산이니 어긋날 수가 없다).
export function computeSectorBreakdown(
  enriched: EnrichedHolding[],
  stockResults: StockAiResult[],
  totalValue: number,
): SectorBreakdownItem[] {
  if (totalValue <= 0) return [];

  const bySector = new Map<string, { tickers: string[]; value: number }>();
  enriched.forEach((h, i) => {
    const sector = resolveSectorLabel(h, stockResults[i]?.sector) || '기타';
    const entry = bySector.get(sector) ?? { tickers: [], value: 0 };
    entry.tickers.push(h.ticker);
    entry.value += h.value;
    bySector.set(sector, entry);
  });

  const items = [...bySector.entries()].map(([name, { tickers, value }]) => {
    const exact = (value / totalValue) * 100;
    return { name, tickers, exact, weight: Math.floor(exact) };
  });
  let remainder = 100 - items.reduce((s, it) => s + it.weight, 0);
  const byFractionDesc = [...items].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  for (let i = 0; i < remainder && byFractionDesc.length > 0; i++) {
    byFractionDesc[i % byFractionDesc.length].weight += 1;
  }

  return items
    .map(({ name, tickers, weight }) => ({ name, tickers, weight, warning: weight >= 40 }))
    .sort((a, b) => b.weight - a.weight);
}

export type ConcentrationGrade = '고집중' | '보통' | '분산';
export type SectorConcentrationResult = { hhi: number; effectiveCount: number; grade: ConcentrationGrade };

// 허핀달-허쉬만지수(HHI, 비중 제곱합)의 역수 = "실효 분산 섹터 수"(effective N) — 종목이
// 몇 개든 실제로 몇 개 업종에 분산된 효과인지를 직관적인 개수로 환산한다. 종목 수 자체가
// 적으면 기계적으로 낮게 나오는 종목레벨 HHI 대신 섹터레벨로만 계산 — "반도체 2종목이
// 50~67%"처럼 종목은 여러 개여도 사실상 한두 업종에 몰린 경우를 정확히 잡아내기 위함.
export function computeSectorConcentration(sectors: SectorBreakdownItem[]): SectorConcentrationResult | null {
  if (sectors.length === 0) return null;
  const hhi = sectors.reduce((s, sec) => s + (sec.weight / 100) ** 2, 0);
  if (hhi <= 0) return null;
  const effectiveCount = 1 / hhi;
  const grade: ConcentrationGrade = effectiveCount >= 3 ? '분산' : effectiveCount >= 2 ? '보통' : '고집중';
  return { hhi: parseFloat(hhi.toFixed(3)), effectiveCount: parseFloat(effectiveCount.toFixed(1)), grade };
}

export type RiskContributionItem = { ticker: string; name: string; pct: number };

// 비중×변동성(computeRiskMetrics의 일별 표준편차) 단순 근사 — 종목 간 상관관계는
// 반영하지 않는다(진짜 리스크 기여도는 공분산행렬의 오일러 분해가 필요하지만, 그 결과는
// 이론상 음수가 나올 수 있어 일반 사용자에게 오히려 오해를 준다 — 의도적으로 단순 지표만
// 노출하고 그 사실을 UI 라벨에도 명시한다). 변동성 데이터가 없는 종목(차트 조회 실패 등)은
// 계산에서 제외 — 나머지 종목 비중 기준으로 100%를 재분배한다.
export function computeRiskContribution(
  enriched: { ticker: string; name: string; value: number; volatility: number | null }[],
  totalValue: number,
): RiskContributionItem[] | null {
  if (totalValue <= 0) return null;
  const raw = enriched
    .filter(h => h.volatility !== null && h.volatility > 0)
    .map(h => ({ ticker: h.ticker, name: h.name, raw: (h.value / totalValue) * (h.volatility as number) }));
  const sum = raw.reduce((s, r) => s + r.raw, 0);
  if (sum <= 0) return null;
  return raw
    .map(r => ({ ticker: r.ticker, name: r.name, pct: parseFloat(((r.raw / sum) * 100).toFixed(1)) }))
    .sort((a, b) => b.pct - a.pct);
}

const CORRELATION_WINDOW_DAYS = 90; // 최근 약 4개월(거래일 기준) — 60~90거래일 권장 구간의 상단
const CORRELATION_STRONG   = 0.7;
const CORRELATION_MODERATE = 0.4;

export type CorrelationBucket = '강한 동조화' | '보통 동조화' | '약한 동조화';
export type PortfolioCorrelationResult = { correlation: number; sampleSize: number; bucket: CorrelationBucket };

// 보유종목 쌍(i<j)의 최근 CORRELATION_WINDOW_DAYS거래일 일별 수익률 피어슨 상관계수를
// 비중(value_i×value_j)으로 가중평균한 스칼라 하나로 압축 — lib/fx-correlation.ts의
// computeFxCorrelation(종목×환율)과 완전히 같은 원칙(가격 레벨이 아닌 일별 수익률, 표본
// 부족 시 그 쌍은 제외)을 종목×종목 쌍에 그대로 적용한다. 이미 fetchDailyChart로 받아둔
// 1년 일별 차트를 재사용하므로 신규 API 호출이 없다. 종목이 2개 미만이거나(쌍 자체가
// 없음) 유효한 쌍이 하나도 없으면(표본 부족 등) null.
export function computePortfolioCorrelation(
  holdings: { weight: number; chart: ChartDataPoint[] }[],
): PortfolioCorrelationResult | null {
  const usable = holdings.filter(h => h.weight > 0 && h.chart.length > 0);
  if (usable.length < 2) return null;

  const returnMaps = usable.map(h => toDailyReturns(h.chart.slice(-CORRELATION_WINDOW_DAYS)));

  let weightedSum = 0, weightTotal = 0, minSample = Infinity;
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const pair = correlateReturnMaps(returnMaps[i], returnMaps[j]);
      if (!pair) continue;
      const w = usable[i].weight * usable[j].weight;
      weightedSum += w * pair.correlation;
      weightTotal += w;
      minSample = Math.min(minSample, pair.sampleSize);
    }
  }
  if (weightTotal === 0) return null;

  const correlation = weightedSum / weightTotal;
  const bucket: CorrelationBucket =
    correlation >= CORRELATION_STRONG ? '강한 동조화' :
    correlation >= CORRELATION_MODERATE ? '보통 동조화' : '약한 동조화';
  return { correlation: parseFloat(correlation.toFixed(2)), sampleSize: minSample, bucket };
}

// Stage 2 프롬프트의 "섹터 동조화 관찰 데이터" 섹션에 덧붙일 정량 사실 한 줄 — 화면에
// 그대로 노출되는 buildCoMovementText()의 결과와는 별개다(원시 상관계수는 UI에는 배지로만
// 변환해 보여주고, 이 문자열처럼 그대로 노출하지 않는다 — 전문용어 그대로 노출은 오히려
// 신뢰를 깎을 수 있다는 판단). AI에게 판단 근거로 주는 사실 텍스트라 원시 수치를 그대로 써도 된다.
export function buildCorrelationFactsLine(correlation: PortfolioCorrelationResult | null): string {
  if (!correlation) return '상관계수 계산 불가(종목 수 부족 또는 가격 데이터 부족)';
  return `보유종목 전체의 최근 ${CORRELATION_WINDOW_DAYS}거래일 일별 수익률 기준 비중가중평균 상관계수는 ${correlation.correlation}(${correlation.bucket}, 표본 ${correlation.sampleSize}일)입니다.`;
}

// 같은 섹터에 2종목 이상이고 오늘 방향(상승/하락)이 일치하면 결정형 템플릿 문장 생성.
// AI를 거치지 않는다 — 정교한 상관계수 계산이 아니라 순수 관찰 사실이라 서버 계산만으로
// 충분하고, AI가 편집할 여지를 없애 컴플라이언스 리스크 자체가 생기지 않는다.
export function buildCoMovementText(
  enriched: EnrichedHolding[],
  stockResults: StockAiResult[],
): string | null {
  // 그룹핑 키는 resolveSectorLabel(KIS 원천 분류 우선, 없으면 AI 라벨 폴백) — AI가 자유
  // 형식으로 붙인 sector를 그대로 쓰면 같은 업종인데도 "반도체"/"전기전자" 등으로 표기가
  // 갈려 그룹이 안 잡히는 버그가 있었다(실측: 삼성전자·SK하이닉스 둘 다 KIS 분류는
  // "전기·전자"로 동일). computeSectorBreakdown과 동일한 헬퍼를 재사용해 카드 간 섹터명이
  // 항상 일치하게 한다.
  const bySector = new Map<string, { name: string; changeRate: number }[]>();
  const sectorMacroBySector = new Map<string, NewsCandidate[]>();
  enriched.forEach((h, i) => {
    const sector = resolveSectorLabel(h, stockResults[i]?.sector);
    if (!sector || h.todayChangeRate === null) return;
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector)!.push({ name: h.name, changeRate: h.todayChangeRate });
    if (!sectorMacroBySector.has(sector)) sectorMacroBySector.set(sector, h.sectorMacroNews);
  });

  const sentences: string[] = [];
  for (const [sector, items] of bySector) {
    if (items.length < 2) continue;
    const allUp   = items.every(it => it.changeRate > 0);
    const allDown = items.every(it => it.changeRate < 0);
    if (!allUp && !allDown) continue;
    const dir   = allUp ? '상승' : '하락';
    const names = items.map(it => `${it.name}(${it.changeRate >= 0 ? '+' : ''}${it.changeRate.toFixed(1)}%)`).join(', ');
    // 이 섹터의 매크로 뉴스가 있으면 "왜 동조화됐는지"의 직접적 근거로 같이 제시 —
    // coMovementNarrative 지시문("왜 그런 동조화가 생겼는지")이 바로 답할 수 있는 재료.
    const macroNews = sectorMacroBySector.get(sector) ?? [];
    const macroNote = macroNews.length > 0 ? ` (참고 — 이 업종 관련 매크로 뉴스: "${macroNews[0].title}")` : '';
    sentences.push(`${sector} 섹터 비중 종목(${names})이 오늘 같은 방향(${dir})으로 움직였습니다.${macroNote}`);
  }
  return sentences.length > 0 ? sentences.join(' ') : null;
}

// 보유 기간별 관점 — 매입일이 서로 다른 종목 중 가장 오래/최근 보유한 종목의 수익률을
// 비교해서 편입 시점 격차를 관찰. buyDate가 없거나 전부 같으면 데이터 없음.
export function buildHoldingPeriodFactsLine(
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

// ── Stage 1: 종목 개별 분석 ─────────────────────────────────────────────────

// 재생성 로직 없음(재시도는 비용 문제로 로그만 남기는 정책 — 아래 checkTemporalConsistency
// 참고) — onField/onPartial은 항상 "이번이 유일한 시도"라는 전제로 단순하게 통지한다.
export async function analyzeOneStock(
  h: EnrichedHolding,
  marketDayBlock: string,
  onPartial: (key: string, value: string) => void,
  onField: (key: string, value: string) => void,
): Promise<StockAiResult> {
  const prompt = buildStockPrompt(h, marketDayBlock);

  const newsBasis: 'news' | 'estimated' = h.relevantNews.length > 0 ? 'news' : 'estimated';
  const parser = new StreamingFieldParser(PORTFOLIO_STOCK_FIELD_SPECS);
  let fullText = '';
  const lastPartialEmitAt: Record<string, number> = {};
  const PARTIAL_THROTTLE_MS = 80; // 종목분석 스트리밍에서 검증된 값 — 실측상 Claude 델타 자체가 더 느려 사실상 상한으로만 작동

  try {
    const claudeStream = claude.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system: [
        { type: 'text', text: STOCK_SIGNAL_SYSTEM },
        { type: 'text', text: STOCK_SIGNAL_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: prompt }],
      // 종목별 병렬 호출이라 재시도가 겹치면 전체 Stage 1 시간이 크게 늘어날 수 있음 —
      // maxRetries:0(SDK 기본 재시도는 타임아웃도 재시도 대상이라 예산 계산 불가) +
      // timeout 30s(실측 종목당 최악 ~10초 대비 3배 여유, 병렬이라 종목 수와 무관하게
      // 이 값이 Stage 1 전체 상한).
    }, { timeout: 30_000, maxRetries: 0 });

    claudeStream.on('text', (delta) => {
      fullText += delta;
      const { fields, partial } = parser.feedWithPartial(delta);
      for (const field of fields) onField(field.key, field.value as string);
      if (partial) {
        const now = Date.now();
        const last = lastPartialEmitAt[partial.key] ?? 0;
        if (now - last >= PARTIAL_THROTTLE_MS) {
          lastPartialEmitAt[partial.key] = now;
          onPartial(partial.key, partial.value);
        }
      }
    });

    const msg = await claudeStream.finalMessage();
    console.log('[TOKEN_USAGE]', {
      route: 'portfolio-analysis-pipeline-stage1', ticker: h.ticker, hasNews: h.relevantNews.length > 0,
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    });
    const parsed = parseAiJson<Omit<StockAiResult, 'newsBasis'>>(fullText, { ticker: h.ticker, signal: '중립·관망', reason: '', sector: '' });

    // 정합성 보정 — 증분 파서가 놓쳤거나 다르게 뽑았어도 전체 재파싱 결과로 덮어써서
    // 최종 정확성을 보장(종목분석과 동일 원칙). emit:false인 ticker/signal은 스킵.
    for (const spec of PORTFOLIO_STOCK_FIELD_SPECS) {
      if (!spec.emit) continue;
      const raw = (parsed as unknown as Record<string, string | undefined>)[spec.key];
      if (raw === undefined) continue;
      onField(spec.key, raw);
    }

    // 시간적 사실관계 사후 검증 — N개 종목 병렬 호출이라 재생성은 비용이 커서 로그만 남긴다.
    const newsText = [...h.relevantNews, ...h.sectorMacroNews].map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
    const check = checkTemporalConsistency(parsed.reason ?? '', newsText);
    if (check.flagged) {
      console.warn(`[PORTFOLIO-PIPELINE] ${h.ticker} 시간적 사실관계 불일치 감지 (재생성 없음):`, check);
    }
    const complianceHits = scanComplianceViolations(parsed.reason ?? '');
    if (complianceHits.length > 0) {
      console.error(`[PORTFOLIO-PIPELINE] ${h.ticker} 컴플라이언스 금지어 감지 (재생성 없음, 모니터링 필요):`, complianceHits);
    }

    return { ...parsed, signal: clampSignal(parsed.signal), newsBasis };
  } catch (e) {
    console.error(`[PORTFOLIO-PIPELINE] 종목 분석 실패 ${h.ticker}:`, e);
    // 스트리밍 중 실패했으면 프론트가 이 종목 카드에서 계속 로딩 상태로 멈춰있지 않도록
    // 빈 값이라도 통지한다.
    onField('reason', '');
    onField('sector', '');
    return { ticker: h.ticker, signal: '중립·관망', reason: '', sector: '', newsBasis };
  }
}

// ── Stage 2: 포트폴리오 종합 분석 ──────────────────────────────────────────

export async function analyzePortfolioSummary(
  stockResults: StockAiResult[],
  nameMap: Record<string, string>,   // ticker → 종목명
  newsMap: Record<string, { title: string; summary?: string }[]>, // ticker → 관련도 상위 뉴스
  sectorMacroNewsFlat: NewsCandidate[], // 시간적 사실관계 검증용 — coMovementFactsLine에 이미 반영된 매크로 뉴스(중복 제거됨)
  totalProfitRate: number,
  holdingCount: number,
  benchmark: { portfolioProfitRate: number; kospiChangeRate: number } | null,
  portfolioFacts: { lossCount: number; lossWeightPct: number; riskiestLines: string[] },
  historyComparisonBlock: string,
  contributionFactsLine: string,
  holdingPeriodFactsLine: string,
  surgeFactsLine: string,
  coMovementFactsLine: string,
  correlationFactsLine: string,
  // 2026-09-01: 포트폴리오분석(scope='diagnosis') 전용 [포트폴리오 구조 데이터] 블록
  // (lib/portfolio-structure-facts.ts) — 대시보드는 옛 뉴스 중심 스키마라 무시한다('').
  structureFactsBlock: string,
  gapTone: string,
  marketDayBlock: string,
  scope: 'diagnosis' | 'dashboard',
  onPartial: (key: string, value: string) => void,
  onField: (key: string, value: unknown) => void,
): Promise<PortfolioSummaryResult> {
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

  // 2026-09-01: 포트폴리오분석은 [포트폴리오 구조 데이터]를 맨 앞에(가장 중요한 근거) 두고,
  // 제거된 "직전 진단 대비"·"과거 유사 급등락 이력" 섹션은 프롬프트에서도 뺀다(넣어두면
  // 스키마에 없는 필드에 대해 AI가 엉뚱한 자리에 서술하려 든다). 대시보드는 옛 구성 그대로.
  const prompt = scope === 'diagnosis'
    ? `포트폴리오 관찰 데이터 정리 (JSON만 출력)\n\n` +
      `현재 시각: ${nowKstString()}\n\n` +
      `## 거래일 상태\n${marketDayBlock}\n\n` +
      `[종목코드→종목명 매핑] ${mappingTable}\n\n` +
      `## 포트폴리오 구조 데이터 (서버 계산값 — summarySections_* 서술의 핵심 근거, 수치를 그대로 인용할 것)\n${structureFactsBlock}\n\n` +
      `## 종목별 개별 관찰 (Stage 1 결과 — 이미 화면에 별도 카드로 표시됨, 반복 금지)\n` +
      `총 수익률: ${totalProfitRate.toFixed(2)}% | 보유종목: ${holdingCount}개${benchmarkLine}\n` +
      `${lines}\n${riskFactsLine}\n\n` +
      `## 오늘 손익 기여도\n${contributionFactsLine}\n\n` +
      `## 보유 기간 비교\n${holdingPeriodFactsLine}\n\n` +
      `## 섹터 동조화 관찰 데이터\n${coMovementFactsLine}\n${correlationFactsLine}\n\n` +
      `위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 스키마와 규칙에 따라 정리하세요.`
    : `포트폴리오 관찰 데이터 정리 (JSON만 출력)\n\n` +
      `현재 시각: ${nowKstString()}\n\n` +
      `## 거래일 상태\n${marketDayBlock}\n\n` +
      `[종목코드→종목명 매핑] ${mappingTable}\n\n` +
      `총 수익률: ${totalProfitRate.toFixed(2)}% | 보유종목: ${holdingCount}개${benchmarkLine}\n` +
      `${lines}\n${riskFactsLine}\n\n` +
      `## 직전 진단과의 차이\n${historyComparisonBlock}\n\n` +
      `## 오늘 손익 기여도\n${contributionFactsLine}\n\n` +
      `## 보유 기간 비교\n${holdingPeriodFactsLine}\n\n` +
      `## 포트폴리오 내 과거 유사 급등락 이력\n${surgeFactsLine}\n\n` +
      `## 섹터 동조화 관찰 데이터\n${coMovementFactsLine}\n${correlationFactsLine}\n\n` +
      `위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 스키마와 규칙에 따라 정리하세요.`;

  const summaryFieldSpecs = scope === 'dashboard'
    ? PORTFOLIO_SUMMARY_FIELD_SPECS_DASHBOARD
    : PORTFOLIO_SUMMARY_FIELD_SPECS;
  const parser = new StreamingFieldParser(summaryFieldSpecs);
  let fullText = '';
  const lastPartialEmitAt: Record<string, number> = {};
  const PARTIAL_THROTTLE_MS = 80;
  const summaryInstructions = scope === 'dashboard'
    ? PORTFOLIO_SUMMARY_INSTRUCTIONS_DASHBOARD
    : PORTFOLIO_SUMMARY_INSTRUCTIONS_DIAGNOSIS;

  try {
    const claudeStream = claude.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      // 포트폴리오분석(v2)은 historyNarrative가 스키마에서 빠져 gapTone(직전 진단 간격 어조)
      // 블록도 넣지 않는다 — 대시보드만 옛 시스템 프롬프트 + gapTone 유지.
      system: scope === 'diagnosis'
        ? [
            { type: 'text', text: PORTFOLIO_SUMMARY_SYSTEM_STRUCTURE },
            { type: 'text', text: summaryInstructions, cache_control: { type: 'ephemeral' } },
          ]
        : [
            { type: 'text', text: PORTFOLIO_SUMMARY_SYSTEM },
            { type: 'text', text: summaryInstructions, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: gapTone, cache_control: { type: 'ephemeral' } },
          ],
      messages: [{ role: 'user', content: prompt }],
      // 단일 호출(Stage 2)이 전체 라우트의 지배적 병목(실측 62.7초) — maxRetries:0(SDK
      // 기본 재시도는 타임아웃도 재시도 대상이라 예산 계산 불가) + timeout 75s.
    }, { timeout: 75_000, maxRetries: 0 });

    claudeStream.on('text', (delta) => {
      fullText += delta;
      const { fields, partial } = parser.feedWithPartial(delta);
      for (const field of fields) onField(field.key, field.value);
      if (partial) {
        const now = Date.now();
        const last = lastPartialEmitAt[partial.key] ?? 0;
        if (now - last >= PARTIAL_THROTTLE_MS) {
          lastPartialEmitAt[partial.key] = now;
          onPartial(partial.key, partial.value);
        }
      }
    });

    const msg = await claudeStream.finalMessage();
    console.log('[TOKEN_USAGE]', {
      route: 'portfolio-analysis-pipeline-stage2', holdingCount,
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    });
    const parsed = parseAiJson(fullText, {
      summarySections_structure: '', summarySections_concentration: '', summarySections_pnlStructure: '',
      summarySections_background: '', summarySections_newsInterpretation: '',
      summarySections_historicalComparison: '', summarySections_judgment: '',
      riskFactors: [], opportunityFactors: [], historyNarrative: '', contributionNarrative: '',
      holdingPeriodNarrative: '', coMovementNarrative: '', shortTermOutlook: '', midTermOutlook: '',
    });
    // AI가 category를 빠뜨리거나 잘못 낸 항목을 서버에서 정리 — 스트리밍/최종 저장 양쪽에
    // 이 정리된 값을 일관되게 사용한다.
    parsed.riskFactors = sanitizeRiskFactors(parsed.riskFactors);

    // 정합성 보정 — 증분 파서가 놓쳤거나 다르게 뽑았어도 전체 재파싱 결과로 덮어써서
    // 최종 정확성을 보장(종목분석과 동일 원칙). summaryFieldSpecs가 scope에 맞는 flat
    // 키만 갖고 있으므로 이 루프가 그대로 parsed의 flat 키를 읽어 재전송한다.
    for (const spec of summaryFieldSpecs) {
      if (!spec.emit) continue;
      const raw = (parsed as unknown as Record<string, unknown>)[spec.key];
      if (raw === undefined) continue;
      onField(spec.key, raw);
    }

    // 타이핑 효과를 위해 summarySections(json)를 4개의 독립 top-level 'string' 필드로
    // 스키마 분리 — 여기서 다시 하나의 객체로 재조립한다. 4조각을 이어붙여 기존
    // summary(문자열) 필드도 계속 채운다 — 공유페이지(app/share/[id]/page.tsx의
    // PortfolioView)가 d.summary를 그대로 렌더링하므로 과거 소비처 호환을 위해 AI에게
    // flat 문자열을 별도로 다시 쓰게 하지 않고 서버가 조립한다(기업분석 mainAnalysis와
    // 동일 패턴). 스트리밍 채널에도 동일하게 실어보내 프론트가 즉시 받을 수 있게 한다.
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const summarySections: PortfolioSummarySections = {
      structure:            str(parsed.summarySections_structure),
      concentration:        str(parsed.summarySections_concentration),
      pnlStructure:         str(parsed.summarySections_pnlStructure),
      background:           typeof parsed.summarySections_background === 'string' ? parsed.summarySections_background : '',
      newsInterpretation:    typeof parsed.summarySections_newsInterpretation === 'string' ? parsed.summarySections_newsInterpretation : '',
      historicalComparison:  typeof parsed.summarySections_historicalComparison === 'string' ? parsed.summarySections_historicalComparison : '',
      judgment:              typeof parsed.summarySections_judgment === 'string' ? parsed.summarySections_judgment : '',
    };
    const flatSummary = joinSummarySections(summarySections);
    onField('summary', flatSummary);

    // 시간적 사실관계 사후 검증 — 포트폴리오 요약은 1회 호출이지만, 종목별 뉴스가 이미
    // Stage 1에서 개별 검증되므로 여기서는 종합 텍스트만 가볍게 로그로 남긴다(재생성 없음).
    const allNewsText = [...Object.values(newsMap).flat(), ...sectorMacroNewsFlat].map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
    // 2026-09-01: riskFactors/opportunityFactors도 AI가 쓴 본문이라 컴플라이언스 사후 스캔에 포함
    // (예전엔 summarySections·narrative류만 스캔해 두 배열은 사각지대였음). 시간적 사실관계
    // 검증(checkTemporalConsistency)은 뉴스 인용이 많은 서술 필드에만 그대로 적용한다.
    const summaryText = [flatSummary, parsed.historyNarrative, parsed.contributionNarrative, parsed.holdingPeriodNarrative, parsed.coMovementNarrative, parsed.shortTermOutlook, parsed.midTermOutlook].filter(Boolean).join(' ');
    const factorsText = [
      ...parsed.riskFactors.map((r: RiskFactorItem) => r.text),
      ...(Array.isArray(parsed.opportunityFactors) ? parsed.opportunityFactors : []),
    ].filter((t): t is string => typeof t === 'string' && t.length > 0).join(' ');
    const check = checkTemporalConsistency(summaryText, allNewsText);
    if (check.flagged) {
      console.warn('[PORTFOLIO-PIPELINE] 포트폴리오 종합 요약 시간적 사실관계 불일치 감지 (재생성 없음):', check);
    }
    const complianceHits = scanComplianceViolations(`${summaryText} ${factorsText}`);
    if (complianceHits.length > 0) {
      console.error('[PORTFOLIO-PIPELINE] 포트폴리오 종합 요약 컴플라이언스 금지어 감지 (재생성 없음, 모니터링 필요):', complianceHits);
    }

    return { ...parsed, summary: flatSummary, summarySections };
  } catch (e) {
    console.error('[PORTFOLIO-PIPELINE] 종합 분석 실패:', e);
    return {
      summary: '', summarySections: EMPTY_SUMMARY_SECTIONS,
      riskFactors: [], opportunityFactors: [], historyNarrative: '', contributionNarrative: '',
      holdingPeriodNarrative: '', coMovementNarrative: '', shortTermOutlook: '', midTermOutlook: '',
      _failed: true,
    };
  }
}
