import { getAccessToken, acquireKisRateSlot, cacheJsonResult } from '@/lib/kis-api';
import { isKoreanMarketOpen } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';

const KIS = 'https://openapi.koreainvestment.com:9443';

// 2026-07-15: 국내증시 페이지 5분 자동 새로고침 도입 후 이 라우트에 TTL 캐시가
// 전혀 없다는 게 확인돼 popular 라우트와 동일한 패턴 추가. 일봉/시간봉 데이터라
// 지수보다 갱신 주기를 길게 잡아도 체감 차이가 거의 없다.
//
// 2026-09-03 트래픽점검 9번: 레이트리미터 게이트(acquireKisRateSlot)가 이 라우트에
// 없어 여전히 우회 중이었던 걸 추가하면서, investors/finance/daily(2번)·movers(8번)와
// 동일하게 cacheJsonResult로 전환 — 기존 TTL 캐시는 있었지만 single-flight 락이 없어
// TTL 만료 순간 여러 요청이 동시에 라이브를 때리는 건 여전히 가능했다.
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

  // 국내증시 페이지 방문자가 부르는 유저 요청 경로 — 'user' 우선순위.
  await acquireKisRateSlot({ priority: 'user' });
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

// 2026-09-01: 해외증시 지원 범위를 미국으로 한정 — 일본/홍콩/중국 지수·환율 제거.
const YAHOO_SYMBOL_MAP: Record<string, string> = {
  SP500:    '^GSPC',
  NASDAQ:   '^IXIC',
  DOW:      '^DJI',
  BOND_3Y:  'KR3YT=RR', // Reuters RIC format
};

const YAHOO_FX_MAP: Record<string, string> = {
  USD_KRW: 'KRW=X',
};

function isValidSymbol(symbol: string): boolean {
  return symbol === 'KOSPI' || symbol === 'KOSDAQ' || !!YAHOO_FX_MAP[symbol] || !!YAHOO_SYMBOL_MAP[symbol];
}

async function fetchChartLive(symbol: string): Promise<number[]> {
  if (symbol === 'KOSPI')            return fetchIndexChart('0001');
  if (symbol === 'KOSDAQ')           return fetchIndexChart('1001');
  if (YAHOO_FX_MAP[symbol])          return fetchYahooFXChart(YAHOO_FX_MAP[symbol]);
  return fetchYahooChart(YAHOO_SYMBOL_MAP[symbol]);
}

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol') ?? 'KOSPI';
  if (!isValidSymbol(symbol)) {
    return Response.json({ error: '알 수 없는 symbol' }, { status: 400 });
  }
  const ttlMs = isKoreanMarketOpen() ? CACHE_TTL_MS_OPEN : CACHE_TTL_MS_CLOSED;

  try {
    const { data } = await cacheJsonResult(cacheKey(symbol), ttlMs, () => fetchChartLive(symbol));
    return Response.json(data);
  } catch (err) {
    console.error(`[market/chart] ${symbol}:`, err instanceof Error ? err.message : err);
    return Response.json([], { status: 200 }); // 캐시도 없고 라이브도 실패 — 빈 배열로 graceful fallback
  }
}
