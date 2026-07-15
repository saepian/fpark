import { after } from 'next/server';
import { getAccessToken, assertKisTokenValid, withKisTokenRetry } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';
import { isKoreanMarketOpen, getLastTradingDate } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
// 2026-07-15: 이 상수가 정의만 되고 실제 TTL 게이팅에 쓰이지 않던 죽은 코드였음(캐시는
// KIS/네이버 실패 시 폴백으로만 쓰였고, 매 요청이 항상 라이브 호출이었다) — 국내증시
// 페이지 5분 자동 새로고침 도입 후 부하 문제로 실제 TTL 캐시로 전환.
const CACHE_TTL_MS_OPEN   = 60_000;      // 장중 1분 — 순위는 급격히 안 바뀜
const CACHE_TTL_MS_CLOSED = 30 * 60_000; // 장외 30분
const cacheKeyFor = (tab: string) => `ranking_${tab}`;

const EXCLUDE_PATTERN = /ETN|ETF|ELW|인버스|레버리지|선물|PLUS|KODEX|TIGER|KBSTAR|ARIRANG|HANARO|ACE|SOL\s/;

const kisHeaders = (token: string, trId: string) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
  appkey: process.env.KIS_APP_KEY!,
  appsecret: process.env.KIS_APP_SECRET!,
  tr_id: trId,
  custtype: 'P',
});

interface StockRow {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  change: number;
  volume: number;
  tradingValue: number;
}

function mapRow(item: any, i: number): StockRow {
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

async function fetchFluctuation(blngClsCode: string) {
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
async function fetchNaverRanking(type: '급등' | '급락', count = 50): Promise<StockRow[]> {
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

async function getCachedRanking(tab: string): Promise<StockRow[] | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKeyFor(tab))
      .single();
    if (!cache?.data) return null;
    return cache.data as StockRow[];
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get('tab') || '거래대금순';

  // TTL 이내면 라이브 호출(및 KIS 인증) 없이 캐시 재사용
  const ttlMs = isKoreanMarketOpen() ? CACHE_TTL_MS_OPEN : CACHE_TTL_MS_CLOSED;
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKeyFor(tab))
      .single();
    if (cache) {
      const age = Date.now() - new Date(cache.updated_at).getTime();
      if (age < ttlMs) {
        console.log(`[ranking] ${tab} TTL 캐시 히트 (${Math.round(age / 1000)}s < ${ttlMs / 1000}s) — 라이브 호출 생략`);
        return Response.json(cache.data as StockRow[]);
      }
    }
  } catch (e) {
    console.warn(`[ranking] ${tab} TTL 캐시 조회 실패, 라이브로 진행:`, e instanceof Error ? e.message : e);
  }

  try {
    await getAccessToken();
  } catch {
    return Response.json({ error: '인증 실패' }, { status: 500 });
  }

  try {
    // ── 거래대금순 ────────────────────────────────────────────────
    if (tab === '거래대금순') {
      try {
        const data = await fetchFluctuation('0');
        const rows: any[] = data.output ?? [];
        rows.sort((a, b) => Number(b.acml_tr_pbmn) - Number(a.acml_tr_pbmn));
        const result = rows.slice(0, 50).map(mapRow);
        after(async () => {
          const { error } = await supabase.from('market_cache').upsert({ key: cacheKeyFor(tab), data: result, updated_at: new Date().toISOString() });
          if (error) console.warn(`[ranking] ${tab} 캐시 저장 실패:`, error.message);
        });
        return Response.json(result);
      } catch (e) {
        console.warn(`[ranking] ${tab} KIS 실패, 캐시 폴백 시도:`, e instanceof Error ? e.message : e);
        const cached = await getCachedRanking(tab);
        if (cached) return Response.json(cached);
        throw e;
      }
    }

    // ── 거래량순 ──────────────────────────────────────────────────
    if (tab === '거래량순') {
      try {
        const data = await fetchFluctuation('1');
        const rows: any[] = data.output ?? [];
        rows.sort((a, b) => Number(b.acml_vol) - Number(a.acml_vol));
        const result = rows.slice(0, 50).map(mapRow);
        after(async () => {
          const { error } = await supabase.from('market_cache').upsert({ key: cacheKeyFor(tab), data: result, updated_at: new Date().toISOString() });
          if (error) console.warn(`[ranking] ${tab} 캐시 저장 실패:`, error.message);
        });
        return Response.json(result);
      } catch (e) {
        console.warn(`[ranking] ${tab} KIS 실패, 캐시 폴백 시도:`, e instanceof Error ? e.message : e);
        const cached = await getCachedRanking(tab);
        if (cached) return Response.json(cached);
        throw e;
      }
    }

    // ── 급등 / 급락 ──────────────────────────────────────────────
    if (tab === '급등' || tab === '급락') {
      const cacheKey = cacheKeyFor(tab);
      const marketOpen = isKoreanMarketOpen();
      // 장 외 시간에는 최근 거래일 데이터를 조회 (장 시작 전 "전날꺼" 표시 요구사항)
      const inputDate = marketOpen ? '' : getLastTradingDate().yyyymmdd;

      // 1순위: KIS 실시간 (장 외에는 최근 거래일 지정)
      try {
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
            FID_INPUT_DATE_1: inputDate,
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
        if (rows.length > 0) {
          rows.sort((a, b) =>
            tab === '급등'
              ? Number(b.prdy_ctrt) - Number(a.prdy_ctrt)
              : Number(a.prdy_ctrt) - Number(b.prdy_ctrt),
          );
          const filtered = rows.filter(item => !EXCLUDE_PATTERN.test(item.hts_kor_isnm ?? ''));
          const result = filtered.slice(0, 50).map(mapRow);
          after(async () => {
            const { error } = await supabase.from('market_cache').upsert({ key: cacheKey, data: result, updated_at: new Date().toISOString() });
            if (error) console.warn(`[ranking] ${tab} 캐시 저장 실패:`, error.message);
          });
          return Response.json(result);
        }
        // rows.length === 0: 장 마감
        console.log(`[ranking] KIS ${tab}: 0행 (장 마감), 네이버 폴백`);
      } catch (e) {
        console.warn(`[ranking] KIS ${tab} 실패:`, e instanceof Error ? e.message : e);
      }

      // 2순위: 네이버 스크래핑
      try {
        const naverRows = await fetchNaverRanking(tab as '급등' | '급락');
        if (naverRows.length > 0) {
          after(async () => {
            const { error } = await supabase.from('market_cache').upsert({ key: cacheKey, data: naverRows, updated_at: new Date().toISOString() });
            if (error) console.warn(`[ranking] ${tab} 캐시 저장 실패:`, error.message);
          });
          return Response.json(naverRows);
        }
      } catch (e) {
        console.warn(`[ranking] Naver ${tab} 실패:`, e instanceof Error ? e.message : e);
      }

      // 3순위: Supabase 캐시 (만료 포함)
      const cached = await getCachedRanking(tab);
      if (cached) return Response.json(cached);

      return Response.json([]);
    }

    return Response.json([]);
  } catch (err) {
    console.error('[ranking]', err);
    return Response.json({ error: '조회 실패' }, { status: 500 });
  }
}
