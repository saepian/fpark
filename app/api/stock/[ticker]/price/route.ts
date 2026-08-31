import { NextRequest, NextResponse } from 'next/server';
import { fetchStockPriceCached, loadStockQuoteCache, stockPriceFromQuoteCache } from '../../../../../lib/kis-api';

export const dynamic = 'force-dynamic';

// 2026-08-31: 이 라우트에만 있던 market_cache TTL 캐시(장중 30초/장외 30분 + 마감 전
// 생성 캐시의 마감 후 1회 무효화)를 lib/kis-api.ts의 fetchStockPriceCached()로 끌어내려
// /api/watchlist·/api/dashboard/holdings·/api/search·종목상세 서버컴포넌트와 공유한다
// (트래픽 점검에서 "같은 종목을 유저마다·폴링마다 KIS 재조회"가 최상위 병목으로 확인됨).
// 이 라우트는 이제 얇은 래퍼 + 라이브 실패 시 폴백 체인(옛 캐시 → Yahoo)만 담당한다.
// 캐시 정책 변경(TTL 등)은 lib/kis-api.ts 한 곳에서만 한다.

async function fetchYahooPrice(ticker: string): Promise<{
  ticker: string; name: string; price: number;
  change: number; changeRate: number;
} | null> {
  for (const suffix of ['.KS', '.KQ']) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}${suffix}?interval=1d&range=1d`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const data = await res.json();
      const meta = data.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) continue;
      const price      = meta.regularMarketPrice as number;
      const prev       = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
      const change     = price - prev;
      const changeRate = prev > 0 ? ((price - prev) / prev) * 100 : 0;
      const name       = (meta.longName ?? meta.shortName ?? ticker) as string;
      console.log(`[PRICE] ${ticker} Yahoo(${suffix}) 폴백 성공: ${price}`);
      return { ticker, name, price, change, changeRate };
    } catch { continue; }
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  // 1순위: 공용 캐시(신선하면 캐시, 아니면 KIS 라이브 후 저장)
  try {
    const data = await fetchStockPriceCached(ticker, { waitForLock: false });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.warn(`[PRICE] KIS 실패 ${ticker}: ${message}, 캐시 폴백 시도`);
  }

  // 2순위: 캐시된 마지막 거래일 데이터(TTL 무관) — 휴장일에도 실제 거래량·거래대금·업종을 보여줄 수 있음
  const cached = await loadStockQuoteCache(ticker);
  if (cached) {
    console.error(`[PRICE] ${ticker} KIS 실패, 캐시로 대체 반환 (${cached.updatedAt} 기준)`);
    return NextResponse.json(stockPriceFromQuoteCache(ticker, cached));
  }

  // 3순위: Yahoo Finance (.KS → .KQ 순) — 가격만 확인 가능, 거래량/거래대금은 알 수 없음
  try {
    const yahoo = await fetchYahooPrice(ticker);
    if (yahoo) {
      return NextResponse.json({ ...yahoo, volume: 0, tradingValue: '-', sector: '', isPartial: true });
    }
  } catch (e) {
    console.error(`[PRICE] Yahoo 폴백 실패 ${ticker}:`, e);
  }

  return NextResponse.json({ error: '주가 데이터를 불러올 수 없습니다.' }, { status: 500 });
}
