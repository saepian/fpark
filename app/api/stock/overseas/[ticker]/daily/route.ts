import { NextResponse } from 'next/server';
import YahooFinanceClass from 'yahoo-finance2';

export const dynamic = 'force-dynamic';

const yf = new YahooFinanceClass({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

  try {
    const period2 = new Date();
    const period1 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const rows = await yf.historical(ticker, { period1, period2, interval: '1d' });
    if (!rows.length) throw new Error('no data');

    const sorted = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
    const recent = sorted.slice(0, 5);

    const result = recent.map((d, i) => {
      const prevClose = sorted[i + 1]?.close ?? d.close;
      const changeRate = prevClose > 0 ? ((d.close - prevClose) / prevClose) * 100 : 0;
      return {
        date: d.date.toISOString().split('T')[0],
        open:       d.open,
        high:       d.high,
        low:        d.low,
        close:      d.close,
        volume:     d.volume,
        changeRate,
      };
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error('[OVERSEAS DAILY]', ticker, e);
    return NextResponse.json({ error: '일별 시세 조회 실패' }, { status: 502 });
  }
}
