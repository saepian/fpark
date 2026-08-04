import { describe, it, expect } from 'vitest';
import { computeSentimentScore } from './news-sentiment';

describe('computeSentimentScore', () => {
  it('기사가 없으면 null', () => {
    expect(computeSentimentScore({ positive: 0, negative: 0, neutral: 0 })).toBeNull();
  });

  it('전부 긍정이면 1', () => {
    expect(computeSentimentScore({ positive: 3, negative: 0, neutral: 0 })).toBe(1);
  });

  it('전부 부정이면 -1', () => {
    expect(computeSentimentScore({ positive: 0, negative: 3, neutral: 0 })).toBe(-1);
  });

  it('긍정/부정 상쇄되면 0', () => {
    expect(computeSentimentScore({ positive: 2, negative: 2, neutral: 1 })).toBe(0);
  });

  it('중립만 있으면 0', () => {
    expect(computeSentimentScore({ positive: 0, negative: 0, neutral: 5 })).toBe(0);
  });

  it('소수점 둘째 자리로 반올림', () => {
    // (2-1)/3 = 0.333... -> 0.33
    expect(computeSentimentScore({ positive: 2, negative: 1, neutral: 0 })).toBe(0.33);
  });
});
