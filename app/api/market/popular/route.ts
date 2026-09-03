import { getAccessToken, acquireKisRateSlot, cacheJsonResult } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const CACHE_KEY = 'popular_stocks';
const CACHE_TTL_MS = 15 * 60 * 1000;

interface PopularStock {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  change: number;
}

async function fetchFromKIS(): Promise<PopularStock[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE: '20171',
    FID_INPUT_ISCD: '0001',
    FID_DIV_CLS_CODE: '0',
    FID_BLNG_CLS_CODE: '3',
    FID_TRGT_CLS_CODE: '111111111',
    FID_TRGT_EXLS_CLS_CODE: '000000',
    FID_INPUT_PRICE_1: '0',
    FID_INPUT_PRICE_2: '9999999',
    FID_VOL_CNT: '0',
    FID_INPUT_DATE_1: '',
  });

  // 2026-09-03 트래픽점검 9번: 레이트리미터 게이트가 없어 우회 중이었던 걸 추가 — 유저
  // 요청 경로(국내증시 페이지)라 'user' 우선순위.
  await acquireKisRateSlot({ priority: 'user' });
  const res = await fetch(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/volume-rank?${params}`,
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: 'FHPST01710000',
        custtype: 'P',
      },
      cache: 'no-store',
    },
  );

  const data = await res.json();
  const rows: any[] = data.output ?? [];
  rows.sort((a, b) => Number(b.acml_tr_pbmn) - Number(a.acml_tr_pbmn));

  const result = rows.slice(0, 5).map((item, i) => ({
    rank: i + 1,
    ticker: item.stck_shrn_iscd || item.mksc_shrn_iscd || '',
    name: item.hts_kor_isnm,
    price: Number(item.stck_prpr),
    changeRate: Number(item.prdy_ctrt),
    change: Number(item.prdy_vrss),
  }));
  if (result.length === 0) throw new Error('volume-rank 결과 0건');
  return result;
}

// 2026-09-03 트래픽점검 9번: 기존 TTL 캐시(15분 고정, 장중/장외 구분 없음)는 그대로 두고
// investors/finance/daily(2번)·movers(8번)와 동일한 cacheJsonResult로 전환 —
// single-flight 락과 "라이브 실패 시 stale 캐시 폴백"이 자동으로 딸려 온다.
export async function GET() {
  try {
    const { data } = await cacheJsonResult(CACHE_KEY, CACHE_TTL_MS, fetchFromKIS);
    return Response.json(data);
  } catch (e) {
    console.error('[popular]', e instanceof Error ? e.message : e);
    return Response.json([]);
  }
}
