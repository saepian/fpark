// 2026-09-03 트래픽점검 10번 — tryConsumeRateLimit의 reserve(대화형 몫 예약) 판정을 검증한다.
// Supabase는 market_cache 한 행을 흉내 내는 인메모리 페이크로 대체(select/insert/update+CAS).
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = { key: string; data: { tokens: number }; updated_at: string } | null;
const state: { row: Row } = { row: null };

vi.mock('./supabase', () => {
  const from = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: state.row ? { data: state.row.data, updated_at: state.row.updated_at } : null }),
      }),
    }),
    insert: async (payload: { key: string; data: { tokens: number }; updated_at: string }) => {
      if (state.row) return { error: { code: '23505' } };
      state.row = payload;
      return { error: null };
    },
    update: (payload: { data: { tokens: number }; updated_at: string }) => ({
      eq: (_k: string, _v: string) => ({
        eq: (_k2: string, expectedUpdatedAt: string) => ({
          select: async () => {
            if (!state.row || state.row.updated_at !== expectedUpdatedAt) return { data: [], error: null }; // CAS 실패
            state.row = { ...state.row, ...payload };
            return { data: [{ key: state.row.key }], error: null };
          },
        }),
      }),
    }),
  });
  return { supabase: { from } };
});

import { tryConsumeRateLimit } from './rate-limit';

describe('tryConsumeRateLimit — reserve(대화형 몫 예약)', () => {
  beforeEach(() => { state.row = null; });

  it('reserve=0(대화형)은 마지막 토큰까지 쓸 수 있다', async () => {
    // 버스트 3 → 3번 허용, 4번째 거부
    expect(await tryConsumeRateLimit('k', 10, 3)).toBe(true);
    expect(await tryConsumeRateLimit('k', 10, 3)).toBe(true);
    expect(await tryConsumeRateLimit('k', 10, 3)).toBe(true);
    expect(await tryConsumeRateLimit('k', 10, 3)).toBe(false);
  });

  it('reserve=2(배치)는 토큰이 2개 넘게 남아 있을 때만 가져간다 — 대화형 몫 2개는 항상 남는다', async () => {
    // 버스트 3: 배치는 3→2 한 번만 가능(다음은 2 ≥ 1+2 아님 → 거부)
    expect(await tryConsumeRateLimit('k', 10, 3, 2)).toBe(true);
    expect(await tryConsumeRateLimit('k', 10, 3, 2)).toBe(false);
    // 같은 순간 대화형은 남은 2개를 그대로 쓸 수 있다
    expect(await tryConsumeRateLimit('k', 10, 3)).toBe(true);
    expect(await tryConsumeRateLimit('k', 10, 3)).toBe(true);
    expect(await tryConsumeRateLimit('k', 10, 3)).toBe(false);
  });

  it('배치가 아무리 두드려도 대화형 예약분은 소진되지 않는다', async () => {
    for (let i = 0; i < 10; i++) await tryConsumeRateLimit('k', 10, 5, 3);
    // 배치는 5→4→3까지만 (3 ≥ 1+3 아님) → 대화형은 3개를 연속으로 쓸 수 있어야 한다
    expect(await tryConsumeRateLimit('k', 10, 5)).toBe(true);
    expect(await tryConsumeRateLimit('k', 10, 5)).toBe(true);
    expect(await tryConsumeRateLimit('k', 10, 5)).toBe(true);
    expect(await tryConsumeRateLimit('k', 10, 5)).toBe(false);
  });

  it('시간이 지나면 토큰이 회복돼 배치도 다시 통과한다', async () => {
    const realNow = Date.now;
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      expect(await tryConsumeRateLimit('k', 10, 4, 3)).toBe(true);  // 4→3
      expect(await tryConsumeRateLimit('k', 10, 4, 3)).toBe(false); // 3 < 1+3
      now += 200; // 0.2s × 10/s = +2 → 4(버스트 상한)
      expect(await tryConsumeRateLimit('k', 10, 4, 3)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});
