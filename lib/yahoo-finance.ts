import YahooFinanceClass from 'yahoo-finance2';
import type { ChartDataPoint } from './types';

const yf = new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] });

// 2026-07-13 해외물 종목 리포트 재설계 — 국내물의 computeSurgeHistory/
// computeTradingValueMultiple/computeRiskMetrics(lib/stock-analysis-data.ts)는
// ChartDataPoint[](오름차순, 오늘이 마지막 행)만 있으면 데이터 소스에 무관하게
// 그대로 재사용 가능하다. yahoo-finance2의 historical()을 그 형태로 변환하는
// 어댑터. tradingValue는 KIS처럼 원 단위 거래대금이 직접 오지 않아 close*volume으로
// 근사(통화 단위가 달라도 "20일 평균 대비 배수"는 비율이라 문제 없음).
export async function fetchOverseasChart(ticker: string, days = 380): Promise<ChartDataPoint[]> {
  const period2 = new Date();
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await yf.historical(ticker, { period1, period2, interval: '1d' });
  return [...rows]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((d) => ({
      date:  d.date.toISOString().split('T')[0],
      open:  d.open,
      high:  d.high,
      low:   d.low,
      close: d.close,
      volume: d.volume,
      tradingValue: d.close > 0 && d.volume > 0 ? d.close * d.volume : undefined,
    }));
}

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
