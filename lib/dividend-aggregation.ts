import type { DartDividendSummary } from '@/lib/dart-api';
import type { DividendHistoryRow, DividendKind } from '@/lib/kis-api';

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

// 2026-08-05: 종목×월 매트릭스 — "N월에 지급 이력이 있다"는 존재 여부만 보여주던 calendar와
// 달리, 셀 하나(종목·월)에 실제 지급된 연도별 날짜·금액까지 담아 상세정보(모달)에 쓴다.
// count/records는 최근 5년(dividendHistory 조회 범위) 안에서 그 달에 지급된 횟수·내역이며,
// "5년 중 몇 번"이지 "연간 몇 번"이 아니다 — 종목이 매년 같은 달에 낸다면 count는 최대 5.
export type DividendMatrixRecord = {
  year:           number;
  recordDate:     string;
  payDate:        string | null; // null이면 아직 지급 전(recordDate로만 월 판정된 건)
  kind:           DividendKind;
  kindLabel:      string;
  perShareAmount: number;
};
export type DividendMatrixCell = {
  count:   number;
  records: DividendMatrixRecord[]; // 연도 내림차순
};
export type DividendMatrixRow = {
  ticker: string;
  name:   string;
  months: (DividendMatrixCell | null)[]; // 길이 12, index 0 = 1월
};

export type PortfolioDividendSummary = {
  expectedAnnualDividend: number;        // 원 — Σ(dividendPerShare × quantity), 최근 확정 배당 기준
  portfolioDividendYield: number | null; // % — expectedAnnualDividend / totalValue × 100, 계산 불가하면 null
  payingCount: number;                   // 실제 지급이력(dividendHistory)이 있는 종목 수
  totalCount: number;                    // 전체 보유 종목 수
  excludedHoldings: { ticker: string; name: string }[]; // 지급이력 없어 matrix/calendar에서 빠진 종목(DART 요약만 있는 경우 포함)
  calendar: DividendCalendarEntry[];     // 1~12월 고정 12칸, 이력 없는 달도 빈 배열로 포함(과거 공유 리포트 호환용으로 유지)
  matrix: DividendMatrixRow[];           // 종목×월 상세 매트릭스(payingHoldings 순서, calendar의 상위 호환)
};

// 캡션에 제외 종목명을 나열할 때 너무 길어지지 않도록 최대 5개까지만 이름을 보여주고
// 그 이상은 "외 N개"로 축약한다(보유 종목 상한이 10개라 실제로는 최대 9개까지 나올 수 있음).
const EXCLUDED_NAMES_DISPLAY_LIMIT = 5;
export function formatExcludedHoldingsNote(excluded: { ticker: string; name: string }[]): string | null {
  if (excluded.length === 0) return null;
  const names = excluded.map(h => h.name);
  if (names.length <= EXCLUDED_NAMES_DISPLAY_LIMIT) return names.join(', ');
  return `${names.slice(0, EXCLUDED_NAMES_DISPLAY_LIMIT).join(', ')} 외 ${names.length - EXCLUDED_NAMES_DISPLAY_LIMIT}개`;
}

function parseMonth(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^\d{4}-(\d{2})-\d{2}$/);
  if (!m) return null;
  const month = Number(m[1]);
  return month >= 1 && month <= 12 ? month : null;
}

// 전체 보유 종목에 실제 지급이력(dividendHistory)이 하나도 없으면 null — 호출부에서 섹션
// 자체를 렌더링하지 않는다.
export function computePortfolioDividendSummary(
  holdings: DividendHoldingInput[],
  totalValue: number,
): PortfolioDividendSummary | null {
  // 2026-08-05: DART 요약(dividendSummary)만 있고 실제 지급이력(KIS dividendHistory)이 없는
  // 종목(예: 배당 공시는 있지만 KIS 5년 조회에는 안 잡히는 경우)을 이전엔 OR 조건으로 행에
  // 포함시켰다 — "모든 칸이 빈 행"이 생겨 다른 무배당 종목(둘 다 없음)과 다르게 취급되는
  // 모순이 있었다. 매트릭스는 "실제 지급이력이 있는 종목만" 보여주는 걸로 통일한다.
  const payingHoldings = holdings.filter(h => h.dividendHistory.length > 0);
  const excludedHoldings = holdings
    .filter(h => h.dividendHistory.length === 0)
    .map(h => ({ ticker: h.ticker, name: h.name }));
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

  // 종목×월 매트릭스 — calendar와 달리 종목당 같은 달의 여러 해 이력을 전부 보존한다
  // (dedupe 대상이 아니라 상세정보의 재료).
  const matrix: DividendMatrixRow[] = payingHoldings.map(h => {
    const months: (DividendMatrixCell | null)[] = Array.from({ length: 12 }, () => null);
    for (const row of h.dividendHistory) {
      const dateStr = row.payDate ?? row.recordDate;
      const month = parseMonth(dateStr);
      if (month === null) continue;
      const idx = month - 1;
      const cell = months[idx] ?? (months[idx] = { count: 0, records: [] });
      cell.count += 1;
      cell.records.push({
        year:           Number(dateStr.slice(0, 4)),
        recordDate:     row.recordDate,
        payDate:        row.payDate,
        kind:           row.kind,
        kindLabel:      row.kindLabel,
        perShareAmount: row.perShareAmount,
      });
    }
    for (const cell of months) cell?.records.sort((a, b) => b.year - a.year);
    return { ticker: h.ticker, name: h.name, months };
  });

  return {
    expectedAnnualDividend: Math.round(expectedAnnualDividend),
    portfolioDividendYield,
    payingCount: payingHoldings.length,
    totalCount: holdings.length,
    excludedHoldings,
    calendar,
    matrix,
  };
}
