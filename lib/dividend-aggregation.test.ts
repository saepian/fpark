import { describe, it, expect } from 'vitest';
import { computePortfolioDividendSummary, type DividendHoldingInput } from './dividend-aggregation';

function summary(dividendPerShare: number | null, dividendYield: number | null = null) {
  return dividendPerShare === null ? null : { year: '2025', dividendYield, dividendPerShare, payoutRatio: null };
}

function historyRow(recordDate: string, payDate: string | null, perShareAmount = 500) {
  return {
    recordDate, kind: '분기' as const, kindLabel: '분기배당',
    perShareAmount, dividendRate: null, payDate,
  };
}

describe('computePortfolioDividendSummary', () => {
  it('배당종목+무배당종목 혼합 — 합산 배당금·수익률·payingCount가 배당종목만 반영한다', () => {
    const holdings: DividendHoldingInput[] = [
      { ticker: 'A', name: 'A사', quantity: 10, dividendSummary: summary(1000), dividendHistory: [historyRow('2026-03-31', '2026-04-20')] },
      { ticker: 'B', name: 'B사', quantity: 5,  dividendSummary: null,          dividendHistory: [] }, // 무배당
    ];
    const result = computePortfolioDividendSummary(holdings, 1_000_000);
    expect(result).not.toBeNull();
    expect(result!.expectedAnnualDividend).toBe(10000); // 1000원 × 10주
    expect(result!.portfolioDividendYield).toBe(1); // 10000/1000000*100
    expect(result!.payingCount).toBe(1);
    expect(result!.totalCount).toBe(2);
  });

  it('전체 무배당 포트폴리오 — null 반환(호출부가 섹션을 숨김)', () => {
    const holdings: DividendHoldingInput[] = [
      { ticker: 'A', name: 'A사', quantity: 10, dividendSummary: null, dividendHistory: [] },
      { ticker: 'B', name: 'B사', quantity: 5,  dividendSummary: null, dividendHistory: [] },
    ];
    expect(computePortfolioDividendSummary(holdings, 1_000_000)).toBeNull();
  });

  it('payDate 우선, null이면 recordDate로 폴백해서 월을 판정한다', () => {
    const holdings: DividendHoldingInput[] = [
      {
        ticker: 'A', name: 'A사', quantity: 1, dividendSummary: null,
        dividendHistory: [
          historyRow('2025-12-31', '2026-04-15'), // payDate 우선 → 4월
          historyRow('2025-06-30', null),          // payDate 없음 → recordDate(6월)로 폴백
        ],
      },
    ];
    const result = computePortfolioDividendSummary(holdings, 100);
    const april = result!.calendar.find(c => c.month === 4)!;
    const june  = result!.calendar.find(c => c.month === 6)!;
    const december = result!.calendar.find(c => c.month === 12)!;
    expect(april.holdings.map(h => h.ticker)).toEqual(['A']);
    expect(june.holdings.map(h => h.ticker)).toEqual(['A']);
    expect(december.holdings).toEqual([]); // payDate로 대체된 12월 recordDate는 반영 안 됨
  });

  it('같은 종목이 같은 달에 여러 해 이력을 가져도 1회만 반영한다(중복 제거)', () => {
    const holdings: DividendHoldingInput[] = [
      {
        ticker: 'A', name: 'A사', quantity: 1, dividendSummary: null,
        dividendHistory: [
          historyRow('2024-03-31', '2024-04-20'),
          historyRow('2025-03-31', '2025-04-18'),
        ],
      },
    ];
    const result = computePortfolioDividendSummary(holdings, 100);
    const april = result!.calendar.find(c => c.month === 4)!;
    expect(april.holdings).toHaveLength(1);
  });

  it('배당 이력은 있지만 dividendPerShare가 없는 경우 — 합산 배당금은 0, 수익률은 null(0%로 오인 방지)', () => {
    const holdings: DividendHoldingInput[] = [
      { ticker: 'A', name: 'A사', quantity: 10, dividendSummary: null, dividendHistory: [historyRow('2026-03-31', '2026-04-20')] },
    ];
    const result = computePortfolioDividendSummary(holdings, 1_000_000);
    expect(result).not.toBeNull();
    expect(result!.expectedAnnualDividend).toBe(0);
    expect(result!.portfolioDividendYield).toBeNull();
    expect(result!.payingCount).toBe(1); // dividendHistory가 있으므로 "배당 데이터 있음"으로는 카운트
  });

  it('totalValue가 0 이하면 수익률은 null(0으로 나누지 않음)', () => {
    const holdings: DividendHoldingInput[] = [
      { ticker: 'A', name: 'A사', quantity: 10, dividendSummary: summary(1000), dividendHistory: [] },
    ];
    const result = computePortfolioDividendSummary(holdings, 0);
    expect(result!.expectedAnnualDividend).toBe(10000);
    expect(result!.portfolioDividendYield).toBeNull();
  });

  it('12칸 캘린더가 항상 고정 배열로 반환된다(빈 달도 포함)', () => {
    const holdings: DividendHoldingInput[] = [
      { ticker: 'A', name: 'A사', quantity: 1, dividendSummary: summary(100), dividendHistory: [] },
    ];
    const result = computePortfolioDividendSummary(holdings, 100);
    expect(result!.calendar).toHaveLength(12);
    expect(result!.calendar.map(c => c.month)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
  });
});
