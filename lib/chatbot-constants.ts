// 고객상담 챗봇(components/ChatWidget.tsx → app/api/chatbot) 관련 상수.
//
// 모델은 Haiku 4.5로 시작(2026-07-09 결정) — 사이트 이용 안내 수준의 QA라 비용 대비
// 충분하다고 판단. 응답 품질이 부족하면 이 상수만 'claude-sonnet-4-6'으로 바꾸면 됨
// (다른 라우트가 쓰는 것과 동일한 모델명 — lib/summarize.ts, cron 라우트들 참고).
export const CHATBOT_MODEL = 'claude-haiku-4-5-20251001';

export const CHATBOT_MAX_TOKENS = 500;

// rate limit — IP당 10분에 이 횟수까지. 2026-09-03 트래픽점검 7번: 예전엔 서버리스
// 인스턴스 메모리에만 유지해 인스턴스 분산 시 한도가 사실상 무효했던 것을,
// lib/rate-limit.ts(DB 기반 CAS 토큰버킷, market_cache 재사용)로 전환해 인스턴스
// 경계와 무관하게 정확히 카운트된다(app/api/chatbot/route.ts).
export const CHATBOT_RATE_LIMIT_MAX = 20;
export const CHATBOT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10분

// 클라이언트가 세션당 sessionStorage에 저장하는 대화 히스토리도 이 길이로 cap —
// 서버도 동일하게 방어적으로 자름(app/api/chatbot/route.ts).
export const CHATBOT_MAX_HISTORY_MESSAGES = 20;
export const CHATBOT_MAX_MESSAGE_LENGTH = 1000;
