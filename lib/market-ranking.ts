import { getAccessToken, assertKisTokenValid, withKisTokenRetry } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

// app/api/market/ranking/route.ts(급등/급락/거래대금순/거래량순 조회)와
// app/api/cron/market-cache-warm/route.ts(장마감 스냅샷 캡처)가 공유하는 로직.
// route.ts 파일은 GET 등 인식된 라우트 핸들러 외의 named export를 두면 Next.js의
// 라우트 타입 검증(next build)이 실패하므로, 두 라우트가 공유해야 하는 함수는
// 반드시 이 lib 파일에 둔다.

export type MarketCacheJson = Database['public']['Tables']['market_cache']['Row']['data'];

export const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

export const cacheKeyFor = (tab: string) => `ranking_${tab}`;
// 장마감 스냅샷 전용 키 — market-cache-warm 크론이 15:35(KST)에 라이브로 찍어두는
// "전일 마감" 데이터. 장중 TTL 캐시(cacheKeyFor)와 분리해서 장중 갱신에 덮어써지지 않게 한다.
export const lastCloseCacheKeyFor = (tab: string) => `ranking_${tab}_lastclose`;

export const EXCLUDE_PATTERN = /ETN|ETF|ELW|인버스|레버리지|선물|PLUS|KODEX|TIGER|KBSTAR|ARIRANG|HANARO|ACE|SOL\s/;

export const kisHeaders = (token: string, trId: string) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
  appkey: process.env.KIS_APP_KEY!,
  appsecret: process.env.KIS_APP_SECRET!,
  tr_id: trId,
  custtype: 'P',
});

export interface StockRow {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  change: number;
  volume: number;
  tradingValue: number;
  isPrevDayClose?: boolean; // true면 실시간이 아니라 "전일 마감 기준" 스냅샷
  asOfDate?: string;        // isPrevDayClose일 때의 기준 거래일 (YYYY-MM-DD)
}

// KIS가 간헐적으로 이름/가격이 빈 stub row를 섞어 보내는 경우가 있어(2026-07-21 장중
// 관측), 네이버 폴백 경로(fetchNaverRanking)와 동일한 유효성 기준으로 걸러낸다.
export function isValidStockItem(item: any): boolean {
  const name = String(item.hts_kor_isnm ?? '').trim();
  const price = Number(item.stck_prpr);
  return name.length > 0 && price > 0;
}

export function mapRow(item: any, i: number): StockRow {
  return {
    rank: i + 1,
    ticker: item.stck_shrn_iscd || item.mksc_shrn_iscd || '',
    name: item.hts_kor_isnm,
    price: Number(item.stck_prpr),
    changeRate: Number(item.prdy_ctrt),
    change: Number(item.prdy_vrss),
    volume: Number(item.acml_vol),
    tradingValue: Math.round(Number(item.acml_tr_pbmn) / 1_000_000),
  };
}

export async function fetchFluctuation(blngClsCode: string) {
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();
    const params = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_COND_SCR_DIV_CODE: '20171',
      FID_INPUT_ISCD: '0001',
      FID_DIV_CLS_CODE: '0',
      FID_BLNG_CLS_CODE: blngClsCode,
      FID_TRGT_CLS_CODE: '111111111',
      FID_TRGT_EXLS_CLS_CODE: '000000',
      FID_INPUT_PRICE_1: '0',
      FID_INPUT_PRICE_2: '9999999',
      FID_VOL_CNT: '0',
      FID_INPUT_DATE_1: '',
    });
    const res = await fetch(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation?${params}`,
      { headers: kisHeaders(token, 'FHPST01710000'), cache: 'no-store' },
    );
    if (!res.ok) throw new Error(`FHPST01710000 HTTP ${res.status}`);
    const data = await res.json();
    assertKisTokenValid(data, 'FHPST01710000');
    if (data.rt_cd !== '0') throw new Error(`FHPST01710000 ${data.msg1 ?? ''}`);
    return data;
  });
}

// 네이버 급등/급락 스크래핑 (장 마감 폴백)
export async function fetchNaverRanking(type: '급등' | '급락', count = 50): Promise<StockRow[]> {
  const url = type === '급등'
    ? 'https://finance.naver.com/sise/sise_rise.naver'
    : 'https://finance.naver.com/sise/sise_fall.naver';

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Referer': 'https://finance.naver.com/',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });

  const buffer = await res.arrayBuffer();
  const html = new TextDecoder('euc-kr').decode(buffer);

  const tableMatch = html.match(/<table[^>]*class=['"]type_2['"][^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) {
    console.warn('[ranking] Naver: type_2 table not found');
    return [];
  }

  const rows: StockRow[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;

  while ((m = rowRe.exec(tableMatch[1])) !== null) {
    const rowHtml = m[1];
    const codeMatch = rowHtml.match(/code=(\d{6})/);
    if (!codeMatch) continue;

    const ticker = codeMatch[1];
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }
    if (cells.length < 9) continue;

    const rank = parseInt(cells[0], 10);
    if (isNaN(rank) || rank <= 0) continue;

    const name = cells[1].trim();
    const price = parseInt(cells[2].replace(/,/g, ''), 10);
    if (!name || isNaN(price) || price <= 0) continue;
    if (EXCLUDE_PATTERN.test(name)) continue;

    // cells[4]: "+29.99%" or "-5.23%"
    const changeRateStr = cells[4].replace(/[+%,]/g, '').trim();
    const changeRate = parseFloat(changeRateStr);
    // cells[3]: "상한가 2,810" or "상승 1,500" or "하락 200" — 숫자만 추출
    const changeAbs = parseInt(cells[3].replace(/[^0-9]/g, ''), 10) || 0;
    const change = changeRate >= 0 ? changeAbs : -changeAbs;

    const volume = parseInt(cells[5].replace(/,/g, ''), 10) || 0;
    const tradingValue = parseInt(cells[8].replace(/,/g, ''), 10) || 0;

    rows.push({ rank, ticker, name, price, changeRate, change, volume, tradingValue });
    if (rows.length >= count) break;
  }

  console.log(`[ranking] Naver ${type}: ${rows.length}행`);
  return rows;
}

export async function getCachedRanking(tab: string): Promise<StockRow[] | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKeyFor(tab))
      .single();
    if (!cache?.data) return null;
    return cache.data as unknown as StockRow[];
  } catch {
    return null;
  }
}

export async function getLastCloseRanking(tab: string): Promise<{ rows: StockRow[]; tradingDate: string } | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data')
      .eq('key', lastCloseCacheKeyFor(tab))
      .single();
    if (!cache?.data) return null;
    return cache.data as unknown as { rows: StockRow[]; tradingDate: string };
  } catch {
    return null;
  }
}

// 급등/급락 순위(FHPST01700000)를 라이브 파라미터(FID_INPUT_DATE_1='')로 조회.
// tab='급등'/'급락'의 장중 실시간 조회와, market-cache-warm의 장마감 스냅샷 캡처가
// 이 함수를 공유한다 — 과거 날짜 조회는 KIS가 지원하지 않는 것으로 확인되어
// (2026-07-24 실측) inputDate 파라미터 자체를 없앴다.
export async function fetchDailyRanking(tab: '급등' | '급락'): Promise<StockRow[]> {
  const data = await withKisTokenRetry(async () => {
    const token = await getAccessToken();
    const params = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_COND_SCR_DIV_CODE: '170',
      FID_INPUT_ISCD: '0001',
      FID_RANK_SORT_CLS_CODE: tab === '급등' ? '0' : '1',
      FID_INPUT_CNT_1: '0',
      FID_PRC_CLS_CODE: '0',
      FID_INPUT_PRICE_1: '',
      FID_INPUT_PRICE_2: '',
      FID_VOL_CNT: '',
      FID_TRGT_CLS_CODE: '111111111',
      FID_TRGT_EXLS_CLS_CODE: '000000',
      FID_DIV_CLS_CODE: '0',
      FID_INPUT_DATE_1: '',
      FID_RSFL_RATE1: '',
      FID_RSFL_RATE2: '',
      FID_RST_CLB_CODE: '',
    });
    const res = await fetch(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation?${params}`,
      { headers: kisHeaders(token, 'FHPST01700000'), cache: 'no-store' },
    );
    if (!res.ok) throw new Error(`FHPST01700000 HTTP ${res.status}`);
    const json = await res.json();
    assertKisTokenValid(json, 'FHPST01700000');
    if (json.rt_cd !== '0') throw new Error(`FHPST01700000 ${json.msg1}`);
    return json;
  });

  const rows: any[] = data.output ?? [];
  if (rows.length === 0) return [];
  rows.sort((a, b) =>
    tab === '급등'
      ? Number(b.prdy_ctrt) - Number(a.prdy_ctrt)
      : Number(a.prdy_ctrt) - Number(b.prdy_ctrt),
  );
  const filtered = rows.filter(item => !EXCLUDE_PATTERN.test(item.hts_kor_isnm ?? '') && isValidStockItem(item));
  if (filtered.length < rows.length) {
    console.warn(`[ranking] KIS ${tab}: 유효성/제외 필터로 ${rows.length - filtered.length}행 제외 (${rows.length}행 → ${filtered.length}행)`);
  }
  return filtered.slice(0, 50).map(mapRow);
}

// market-cache-warm 크론(평일 15:35 KST, 장마감 5분 후) 전용 — 그 시각까지도
// isKoreanMarketOpen()이 false를 반환하므로, 장 상태 판정과 무관하게 항상 라이브로
// 조회해 "당일 마감" 스냅샷을 별도 캐시 키(_lastclose)에 저장한다. GET 핸들러는 이
// 스냅샷을 장 시작 전 폴백으로 사용한다.
export async function captureLastCloseSnapshot(tab: '급등' | '급락'): Promise<{ ok: boolean; rowCount: number }> {
  try {
    let rows = await fetchDailyRanking(tab);
    if (rows.length === 0) {
      // 2026-07-24 검증 중 실측: 장중인데도 FHPST01700000가 한동안 0행을 반환하는
      // 경우를 직접 확인했다(같은 시각 /api/market/movers의 KIS 실시간 호출도 동일하게
      // 0행 → 네이버 폴백으로 넘어감). 마감 스냅샷이 이 시점에 걸리면 캐시가 아예 안
      // 채워지므로, 장중 라이브 경로와 동일하게 네이버를 폴백으로 둔다.
      console.warn(`[ranking] ${tab} KIS 마감 스냅샷 0행 — 네이버 폴백 시도`);
      rows = await fetchNaverRanking(tab);
    }
    if (rows.length === 0) {
      console.warn(`[ranking] ${tab} 마감 스냅샷 캡처 실패 — KIS/네이버 모두 0행`);
      return { ok: false, rowCount: 0 };
    }
    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const tradingDate = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-${String(kst.getDate()).padStart(2, '0')}`;
    const { error } = await supabase.from('market_cache').upsert({
      key: lastCloseCacheKeyFor(tab),
      data: { rows, tradingDate } as unknown as MarketCacheJson,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error(`[ranking] ${tab} 마감 스냅샷 저장 실패:`, error.message);
      return { ok: false, rowCount: rows.length };
    }
    console.log(`[ranking] ${tab} 마감 스냅샷 저장 완료 (${rows.length}행, ${tradingDate})`);
    return { ok: true, rowCount: rows.length };
  } catch (e) {
    console.error(`[ranking] ${tab} 마감 스냅샷 캡처 예외:`, e instanceof Error ? e.message : e);
    return { ok: false, rowCount: 0 };
  }
}
