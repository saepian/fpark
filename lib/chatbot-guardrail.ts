// 고객상담 챗봇의 2차 방어선(사후 검증) — lib/ai-grounding.ts의 "정교한 NLP 대신 저비용
// 정규식 대조로 명백한 위반만 잡는다"는 패턴을 그대로 재사용한다.
//
// 1차 방어(시스템 프롬프트, app/api/chatbot/route.ts)가 종목/투자 질문을 전부 거부하도록
// 지시하지만, fpark는 유사투자자문업 규제 검토 대상이라 프롬프트 지시 하나만 믿을 수 없다
// (2026-07-09 결정). 그래서 Claude 응답을 사용자에게 보여주기 전에 이 함수로 한 번 더
// 걸러서, 투자판단성 표현이 조금이라도 섞여 있으면 응답 전체를 정형 거절 문구로 치환한다.
//
// 완벽한 종목명 커버리지(상장사 수천 개)는 시도하지 않는다 — "매수/매도/목표주가/추천종목"
// 같은 명백한 투자판단 어휘와 6자리 티커 패턴만 잡는 저비용 안전망이다. 오탐이 있어도
// (예: 정상적인 기능 설명 답변이 걸러짐) 사용자에게는 안전한 방향(거절)으로만 작동하므로
// 오탐 비용이 미탐 비용보다 훨씬 낮다는 전제로 설계했다.

const ACTION_WORDS = [/매수/, /매도/, /사세요/, /파세요/, /팔세요/, /사시는\s*게/, /파시는\s*게/];
const PRICE_TARGET_WORDS = [/목표주가/, /목표가/, /적정주가/, /적정가/, /손절가/];
const RECOMMENDATION_WORDS = [/추천\s*종목/, /추천드리는\s*종목/, /유망한\s*종목/, /유망\s*주식/, /좋은\s*종목/];
const DIRECTION_PREDICTION_WORDS = [
  /상승할\s*(것|가능성|전망)/, /하락할\s*(것|가능성|전망)/,
  /오를\s*(것|전망|가능성)/, /내릴\s*(것|전망|가능성)/,
  /오를\s*거예요/, /내릴\s*거예요/,
];
// 종목코드(6자리 숫자) — 원화 금액(예: "191040원")과 혼동되지 않도록 뒤에 "원"이 바로
// 붙는 경우는 제외한다.
const TICKER_PATTERN = /\b\d{6}\b(?!\s*원)/;

const ALL_PATTERNS = [
  ...ACTION_WORDS,
  ...PRICE_TARGET_WORDS,
  ...RECOMMENDATION_WORDS,
  ...DIRECTION_PREDICTION_WORDS,
  TICKER_PATTERN,
];

export interface ChatbotGuardrailResult {
  flagged: boolean;
  matched?: string;
}

export function checkInvestmentAdviceLanguage(responseText: string): ChatbotGuardrailResult {
  for (const re of ALL_PATTERNS) {
    const match = responseText.match(re);
    if (match) {
      return { flagged: true, matched: match[0] };
    }
  }
  return { flagged: false };
}

export const CHATBOT_INVESTMENT_REFUSAL_MESSAGE =
  '죄송하지만 종목이나 투자 관련 질문에는 답변드릴 수 없어요. 종목 분석이 궁금하시면 ' +
  'fpark의 [종목 분석] 페이지(/diagnosis)를 이용해보세요! 요금제, 결제, 환불, 계정 관리 같은 ' +
  '사이트 이용 관련 질문은 편하게 물어봐주세요 🙂';
