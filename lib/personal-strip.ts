// 메인 개인화 스트립(components/main/PersonalStrip.tsx)의 순수 계산 — vitest 대상 (2026-09-04 C).

export interface StripWatchItem { ticker: string; name: string; price: number; changeRate: number; market?: string | null }
export interface StripHolding { ticker: string; name: string; quantity: number; hidden?: boolean; currentPrice: number | null; changeRate: number | null; quoteFailed?: boolean }

// 등락률 절대값 상위 n개(시세 실패 price 0 제외). 동률이면 이름순으로 결정적.
export function topWatchMovers(items: StripWatchItem[], n = 5): StripWatchItem[] {
  return items
    .filter((w) => w.price > 0 && Number.isFinite(w.changeRate))
    .sort((a, b) => Math.abs(b.changeRate) - Math.abs(a.changeRate) || a.name.localeCompare(b.name))
    .slice(0, n);
}

export interface DashboardSummary {
  count: number;                 // 숨김 제외 보유 종목 수
  todayChangePct: number | null; // 오늘 평가 등락%(전일 종가 대비) — 시세 있는 종목만, 없으면 null
  pricedCount: number;
}

// 오늘 평가 등락% = (Σ 현재가×수량 − Σ 전일종가×수량) ÷ Σ 전일종가×수량. 전일종가는 현재가÷(1+등락률)로
// 역산(app/dashboard/page.tsx의 "오늘 하루치" 계산과 동일 — 새 API 호출 없이 구함).
export function summarizeDashboard(holdings: StripHolding[]): DashboardSummary {
  const visible = holdings.filter((h) => !h.hidden);
  let cur = 0, prev = 0, priced = 0;
  for (const h of visible) {
    if (h.quoteFailed || h.currentPrice == null || h.changeRate == null || h.currentPrice <= 0) continue;
    const prevClose = h.currentPrice / (1 + h.changeRate / 100);
    if (!Number.isFinite(prevClose) || prevClose <= 0) continue;
    cur += h.currentPrice * h.quantity;
    prev += prevClose * h.quantity;
    priced++;
  }
  return { count: visible.length, todayChangePct: prev > 0 ? ((cur - prev) / prev) * 100 : null, pricedCount: priced };
}

export function stockHref(item: { ticker: string; market?: string | null }): string {
  return item.market && item.market !== 'kr' ? `/overseas/${item.market}/${item.ticker}` : `/stock/${item.ticker}`;
}
