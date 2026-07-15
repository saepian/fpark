import { after } from 'next/server';
import { getAccessToken } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';
import { isKoreanMarketOpen } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';

const KIS = 'https://openapi.koreainvestment.com:9443';

// 2026-07-15: 국내증시 페이지 5분 자동 새로고침 도입 후 이 라우트에 TTL 캐시가
// 전혀 없다는 게 확인돼 popular 라우트와 동일한 패턴 추가. 일봉/시간봉 데이터라
// 지수보다 갱신 주기를 길게 잡아도 체감 차이가 거의 없다.
const CACHE_TTL_MS_OPEN   = 120_000;     // 장중 2분
const CACHE_TTL_MS_CLOSED = 30 * 60_000; // 장외 30분
const cacheKey = (symbol: string) => `chart_${symbol}`;

function kisHeaders(token: string, trId: string) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
  };
}

function dateStr(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// KOSPI(0001) 또는 KOSDAQ(1001) 일봉 close 배열
async function fetchIndexChart(indexCode: string): Promise<number[]> {
  const token = await getAccessToken();
  const end   = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - 1);

  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'U',
    FID_INPUT_ISCD: indexCode,
    FID_INPUT_DATE_1: dateStr(start),
    FID_INPUT_DATE_2: dateStr(end),
    FID_PERIOD_DIV_CODE: 'D',
  });

  const res = await fetch(
    `${KIS}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice?${params}`,
    { headers: kisHeaders(token, 'FHKUP03500100'), cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`index chart HTTP ${res.status}`);
  const data = await res.json();
  if (data.rt_cd !== '0') throw new Error(data.msg1);

  const rows: any[] = data.output2 ?? [];
  // KIS는 최신순 → 역순 정렬해 시간 오름차순으로
  return rows
    .reverse()
    .map((r: any) => parseFloat(r.bstp_nmix_prpr))
    .filter((v: number) => v > 0);
}

// 지수: 일봉 1개월
async function fetchYahooChart(yahooSymbol: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1mo`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Yahoo ${yahooSymbol} HTTP ${res.status}`);
  const data = await res.json();
  const closes: (number | null)[] = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  return closes.filter((v): v is number => v != null && isFinite(v));
}

// 환율: 1시간봉 5일 (장 열림/닫힘 무관)
async function fetchYahooFXChart(yahooSymbol: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1h&range=5d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Yahoo FX ${yahooSymbol} HTTP ${res.status}`);
  const data = await res.json();
  const closes: (number | null)[] = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  return closes.filter((v): v is number => v != null && isFinite(v));
}

const YAHOO_SYMBOL_MAP: Record<string, string> = {
  SP500:    '^GSPC',
  NASDAQ:   '^IXIC',
  DOW:      '^DJI',
  NIKKEI:   '^N225',
  HANGSENG: '^HSI',
  SHANGHAI: '000001.SS',
  SHENZHEN: '399001.SZ',
  BOND_3Y:  'KR3YT=RR', // Reuters RIC format
};

const YAHOO_FX_MAP: Record<string, string> = {
  USD_KRW: 'KRW=X',
  USDJPY:  'JPY=X',
  EURJPY:  'EURJPY=X',
  USDHKD:  'HKD=X',
  CNYHKD:  'CNYHKD=X',
  USDCNY:  'CNY=X',
};

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol') ?? 'KOSPI';
  const key    = cacheKey(symbol);
  const ttlMs  = isKoreanMarketOpen() ? CACHE_TTL_MS_OPEN : CACHE_TTL_MS_CLOSED;

  // TTL 이내면 라이브 호출 없이 캐시 재사용
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', key)
      .single();
    if (cache) {
      const age = Date.now() - new Date(cache.updated_at).getTime();
      if (age < ttlMs) {
        console.log(`[market/chart] ${symbol} TTL 캐시 히트 (${Math.round(age / 1000)}s < ${ttlMs / 1000}s)`);
        return Response.json(cache.data as number[]);
      }
    }
  } catch (e) {
    console.warn(`[market/chart] ${symbol} TTL 캐시 조회 실패, 라이브로 진행:`, e instanceof Error ? e.message : e);
  }

  try {
    let closes: number[];
    if (symbol === 'KOSPI')            closes = await fetchIndexChart('0001');
    else if (symbol === 'KOSDAQ')      closes = await fetchIndexChart('1001');
    else if (YAHOO_FX_MAP[symbol])     closes = await fetchYahooFXChart(YAHOO_FX_MAP[symbol]);
    else if (YAHOO_SYMBOL_MAP[symbol]) closes = await fetchYahooChart(YAHOO_SYMBOL_MAP[symbol]);
    else return Response.json({ error: '알 수 없는 symbol' }, { status: 400 });

    // after()로 등록 — void로 던지면 응답 직후 실행 컨텍스트가 끊겨 저장이 누락될 수 있음
    // (2026-07-15 실측으로 확인, stock/[ticker]/price 라우트와 동일한 이유).
    after(async () => {
      const { error } = await supabase.from('market_cache').upsert({ key, data: closes, updated_at: new Date().toISOString() });
      if (error) console.warn(`[market/chart] ${symbol} 캐시 저장 실패:`, error.message);
    });
    return Response.json(closes);
  } catch (err) {
    console.error(`[market/chart] ${symbol}:`, err);

    // 라이브 호출 실패 시 만료된 캐시라도 빈 배열보다 낫다
    try {
      const { data: stale } = await supabase.from('market_cache').select('data').eq('key', key).single();
      if (stale?.data) return Response.json(stale.data);
    } catch {}

    return Response.json([], { status: 200 }); // 빈 배열로 graceful fallback
  }
}
