import type { DartDividendSummary } from '@/lib/dart-api';
import type { DividendHistoryRow } from '@/lib/kis-api';

// 포트폴리오진단 "배당 정보" 섹션(2026-08-04 신설) — computeRiskMetrics/computeSurgeHistory와
// 동일하게 순수 계산 함수로 분리(신규 API 호출·AI 호출 없음, enrichment 단계에서 이미
// fetchDividendSummary/fetchDividendHistory로 받아둔 데이터만 집계).

export type DividendHoldingInput = {
  ticker: string;
  name: string;
  quantity: number;
  dividendSummary: DartDividendSummary | null;
  dividendHistory: DividendHistoryRow[];
};

export type DividendCalendarEntry = {
  month: number; // 1~12
  holdings: { ticker: string; name: string }[];
};

export type PortfolioDividendSummary = {
  expectedAnnualDividend: number;        // 원 — Σ(dividendPerShare × quantity), 최근 확정 배당 기준
  portfolioDividendYield: number | null; // % — expectedAnnualDividend / totalValue × 100, 계산 불가하면 null
  payingCount: number;                   // 배당 요약 또는 이력이 하나라도 있는 종목 수
  totalCount: number;                    // 전체 보유 종목 수
  calendar: DividendCalendarEntry[];     // 1~12월 고정 12칸, 이력 없는 달도 빈 배열로 포함
};

function parseMonth(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^\d{4}-(\d{2})-\d{2}$/);
  if (!m) return null;
  const month = Number(m[1]);
  return month >= 1 && month <= 12 ? month : null;
}

// 전체 보유 종목이 무배당(요약도 이력도 없음)이면 null — 호출부에서 섹션 자체를 렌더링하지 않는다.
export function computePortfolioDividendSummary(
  holdings: DividendHoldingInput[],
  totalValue: number,
): PortfolioDividendSummary | null {
  const payingHoldings = holdings.filter(h => h.dividendSummary !== null || h.dividendHistory.length > 0);
  if (payingHoldings.length === 0) return null;

  const expectedAnnualDividend = holdings.reduce((sum, h) => {
    const perShare = h.dividendSummary?.dividendPerShare;
    return perShare == null ? sum : sum + perShare * h.quantity;
  }, 0);

  const portfolioDividendYield =
    expectedAnnualDividend > 0 && totalValue > 0
      ? parseFloat(((expectedAnnualDividend / totalValue) * 100).toFixed(2))
      : null;

  // 월별 캘린더 — payDate(실제 지급월) 우선, 없으면(가장 최근 미지급 건) recordDate로 폴백.
  // 종목당 같은 달에 여러 해의 이력이 겹쳐도 1회만 반영(존재 여부만 관찰, 빈도는 다루지 않음).
  const monthMap = new Map<number, Map<string, { ticker: string; name: string }>>();
  for (let m = 1; m <= 12; m++) monthMap.set(m, new Map());

  for (const h of holdings) {
    const seenMonths = new Set<number>();
    for (const row of h.dividendHistory) {
      const month = parseMonth(row.payDate ?? row.recordDate);
      if (month === null || seenMonths.has(month)) continue;
      seenMonths.add(month);
      monthMap.get(month)!.set(h.ticker, { ticker: h.ticker, name: h.name });
    }
  }

  const calendar: DividendCalendarEntry[] = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return { month, holdings: Array.from(monthMap.get(month)!.values()) };
  });

  return {
    expectedAnnualDividend: Math.round(expectedAnnualDividend),
    portfolioDividendYield,
    payingCount: payingHoldings.length,
    totalCount: holdings.length,
    calendar,
  };
}
