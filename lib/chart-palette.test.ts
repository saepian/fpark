import { describe, it, expect } from 'vitest';
import { SLICE_COLORS, sliceColorCycled } from './chart-palette';

// 2026-09-01 도넛 팔레트 공용화 — 대시보드·포트폴리오분석 도넛이 같은 순환 규칙을 쓴다.
describe('sliceColorCycled', () => {
  it('첫 바퀴는 팔레트 원색, 두 번째 바퀴부터는 같은 색을 옅게(알파) 순환한다', () => {
    expect(sliceColorCycled(0)).toBe(SLICE_COLORS[0]);
    expect(sliceColorCycled(7)).toBe(SLICE_COLORS[7]);
    expect(sliceColorCycled(8).startsWith(SLICE_COLORS[0])).toBe(true);
    expect(sliceColorCycled(8).length).toBe(9); // #rrggbbaa
    expect(sliceColorCycled(8)).not.toBe(sliceColorCycled(0));
  });
  it('워치리스트 한도(15개)까지 전부 유효한 색 문자열', () => {
    for (let i = 0; i < 15; i++) expect(sliceColorCycled(i)).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
  });
});
