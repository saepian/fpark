import { adminClient } from './supabase-admin';

// 국내(KOSPI/KOSDAQ) 종목 검색용 자체 마스터 테이블(stock_master) 관리.
//
// 배경: app/api/search가 매 검색요청마다 kind.krx.co.kr(KRX 상장법인목록 다운로드
// 페이지)을 실시간 스크래핑했는데, KRX가 Vercel 서버리스 IP를 403으로 차단하기
// 시작해(2026-08-18 실측) 국내 종목 검색이 완전히 막혔다. 이 스크래핑 로직 자체는
// 그대로 재사용하되, 매 요청이 아니라 크론(app/api/cron/stock-master-refresh)이
// 하루 1회만 실행해서 stock_master 테이블에 upsert한다. 검색 API는 이 테이블만
// 읽는다 — KRX가 다시 막혀도 그날 갱신만 건너뛰고 테이블의 기존 데이터로 계속 서빙.

export interface StockMasterEntry {
  ticker: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
}

async function fetchKrxMarket(market: 'KOSPI' | 'KOSDAQ'): Promise<StockMasterEntry[]> {
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

  const items: StockMasterEntry[] = [];
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

export interface RefreshStockMasterResult {
  kospi:  { ok: boolean; count: number };
  kosdaq: { ok: boolean; count: number };
}

// KRX 실패(403 등)는 해당 시장만 건너뛰고 기존 테이블 데이터를 그대로 유지한다 —
// 크론이 하루 걸러 실패해도 검색 자체는 어제(혹은 그 이전) 적재된 데이터로 계속 동작.
export async function refreshStockMaster(): Promise<RefreshStockMasterResult> {
  const [kospi, kosdaq] = await Promise.allSettled([
    fetchKrxMarket('KOSPI'),
    fetchKrxMarket('KOSDAQ'),
  ]);

  const result: RefreshStockMasterResult = {
    kospi:  { ok: false, count: 0 },
    kosdaq: { ok: false, count: 0 },
  };

  for (const [market, settled] of [['KOSPI', kospi], ['KOSDAQ', kosdaq]] as const) {
    if (settled.status === 'rejected') {
      console.error(`[stock-master] ${market} 조회 실패, 기존 테이블 데이터 유지:`, settled.reason);
      continue;
    }
    const items = settled.value;
    if (items.length === 0) {
      console.error(`[stock-master] ${market} 조회 결과 0건 — 응답 포맷 변경 의심, 갱신 생략(기존 데이터 유지)`);
      continue;
    }

    // KRX 상장법인목록 HTML에 동일 종목코드가 중복 행으로 나오는 경우가 있어(실측
    // 확인, 2026-08-18) 같은 upsert 배치 안에 동일 PK가 두 번 들어가면 Postgres가
    // "ON CONFLICT DO UPDATE command cannot affect row a second time"로 거부한다 —
    // ticker 기준으로 배치 내 중복을 제거해서 넘긴다.
    const now = new Date().toISOString();
    const dedupedByTicker = new Map(items.map((item) => [item.ticker, item]));
    const rows = Array.from(dedupedByTicker.values()).map((item) => ({ ...item, updated_at: now }));
    const { error } = await adminClient.from('stock_master').upsert(rows, { onConflict: 'ticker' });
    if (error) {
      console.error(`[stock-master] ${market} upsert 실패, 기존 테이블 데이터 유지:`, error);
      continue;
    }

    const key = market === 'KOSPI' ? 'kospi' : 'kosdaq';
    result[key] = { ok: true, count: rows.length };
    console.log(`[stock-master] ${market} 갱신 완료 — ${rows.length}건`);
  }

  return result;
}

export async function getStockMasterList(): Promise<StockMasterEntry[]> {
  const { data, error } = await adminClient
    .from('stock_master')
    .select('ticker, name, market');
  if (error) throw error;
  return (data ?? []) as StockMasterEntry[];
}
