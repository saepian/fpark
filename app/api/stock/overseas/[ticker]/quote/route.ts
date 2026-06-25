import { NextResponse } from 'next/server';
import YahooFinanceClass from 'yahoo-finance2';

export const dynamic = 'force-dynamic';

const yf = new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

  try {
    const result = await yf.quoteSummary(ticker, {
      modules: ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics'] as const,
    });

    const p  = result.price;
    const sd = result.summaryDetail;
    const fd = result.financialData;
    const ks = result.defaultKeyStatistics;

    const totalRevenue  = fd?.totalRevenue  ?? null;
    const profitMargins = fd?.profitMargins ?? null;

    return NextResponse.json({
      name:         p?.shortName ?? p?.longName ?? ticker,
      exchange:     p?.exchangeName ?? '',
      exchangeCode: p?.exchange ?? '',
      currency:     p?.currency ?? 'USD',
      price:        p?.regularMarketPrice     ?? 0,
      change:       p?.regularMarketChange    ?? 0,
      changeRate:   (p?.regularMarketChangePercent ?? 0) * 100,
      open:         p?.regularMarketOpen      ?? null,
      high:         p?.regularMarketDayHigh   ?? null,
      low:          p?.regularMarketDayLow    ?? null,
      volume:       p?.regularMarketVolume    ?? null,
      marketCap:    p?.marketCap              ?? null,
      pe:           sd?.trailingPE            ?? null,
      pb:           ks?.priceToBook ?? sd?.priceToBook ?? null,
      week52High:   sd?.fiftyTwoWeekHigh      ?? 0,
      week52Low:    sd?.fiftyTwoWeekLow       ?? 0,
      revenue:      totalRevenue,
      operatingIncome: fd?.ebitda             ?? null,
      netIncome:    (profitMargins != null && totalRevenue != null)
        ? Math.round(profitMargins * totalRevenue) : null,
      roe:          fd?.returnOnEquity        ?? null,
      eps:          ks?.trailingEps           ?? null,
    });
  } catch (e) {
    console.error('[OVERSEAS QUOTE]', ticker, e);
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 502 });
  }
}
