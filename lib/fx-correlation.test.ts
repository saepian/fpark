import { describe, it, expect } from 'vitest';
import { computeFxCorrelation, isFxCorrelationMeaningful } from './fx-correlation';
import type { ChartDataPoint } from './types';

function chart(dates: string[], closes: number[]): ChartDataPoint[] {
  return dates.map((date, i) => ({ date, open: closes[i], high: closes[i], low: closes[i], close: closes[i], volume: 0 }));
}

// 30영업일 이상 필요(MIN_SAMPLE_SIZE) — 간단히 날짜 생성
function dates(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
}

describe('computeFxCorrelation', () => {
  it('완전히 같은 방향으로 움직이면 상관계수가 1에 가깝다', () => {
    const d = dates(31);
    const stockCloses = [100];
    const fxCloses = [1000];
    for (let i = 1; i < 31; i++) {
      stockCloses.push(stockCloses[i - 1] * (1 + (i % 2 === 0 ? 0.01 : -0.01)));
      fxCloses.push(fxCloses[i - 1] * (1 + (i % 2 === 0 ? 0.02 : -0.02)));
    }
    const result = computeFxCorrelation(chart(d, stockCloses), d.map((date, i) => ({ date, close: fxCloses[i] })));
    expect(result).not.toBeNull();
    expect(result!.correlation).toBeGreaterThan(0.9);
    expect(isFxCorrelationMeaningful(result)).toBe(true);
  });

  it('반대로 움직이면 상관계수가 음수', () => {
    const d = dates(31);
    const stockCloses = [100];
    const fxCloses = [1000];
    for (let i = 1; i < 31; i++) {
      stockCloses.push(stockCloses[i - 1] * (1 + (i % 2 === 0 ? 0.01 : -0.01)));
      fxCloses.push(fxCloses[i - 1] * (1 + (i % 2 === 0 ? -0.02 : 0.02)));
    }
    const result = computeFxCorrelation(chart(d, stockCloses), d.map((date, i) => ({ date, close: fxCloses[i] })));
    expect(result).not.toBeNull();
    expect(result!.correlation).toBeLessThan(-0.9);
  });

  it('날짜 교집합이 30개 미만이면 null', () => {
    const d = dates(10);
    const stockCloses = d.map((_, i) => 100 + i);
    const fxCloses = d.map((_, i) => 1000 + i);
    const result = computeFxCorrelation(chart(d, stockCloses), d.map((date, i) => ({ date, close: fxCloses[i] })));
    expect(result).toBeNull();
  });

  it('날짜가 안 겹치면(교집합 없음) null', () => {
    const stockDates = dates(31);
    const fxDates = Array.from({ length: 31 }, (_, i) => `2027-02-${String(i + 1).padStart(2, '0')}`);
    const stockCloses = stockDates.map((_, i) => 100 + i);
    const fxCloses = fxDates.map((_, i) => 1000 + i);
    const result = computeFxCorrelation(
      chart(stockDates, stockCloses),
      fxDates.map((date, i) => ({ date, close: fxCloses[i] })),
    );
    expect(result).toBeNull();
  });

  it('isFxCorrelationMeaningful은 |r| < 0.3이면 false', () => {
    expect(isFxCorrelationMeaningful({ correlation: 0.15, sampleSize: 100 })).toBe(false);
    expect(isFxCorrelationMeaningful({ correlation: -0.29, sampleSize: 100 })).toBe(false);
    expect(isFxCorrelationMeaningful({ correlation: 0.3, sampleSize: 100 })).toBe(true);
    expect(isFxCorrelationMeaningful(null)).toBe(false);
  });
});
