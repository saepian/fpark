// components/ChatWidget.tsx의 로그아웃/계정 전환 시 대화 히스토리 초기화 판단 로직 —
// React 이펙트에서 분리해 순수 함수로 둬서 단위 테스트 가능하게 함(2026-07-09,
// "로그아웃 후에도 이전 계정 대화가 보이는" 프라이버시 버그 수정과 함께 추가).

export const CHATBOT_HISTORY_ANONYMOUS_OWNER = 'anonymous';

// 저장된 히스토리를 초기화해야 하는지 판단.
// 정책(2026-07-09 결정): "로그인된 계정이 있었는데 그 사이 바뀐 경우"(로그아웃, 다른
// 계정으로 전환)만 초기화한다. 비로그인 → 로그인 전환은 초기화하지 않는다 — 비로그인
// 방문자의 대화에는 계정 고유 정보가 없어 리스크가 낮고, 이어가는 게 UX상 낫기 때문.
export function shouldResetChatbotHistory(
  storedOwner: string | null,
  currentOwner: string,
): boolean {
  if (!storedOwner) return false; // 첫 방문 — 비교 대상 없음
  if (storedOwner === CHATBOT_HISTORY_ANONYMOUS_OWNER) return false; // 비로그인→(무엇이든) 유지
  return storedOwner !== currentOwner; // 로그인 상태였는데 소유자가 달라짐(로그아웃 포함) → 초기화
}
