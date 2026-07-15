import { after } from 'next/server';
import { getAccessToken } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';

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
    FID_BLNG_CLS_CODE: '0',
    FID_TRGT_CLS_CODE: '111111111',
    FID_TRGT_EXLS_CLS_CODE: '000000',
    FID_INPUT_PRICE_1: '0',
    FID_INPUT_PRICE_2: '9999999',
    FID_VOL_CNT: '0',
    FID_INPUT_DATE_1: '',
  });

  const res = await fetch(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation?${params}`,
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

  return rows.slice(0, 5).map((item, i) => ({
    rank: i + 1,
    ticker: item.stck_shrn_iscd || item.mksc_shrn_iscd || '',
    name: item.hts_kor_isnm,
    price: Number(item.stck_prpr),
    changeRate: Number(item.prdy_ctrt),
    change: Number(item.prdy_vrss),
  }));
}

export async function GET() {
  // 캐시 우선
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .single();

    if (cache?.data) {
      const age = Date.now() - new Date(cache.updated_at).getTime();
      if (age < CACHE_TTL_MS) {
        return Response.json(cache.data);
      }
    }
  } catch {}

  // KIS 실시간 조회
  try {
    const stocks = await fetchFromKIS();
    if (stocks.length > 0) {
      // after()로 등록 — void로 던지면 응답 직후 실행 컨텍스트가 끊겨 저장이 누락될 수
      // 있음(2026-07-15 실측 확인: 이 캐시가 "이미 동작 중"으로 알려져 있었지만 실제로는
      // 한 번도 저장된 적이 없었음 — market_cache에 popular_stocks 키 자체가 없었다).
      after(async () => {
        const { error } = await supabase.from('market_cache').upsert({
          key: CACHE_KEY,
          data: stocks,
          updated_at: new Date().toISOString(),
        });
        if (error) console.warn('[popular] 캐시 저장 실패:', error.message);
      });
      return Response.json(stocks);
    }
  } catch (e) {
    console.error('[popular]', e instanceof Error ? e.message : e);
  }

  return Response.json([]);
}
