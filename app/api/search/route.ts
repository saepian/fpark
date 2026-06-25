import { NextRequest, NextResponse } from 'next/server';
import { fetchStockPrice } from '../../../lib/kis-api';
import type { SearchResult } from '../../../lib/types';

export const dynamic = 'force-dynamic';

interface StockEntry {
  ticker: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
}

interface StockCache {
  items: StockEntry[];
  expiresAt: number;
}

let stockCache: StockCache | null = null;

async function fetchKrxMarket(market: 'KOSPI' | 'KOSDAQ'): Promise<StockEntry[]> {
  const marketType = market === 'KOSPI' ? 'stockMkt' : 'kosdaqMkt';
  const res = await fetch(
    `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType=${marketType}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://kind.krx.co.kr/corpgeneral/corpList.do',
      },
      cache: 'no-store',
    }
  );

  if (!res.ok) throw new Error(`KRX ${market} 조회 실패 [${res.status}]`);

  const buffer = await res.arrayBuffer();
  const html = new TextDecoder('euc-kr').decode(buffer);

  const items: StockEntry[] = [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;
  let isHeader = true;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    if (isHeader) { isHeader = false; continue; }
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    }
    if (cells.length >= 3) {
      const name = cells[0];
      const code = cells[2].replace(/\s/g, '');
      if (name && code.length === 6 && /^\d+$/.test(code)) {
        items.push({ ticker: code, name, market });
      }
    }
  }

  return items;
}

async function getStockList(): Promise<StockEntry[]> {
  if (stockCache && Date.now() < stockCache.expiresAt) {
    return stockCache.items;
  }
  const [kospi, kosdaq] = await Promise.all([
    fetchKrxMarket('KOSPI'),
    fetchKrxMarket('KOSDAQ'),
  ]);
  const items = [...kospi.reverse(), ...kosdaq.reverse()];
  stockCache = { items, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  return items;
}

const ALLOWED_EXCHANGES = new Set([
  'NMS', 'NYQ', 'NYSEArca', 'NGM', 'PCX', 'ASE', // 미국
  'JPX', 'TYO',                                    // 일본
  'HKG',                                           // 홍콩
  'SHH', 'SHZ',                                    // 중국
]);

function getMarket(exchange: string): string {
  if (['NMS', 'NYQ', 'NYSEArca', 'PCX', 'NGM', 'ASE'].includes(exchange)) return 'us';
  if (['JPX', 'TYO'].includes(exchange)) return 'jp';
  if (['HKG'].includes(exchange)) return 'hk';
  if (['SHH', 'SHZ'].includes(exchange)) return 'cn';
  return 'us';
}

function getCurrency(exchange: string): string {
  if (['JPX', 'TYO'].includes(exchange)) return '¥';
  if (['HKG'].includes(exchange)) return 'HK$';
  if (['SHH', 'SHZ'].includes(exchange)) return '¥';
  return '$';
}

async function fetchOverseasPrice(ticker: string): Promise<{ price: number; changeRate: number }> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(2000),
        cache: 'no-store',
      }
    );
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return { price: 0, changeRate: 0 };
    const price = meta.regularMarketPrice ?? 0;
    const prev  = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const changeRate = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    return { price, changeRate };
  } catch {
    return { price: 0, changeRate: 0 };
  }
}

async function withPrices(stocks: SearchResult[]): Promise<SearchResult[]> {
  const results = await Promise.allSettled(
    stocks.map(s => fetchOverseasPrice(s.ticker))
  );
  return stocks.map((s, i) => {
    const r = results[i];
    const { price, changeRate } = r.status === 'fulfilled' ? r.value : { price: 0, changeRate: 0 };
    return { ...s, price, changeRate };
  });
}

async function searchOverseas(q: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false&region=US`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();

    const quotes: Record<string, unknown>[] = (data.quotes ?? [])
      .filter((item: Record<string, unknown>) =>
        item.quoteType === 'EQUITY' &&
        ALLOWED_EXCHANGES.has(item.exchange as string)
      );

    // 중복 제거: 기본 심볼(점 없음) 우선, 이미 본 기본 심볼이면 점 포함 심볼 제외
    const seenBase = new Set<string>();
    const deduped: Record<string, unknown>[] = [];
    for (const item of quotes) {
      const sym  = item.symbol as string;
      const base = sym.includes('.') ? sym.split('.')[0] : sym;
      if (seenBase.has(base)) continue;
      seenBase.add(base);
      deduped.push(item);
    }

    return deduped.slice(0, 5).map(item => ({
      ticker:     item.symbol as string,
      name:       (item.shortname ?? item.longname ?? item.symbol) as string,
      price:      0,
      changeRate: 0,
      isOverseas: true,
      market:     getMarket(item.exchange as string),
      currency:   getCurrency(item.exchange as string),
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json([]);

  // 국내 KRX 검색 + 해외 Yahoo 검색 병렬 실행
  let stockList: StockEntry[];
  try {
    stockList = await getStockList();
  } catch (err) {
    console.error('[SEARCH] KRX 조회 실패:', err);
    // KRX 실패해도 해외 검색은 시도
    const overseas = await withPrices(await searchOverseas(q));
    return NextResponse.json(overseas.slice(0, 8));
  }

  const lower = q.toLowerCase();
  const scored = stockList
    .filter(s => s.ticker.includes(q) || s.name.toLowerCase().includes(lower))
    .map(s => {
      const n = s.name.toLowerCase();
      const score = n === lower || s.ticker === q ? 0 : n.startsWith(lower) ? 1 : 2;
      return { ...s, score };
    })
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length);

  const matched = scored.slice(0, 5);

  // 국내 가격 조회 + 해외 검색 병렬
  const [domesticResults, overseasResults] = await Promise.all([
    Promise.all(
      matched.map(async (s): Promise<SearchResult> => {
        try {
          const price = await fetchStockPrice(s.ticker);
          const name = (price.name && price.name !== s.ticker) ? price.name : s.name;
          return { ticker: s.ticker, name, price: price.price, changeRate: price.changeRate };
        } catch {
          return { ticker: s.ticker, name: s.name, price: 0, changeRate: 0 };
        }
      })
    ),
    searchOverseas(q).then(withPrices),
  ]);

  const combined = [...domesticResults, ...overseasResults].slice(0, 8);
  return NextResponse.json(combined);
}
