import { NextRequest, NextResponse, after } from 'next/server';
import { fetchStockPrice } from '../../../../../lib/kis-api';
import { supabase } from '../../../../../lib/supabase';
import { isKoreanMarketOpen } from '../../../../../lib/market-utils';
import type { StockPrice } from '../../../../../lib/types';

export const dynamic = 'force-dynamic';

// app/api/stock/[ticker]/info/route.ts와 동일한 market_cache 패턴 재사용
const cacheKey = (ticker: string) => `stock_price_${ticker}`;

// 2026-07-15: 이 라우트가 매 요청마다 KIS를 라이브 호출해서 국내증시 페이지 5분
// 자동 새로고침 도입 후 부하 문제 확인 — TTL 캐시 추가. 종목분석 장중 신선도
// 로직(app/api/stock/[ticker]/analysis/route.ts)은 이 라우트를 거치지 않고
// fetchStockPrice()를 직접 호출하므로 이 캐시의 영향을 받지 않는다(격리 확인됨).
// 국내증시 5분 새로고침보다는 훨씬 짧아야 새로고침이 무의미해지지 않는다.
const CACHE_TTL_MS_OPEN   = 30_000;      // 장중 30초
const CACHE_TTL_MS_CLOSED = 30 * 60_000; // 장외 30분

async function loadCache(ticker: string): Promise<{ data: StockPrice; updatedAt: string } | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKey(ticker))
      .single();
    if (!cache?.data) return null;
    return { data: cache.data as StockPrice, updatedAt: cache.updated_at };
  } catch {
    return null;
  }
}

// await 없이 던지면 응답 직후 실행 컨텍스트가 얼어붙어 fetch가 중간에 끊길 수 있어
// after()로 등록 — 응답은 즉시 나가되 이 저장은 런타임이 끝까지 살려서 완료시킨다.
function saveCache(ticker: string, data: StockPrice) {
  after(async () => {
    const { error } = await supabase
      .from('market_cache')
      .upsert({ key: cacheKey(ticker), data, updated_at: new Date().toISOString() });
    if (error) console.warn(`[PRICE] ${ticker} 캐시 저장 실패:`, error.message);
  });
}

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

  // TTL 이내면 라이브 호출 없이 캐시 재사용
  const ttlMs = isKoreanMarketOpen() ? CACHE_TTL_MS_OPEN : CACHE_TTL_MS_CLOSED;
  const fresh = await loadCache(ticker);
  if (fresh && Date.now() - new Date(fresh.updatedAt).getTime() < ttlMs) {
    return NextResponse.json({ ...fresh.data, isCached: true, cachedAt: fresh.updatedAt });
  }

  // 1순위: KIS API
  try {
    const data = await fetchStockPrice(ticker, { waitForLock: false });
    saveCache(ticker, data);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.warn(`[PRICE] KIS 실패 ${ticker}: ${message}, 캐시 폴백 시도`);
  }

  // 2순위: 캐시된 마지막 거래일 데이터 — 휴장일에도 실제 거래량·거래대금·업종을 보여줄 수 있음
  const cached = await loadCache(ticker);
  if (cached) {
    console.error(`[PRICE] ${ticker} KIS 실패, 캐시로 대체 반환 (${cached.updatedAt} 기준)`);
    return NextResponse.json({ ...cached.data, isCached: true, cachedAt: cached.updatedAt });
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
