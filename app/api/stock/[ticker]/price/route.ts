import { NextRequest, NextResponse, after } from 'next/server';
import { fetchStockPrice } from '../../../../../lib/kis-api';
import { supabase } from '../../../../../lib/supabase';
import type { StockPrice } from '../../../../../lib/types';

export const dynamic = 'force-dynamic';

// app/api/stock/[ticker]/info/route.ts와 동일한 market_cache 패턴 재사용
const cacheKey = (ticker: string) => `stock_price_${ticker}`;

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

  // 1순위: KIS API
  try {
    const data = await fetchStockPrice(ticker);
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
