import { NextRequest, NextResponse } from 'next/server';
import YahooFinanceClass from 'yahoo-finance2';

export const dynamic = 'force-dynamic';

const yf = new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] });

const SECTOR_STOCKS: Record<string, string[]> = {
  'Technology':             ['AAPL','MSFT','NVDA','GOOGL','META','AVGO','ORCL','AMD','INTC','QCOM'],
  'Consumer Cyclical':      ['AMZN','TSLA','HD','MCD','NKE','SBUX','TGT','LOW'],
  'Financial Services':     ['JPM','BAC','WFC','GS','MS','V','MA','AXP'],
  'Healthcare':             ['JNJ','UNH','LLY','PFE','ABBV','MRK','TMO','DHR'],
  'Energy':                 ['XOM','CVX','COP','SLB','EOG','PXD'],
  'Communication Services': ['GOOGL','META','NFLX','DIS','CMCSA','T','VZ'],
  'Industrials':            ['CAT','HON','UPS','BA','GE','MMM','RTX'],
  'Consumer Defensive':     ['PG','KO','PEP','WMT','COST','CL'],
  'Utilities':              ['NEE','DUK','SO','D','AEP'],
  'Real Estate':            ['AMT','PLD','CCI','EQIX','PSA'],
  'Basic Materials':        ['LIN','APD','SHW','FCX','NEM'],
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ market: string; ticker: string }> },
) {
  const { market, ticker } = await params;

  // 미국 이외 시장은 하드코딩 맵 없음
  if (market !== 'us') {
    return NextResponse.json({ sector: '', industry: '', stocks: [] });
  }

  let sector = '';
  let industry = '';

  try {
    const result = await yf.quoteSummary(ticker, { modules: ['assetProfile'] as const });
    sector   = result.assetProfile?.sector   ?? '';
    industry = result.assetProfile?.industry ?? '';
  } catch {
    return NextResponse.json({ sector: '', industry: '', stocks: [] });
  }

  const peers = (SECTOR_STOCKS[sector] ?? [])
    .filter(t => t !== ticker)
    .slice(0, 6);

  if (peers.length === 0) {
    return NextResponse.json({ sector, industry, stocks: [] });
  }

  try {
    const base = new URL(req.url);
    const apiUrl = `${base.protocol}//${base.host}/api/market/overseas?tickers=${peers.join(',')}`;
    const res = await fetch(apiUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const stocks = res.ok ? await res.json() : [];
    return NextResponse.json({ sector, industry, stocks });
  } catch {
    return NextResponse.json({ sector, industry, stocks: [] });
  }
}
