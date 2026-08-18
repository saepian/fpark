import { NextRequest, NextResponse } from 'next/server';
import { fetchStockPrice } from '../../../lib/kis-api';
import { getStockMasterList, type StockMasterEntry } from '../../../lib/krx-stock-master';
import type { SearchResult } from '../../../lib/types';

export const dynamic = 'force-dynamic';

type StockEntry = StockMasterEntry;

interface StockCache {
  items: StockEntry[];
  expiresAt: number;
}

let stockCache: StockCache | null = null;

// 국내 종목 목록은 KRX 실시간 스크래핑(app/api/cron/stock-master-refresh가 하루 1회
// 갱신)이 아니라 stock_master 테이블에서 읽는다 — KRX가 Vercel 서버리스 IP를 403으로
// 막아 매 요청 스크래핑이 항상 실패하던 문제(2026-08-18)의 근본 수정. 인스턴스 메모리
// 캐시는 그대로 유지 — 테이블이 하루 1회만 바뀌므로 매 요청 DB 왕복을 줄여준다.
async function getStockList(): Promise<StockEntry[]> {
  if (stockCache && Date.now() < stockCache.expiresAt) {
    return stockCache.items;
  }
  const items = await getStockMasterList();
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

  // 국내 stock_master 테이블 조회 + 해외 Yahoo 검색 병렬 실행
  let stockList: StockEntry[];
  try {
    stockList = await getStockList();
  } catch (err) {
    // stock_master는 크론이 하루 1회 채우는 테이블이라 정상 운영 중엔 실패하지 않는다 —
    // 여기 도달하면 DB 연결 장애 등 이상 상황이므로 반드시 로그에 남긴다(2026-08-18).
    console.error('[SEARCH] stock_master 조회 실패:', err);
    // 국내 조회 실패해도 해외 검색은 시도
    const overseas = await withPrices(await searchOverseas(q));
    return NextResponse.json(overseas.slice(0, 8));
  }

  const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, '');
  const lower     = q.normalize('NFC').toLowerCase();
  const lowerFlat = norm(q);

  const scored = stockList
    .filter(s => {
      const n     = s.name.normalize('NFC').toLowerCase();
      const nFlat = norm(s.name);
      return s.ticker.includes(q) || n.includes(lower) || nFlat.includes(lowerFlat);
    })
    .map(s => {
      const n = s.name.normalize('NFC').toLowerCase();
      const score = n === lower || s.ticker === q ? 0 : n.startsWith(lower) ? 1 : 2;
      return { ...s, score };
    })
    // 동점(스코어·이름길이 동일)일 때 예전엔 KRX HTML 원본 순서에 우연히 기댔는데,
    // stock_master 테이블 SELECT 순서는 보장되지 않아(2026-08-18) 티커 오름차순을
    // 마지막 기준으로 추가해 결과 순서를 결정적으로 고정한다.
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.ticker.localeCompare(b.ticker));

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
