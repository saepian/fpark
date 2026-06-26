import YahooFinanceClass from 'yahoo-finance2';

const yf = new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] });

export interface OverseasQuote {
  name: string;
  exchange: string;
  exchangeCode: string;
  currency: string;
  price: number;
  change: number;
  changeRate: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  week52High: number;
  week52Low: number;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  roe: number | null;
  eps: number | null;
}

export async function fetchOverseasQuote(ticker: string): Promise<OverseasQuote> {
  const result = await yf.quoteSummary(ticker, {
    modules: ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics'] as const,
  });

  const p  = result.price;
  const sd = result.summaryDetail;
  const fd = result.financialData;
  const ks = result.defaultKeyStatistics;

  const totalRevenue  = fd?.totalRevenue  ?? null;
  const profitMargins = fd?.profitMargins ?? null;

  return {
    name:            p?.shortName ?? p?.longName ?? ticker,
    exchange:        p?.exchangeName ?? '',
    exchangeCode:    p?.exchange ?? '',
    currency:        p?.currency ?? 'USD',
    price:           p?.regularMarketPrice          ?? 0,
    change:          p?.regularMarketChange         ?? 0,
    changeRate:      (p?.regularMarketChangePercent ?? 0) * 100,
    open:            p?.regularMarketOpen           ?? null,
    high:            p?.regularMarketDayHigh        ?? null,
    low:             p?.regularMarketDayLow         ?? null,
    volume:          p?.regularMarketVolume         ?? null,
    marketCap:       p?.marketCap                   ?? null,
    pe:              sd?.trailingPE                 ?? null,
    pb:              (ks?.priceToBook ?? sd?.priceToBook ?? null) as number | null,
    week52High:      sd?.fiftyTwoWeekHigh           ?? 0,
    week52Low:       sd?.fiftyTwoWeekLow            ?? 0,
    revenue:         totalRevenue,
    operatingIncome: fd?.ebitda                     ?? null,
    netIncome:       (profitMargins != null && totalRevenue != null)
      ? Math.round(profitMargins * totalRevenue) : null,
    roe:             fd?.returnOnEquity             ?? null,
    eps:             ks?.trailingEps                ?? null,
  };
}
