import { describe, it, expect } from 'vitest';
import { buildStateSentence, isFlatDelta } from './diagnosis-history-sentence';

describe('buildStateSentence — 그때/지금 상태 × 델타 방향 전 조합', () => {
  it('수익→수익 증가', () => {
    expect(buildStateSentence(5, 2, 20000)).toBe('직전 대비 +2.00%p(+20,000원) 늘며 수익 폭이 커졌습니다.');
  });
  it('수익→수익 감소', () => {
    expect(buildStateSentence(5, -2, -20000)).toBe('직전 대비 -2.00%p(-20,000원) 줄었지만, 여전히 수익 구간입니다.');
  });
  it('수익→수익 동일(2026-09-02 S-Oil 개장 전 실측 케이스: +0.00%p, +0원)', () => {
    expect(buildStateSentence(6.09, 0, 0)).toBe('직전 대비 +0.00%p(+0원) — 직전 진단과 동일한 수준입니다(수익 구간 유지).');
  });
  it('손실→손실 동일', () => {
    expect(buildStateSentence(-3.2, 0, 0)).toBe('직전 대비 +0.00%p(+0원) — 직전 진단과 동일한 수준입니다(손실 구간 유지).');
  });
  it('손실→손실 악화', () => {
    expect(buildStateSentence(-3, -1.5, -15000)).toBe('직전 대비 -1.50%p(-15,000원) — 손실 폭이 커졌습니다.');
  });
  it('손실→손실 회복', () => {
    expect(buildStateSentence(-3, 1.5, 15000)).toBe('직전 대비 +1.50%p(+15,000원) — 손실 폭이 줄었지만, 여전히 손실 구간입니다.');
  });
  it('수익→손실 전환', () => {
    expect(buildStateSentence(2, -5, -50000)).toBe('직전 대비 -5.00%p(-50,000원) — 직전 수익 구간에서 손실로 전환됐습니다.');
  });
  it('손실→수익 전환', () => {
    expect(buildStateSentence(-2, 5, 50000)).toBe('직전 대비 +5.00%p(+50,000원) — 직전 손실 구간에서 수익으로 전환됐습니다.');
  });
  it('표시 자릿수 기준 동일 판정 — 0.004%p·0.4원은 0으로 표시되므로 동일', () => {
    expect(isFlatDelta(0.004, 0.4)).toBe(true);
    expect(isFlatDelta(-0.004, -0.4)).toBe(true);
    expect(buildStateSentence(4, 0.004, 0.4)).toContain('동일한 수준');
  });
  it('수익률은 0.00%p로 표시돼도 금액이 움직였으면(큰 포지션) 금액 부호로 증감 서술', () => {
    expect(isFlatDelta(0.004, 400)).toBe(false);
    expect(buildStateSentence(4, 0.004, 400)).toBe('직전 대비 +0.00%p(+400원) 늘며 수익 폭이 커졌습니다.');
    expect(buildStateSentence(4, -0.004, -400)).toBe('직전 대비 -0.00%p(-400원) 줄었지만, 여전히 수익 구간입니다.');
    expect(buildStateSentence(-4, -0.004, -400)).toBe('직전 대비 -0.00%p(-400원) — 손실 폭이 커졌습니다.');
  });
  it('예전 버그 재현 방지 — 델타 0인데 "늘며/줄었지만/커졌습니다"가 나오면 안 됨', () => {
    for (const prev of [10, 0.5, 0, -0.5, -10]) {
      const s = buildStateSentence(prev, 0, 0);
      expect(s).not.toMatch(/늘며|줄었지만|커졌습니다/);
      expect(s).toContain('동일한 수준');
    }
  });
});
