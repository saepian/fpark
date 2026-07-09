// 고객상담 챗봇(components/ChatWidget.tsx → app/api/chatbot) 관련 상수.
//
// 모델은 Haiku 4.5로 시작(2026-07-09 결정) — 사이트 이용 안내 수준의 QA라 비용 대비
// 충분하다고 판단. 응답 품질이 부족하면 이 상수만 'claude-sonnet-4-6'으로 바꾸면 됨
// (다른 라우트가 쓰는 것과 동일한 모델명 — lib/summarize.ts, cron 라우트들 참고).
export const CHATBOT_MODEL = 'claude-haiku-4-5-20251001';

export const CHATBOT_MAX_TOKENS = 500;

// rate limit — in-memory sliding window(app/api/chatbot/route.ts). DB 테이블 없이
// 서버리스 인스턴스 메모리에만 유지하므로 콜드스타트/인스턴스 분산 시 한도가 느슨해질 수
// 있지만, 이 기능의 핵심 안전장치(투자 질문 차단)와는 무관한 비용 통제 목적이라 이
// 정도 허용치로 시작 — 실제 악용 사례가 나오면 lib/contact처럼 DB 기반으로 전환.
export const CHATBOT_RATE_LIMIT_MAX = 20;
export const CHATBOT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10분

// 클라이언트가 세션당 sessionStorage에 저장하는 대화 히스토리도 이 길이로 cap —
// 서버도 동일하게 방어적으로 자름(app/api/chatbot/route.ts).
export const CHATBOT_MAX_HISTORY_MESSAGES = 20;
export const CHATBOT_MAX_MESSAGE_LENGTH = 1000;
