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

// 모듈 레벨 캐시: 동일 Node.js 프로세스 내에서 재사용
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
  // <tr>...</tr> 블록 전체 추출
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

  // KRX는 최신 상장 순서 → 역순으로 뒤집으면 오래된(유명한) 종목이 앞에 옴
  const items = [...kospi.reverse(), ...kosdaq.reverse()];
  stockCache = { items, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  return items;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';

  if (!q) return NextResponse.json([]);

  let stockList: StockEntry[];
  try {
    stockList = await getStockList();
  } catch (err) {
    console.error('[SEARCH] KRX 조회 실패, 빈 결과 반환:', err);
    return NextResponse.json([]);
  }

  const lower = q.toLowerCase();
  const scored = stockList
    .filter((s) => s.ticker.includes(q) || s.name.toLowerCase().includes(lower))
    .map((s) => {
      const n = s.name.toLowerCase();
      // 정확 일치 > ticker 일치 > 시작 일치 > 포함 순
      const score = n === lower || s.ticker === q ? 0 : n.startsWith(lower) ? 1 : 2;
      return { ...s, score };
    })
    // 같은 score면 이름 짧은 것 우선 (삼성전자 < 삼성바이오로직스)
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length);

  const matched = scored.slice(0, 8);

  if (matched.length === 0) return NextResponse.json([]);

  const results = await Promise.all(
    matched.map(async (s): Promise<SearchResult> => {
      try {
        const price = await fetchStockPrice(s.ticker);
        const name = (price.name && price.name !== s.ticker) ? price.name : s.name;
        return { ticker: s.ticker, name, price: price.price, changeRate: price.changeRate };
      } catch {
        return { ticker: s.ticker, name: s.name, price: 0, changeRate: 0 };
      }
    })
  );

  return NextResponse.json(results);
}
