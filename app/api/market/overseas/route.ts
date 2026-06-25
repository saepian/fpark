import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STOCK_NAMES: Record<string, string> = {
  // 미국
  AAPL:  'Apple',
  MSFT:  'Microsoft',
  NVDA:  'NVIDIA',
  GOOGL: 'Alphabet',
  AMZN:  'Amazon',
  META:  'Meta',
  TSLA:  'Tesla',
  AVGO:  'Broadcom',
  JPM:   'JP Morgan',
  V:     'Visa',
  UNH:   'UnitedHealth',
  XOM:   'ExxonMobil',
  LLY:   'Eli Lilly',
  JNJ:   'Johnson & Johnson',
  MA:    'Mastercard',
  PG:    'Procter & Gamble',
  HD:    'Home Depot',
  MRK:   'Merck',
  COST:  'Costco',
  ORCL:  'Oracle',
  // 일본
  '7203.T': 'Toyota',
  '6758.T': 'Sony',
  '9984.T': 'SoftBank',
  '6861.T': 'Keyence',
  '6954.T': 'Fanuc',
  '6501.T': 'Hitachi',
  '9432.T': 'NTT',
  '8306.T': 'Mitsubishi UFJ',
  '4063.T': 'Shin-Etsu Chemical',
  '6367.T': 'Daikin',
  // 홍콩
  '0700.HK': 'Tencent',
  '9988.HK': 'Alibaba',
  '3690.HK': 'Meituan',
  '1211.HK': 'BYD',
  '0005.HK': 'HSBC',
  '0941.HK': 'China Mobile',
  '1299.HK': 'AIA Group',
  '2318.HK': 'Ping An Insurance',
  '0388.HK': 'HKEX',
  '2020.HK': 'ANTA Sports',
  // 중국
  '600519.SS': '귀주모태주',
  '300750.SZ': 'CATL',
  '601318.SS': '중국평안보험',
  '601166.SS': '흥업은행',
  '000858.SZ': '오량액',
  '601988.SS': '중국은행',
  '600036.SS': '초상은행',
  '000333.SZ': '메이디그룹',
  '002594.SZ': 'BYD',
  '600900.SS': '장강전력',
};

// S&P 500 시가총액 기준 순위 (2025년 기준, 정기 업데이트)
const US_MARKET_CAP_RANK: Record<string, number> = {
  NVDA:  1,
  AAPL:  2,
  MSFT:  3,
  GOOGL: 4,
  AMZN:  5,
  META:  6,
  TSLA:  7,
  AVGO:  8,
  LLY:   9,
  JPM:  10,
  V:    11,
  UNH:  12,
  XOM:  13,
  ORCL: 14,
  MA:   15,
  COST: 16,
  JNJ:  17,
  PG:   18,
  HD:   19,
  MRK:  20,
};

async function fetchYahooStock(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });
  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  const price      = meta.regularMarketPrice as number;
  const prev       = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
  const change     = meta.regularMarketChange     ?? (price - prev);
  const changeRate = meta.regularMarketChangePercent ?? (prev > 0 ? ((price - prev) / prev) * 100 : 0);
  return { ticker, name: STOCK_NAMES[ticker] ?? ticker, price, change, changeRate };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get('tickers') ?? '';
  const country      = searchParams.get('country') ?? '';
  const tickers = tickersParam.split(',').map(t => t.trim()).filter(Boolean);

  if (tickers.length === 0) {
    return NextResponse.json({ error: 'tickers parameter required' }, { status: 400 });
  }

  const results = await Promise.allSettled(tickers.map(fetchYahooStock));
  const stocks = results
    .filter((r): r is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof fetchYahooStock>>>> =>
      r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  if (country === 'us') {
    stocks.sort((a, b) => {
      const ra = US_MARKET_CAP_RANK[a.ticker] ?? 999;
      const rb = US_MARKET_CAP_RANK[b.ticker] ?? 999;
      return ra - rb;
    });
  }

  return NextResponse.json(stocks);
}
