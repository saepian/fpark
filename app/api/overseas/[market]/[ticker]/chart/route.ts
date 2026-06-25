import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const RANGE_MAP: Record<string, string> = {
  '1M': '1mo',
  '3M': '3mo',
  '6M': '6mo',
  '1Y': '1y',
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ market: string; ticker: string }> },
) {
  const { ticker } = await params;
  const period = req.nextUrl.searchParams.get('period') ?? '3M';
  const range  = RANGE_MAP[period] ?? '3mo';

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
    const data = await res.json();

    const result = data.chart?.result?.[0];
    if (!result) throw new Error('no chart data');

    const timestamps: number[]        = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const opens:   (number | null)[]  = quote.open   ?? [];
    const highs:   (number | null)[]  = quote.high   ?? [];
    const lows:    (number | null)[]  = quote.low    ?? [];
    const closes:  (number | null)[]  = quote.close  ?? [];
    const volumes: (number | null)[]  = quote.volume ?? [];

    const candles = timestamps
      .map((ts, i) => ({
        date:   new Date(ts * 1000).toISOString().split('T')[0],
        open:   opens[i],
        high:   highs[i],
        low:    lows[i],
        close:  closes[i],
        volume: volumes[i] ?? 0,
      }))
      .filter(d => d.open != null && d.high != null && d.low != null && d.close != null)
      .map(d => ({
        date:   d.date,
        open:   d.open   as number,
        high:   d.high   as number,
        low:    d.low    as number,
        close:  d.close  as number,
        volume: d.volume as number,
      }));

    return NextResponse.json(candles);
  } catch (e) {
    console.error('[OVERSEAS CHART]', ticker, e);
    return NextResponse.json({ error: '차트 데이터 조회 실패' }, { status: 502 });
  }
}
