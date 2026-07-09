// 2026-07-09 프라이버시 버그(로그아웃 후에도 이전 계정 챗봇 대화가 남아있던 문제) 수정의
// 핵심 판단 로직 단위 테스트. 시나리오: 로그인→대화→로그아웃→재로그인(같은 계정/다른 계정),
// 비로그인→로그인 전환.

import { describe, it, expect } from 'vitest';
import { shouldResetChatbotHistory, CHATBOT_HISTORY_ANONYMOUS_OWNER } from './chatbot-history-owner';

describe('shouldResetChatbotHistory', () => {
  it('첫 방문(저장된 소유자 없음) — 초기화 불필요', () => {
    expect(shouldResetChatbotHistory(null, 'userA')).toBe(false);
    expect(shouldResetChatbotHistory(null, CHATBOT_HISTORY_ANONYMOUS_OWNER)).toBe(false);
  });

  it('비로그인 상태 유지(비로그인→비로그인) — 초기화 불필요', () => {
    expect(shouldResetChatbotHistory(CHATBOT_HISTORY_ANONYMOUS_OWNER, CHATBOT_HISTORY_ANONYMOUS_OWNER)).toBe(false);
  });

  it('비로그인 → 로그인 전환 — 대화 유지(초기화 불필요, 2026-07-09 정책 결정)', () => {
    expect(shouldResetChatbotHistory(CHATBOT_HISTORY_ANONYMOUS_OWNER, 'userA')).toBe(false);
  });

  it('같은 계정 유지(토큰 리프레시 등 재검증) — 초기화 불필요', () => {
    expect(shouldResetChatbotHistory('userA', 'userA')).toBe(false);
  });

  it('로그아웃(로그인 계정 → 비로그인) — 초기화 필요: 신고된 버그의 핵심 시나리오', () => {
    expect(shouldResetChatbotHistory('userA', CHATBOT_HISTORY_ANONYMOUS_OWNER)).toBe(true);
  });

  it('다른 계정으로 전환(userA → userB) — 초기화 필요', () => {
    expect(shouldResetChatbotHistory('userA', 'userB')).toBe(true);
  });
});
