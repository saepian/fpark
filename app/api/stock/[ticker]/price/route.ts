import { NextRequest, NextResponse } from 'next/server';
import { fetchStockPrice } from '../../../../../lib/kis-api';

export const dynamic = 'force-dynamic';

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
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.warn(`[PRICE] KIS 실패 ${ticker}: ${message}, Yahoo 폴백 시도`);
  }

  // 2순위: Yahoo Finance (.KS → .KQ 순)
  try {
    const yahoo = await fetchYahooPrice(ticker);
    if (yahoo) {
      return NextResponse.json({ ...yahoo, volume: 0, tradingValue: '-', sector: '' });
    }
  } catch (e) {
    console.error(`[PRICE] Yahoo 폴백 실패 ${ticker}:`, e);
  }

  return NextResponse.json({ error: '주가 데이터를 불러올 수 없습니다.' }, { status: 500 });
}
