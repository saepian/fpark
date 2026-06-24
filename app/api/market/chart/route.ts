import { getAccessToken } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

const KIS = 'https://openapi.koreainvestment.com:9443';

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

// USD/KRW 일봉 close 배열 (Yahoo Finance)
async function fetchUsdKrwChart(): Promise<number[]> {
  const res = await fetch(
    'https://query1.finance.yahoo.com/v8/finance/chart/KRW%3DX?interval=1d&range=1mo',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    },
  );
  if (!res.ok) throw new Error(`Yahoo KRW=X HTTP ${res.status}`);
  const data = await res.json();
  const closes: (number | null)[] = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  return closes.filter((v): v is number => v != null && isFinite(v));
}

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol') ?? 'KOSPI';

  try {
    let closes: number[];
    if (symbol === 'KOSPI')    closes = await fetchIndexChart('0001');
    else if (symbol === 'KOSDAQ') closes = await fetchIndexChart('1001');
    else if (symbol === 'USD_KRW') closes = await fetchUsdKrwChart();
    else return Response.json({ error: '알 수 없는 symbol' }, { status: 400 });

    return Response.json(closes);
  } catch (err) {
    console.error(`[market/chart] ${symbol}:`, err);
    return Response.json([], { status: 200 }); // 빈 배열로 graceful fallback
  }
}
