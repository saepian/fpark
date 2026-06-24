import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';
import type { AlertResponse, AlertStock } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const CACHE_KEY = 'alerts_52w';

function isMarketOpen(): boolean {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}

// sortCode '1' = 52주 신고가, '2' = 52주 신저가
async function fetchHighLow(sortCode: '1' | '2'): Promise<AlertStock[]> {
  const token = await getAccessToken();

  const params = new URLSearchParams({
    FID_COND_MRK_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE: '140',
    FID_INPUT_ISCD: '0001',
    FID_RANK_SORT_CLS_CODE: sortCode,
    FID_INPUT_CNT_1: '20',
    FID_PRC_CLS_CODE: '1',
    FID_INPUT_PRICE_1: '0',
    FID_INPUT_PRICE_2: '9999999',
    FID_VOL_CNT: '0',
    FID_INPUT_DATE_1: '',
  });

  const res = await fetch(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/high-price?${params}`,
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: 'FHPST01400000',
        custtype: 'P',
      },
      cache: 'no-store',
    }
  );

  const data = await res.json();
  console.log(
    `[ALERTS] sortCode:${sortCode} rt_cd:${data.rt_cd} msg1:${data.msg1} count:${data.output?.length ?? 0}`,
    'first:', JSON.stringify(data.output?.[0]).slice(0, 200)
  );

  if (!res.ok || data.rt_cd !== '0') {
    throw new Error(`high-price API [${res.status}] ${data.msg1 ?? ''}`);
  }

  return (data.output ?? []).slice(0, 10).map((item: any) => ({
    ticker: item.stck_shrn_iscd,
    name: item.hts_kor_isnm,
    price: Number(item.stck_prpr),
    ...(sortCode === '1'
      ? { high52w: Number(item.stck_dmax) }
      : { low52w: Number(item.stck_dmin) }),
  }));
}

async function loadCache(): Promise<AlertResponse | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .single();
    if (!cache?.data) return null;
    return { ...(cache.data as AlertResponse), isCached: true, cachedAt: cache.updated_at } as AlertResponse;
  } catch {
    return null;
  }
}

export async function GET() {
  // 항상 실시간 조회 시도 — 장중/장후 무관하게 당일 52주 고저가 순위 반환
  try {
    const [highAlerts, lowAlerts] = await Promise.all([
      fetchHighLow('1'),
      fetchHighLow('2'),
    ]);

    const validHigh = highAlerts.filter((s) => s.price > 0 && s.name);
    const validLow  = lowAlerts.filter((s) => s.price > 0 && s.name);

    if (validHigh.length > 0 || validLow.length > 0) {
      const result: AlertResponse = {
        highAlerts: validHigh,
        lowAlerts: validLow,
        total: validHigh.length + validLow.length,
      };

      void supabase.from('market_cache').upsert({
        key: CACHE_KEY,
        data: { highAlerts: validHigh, lowAlerts: validLow, total: result.total },
        updated_at: new Date().toISOString(),
      });

      return NextResponse.json({ ...result, isCached: false, cachedAt: null });
    }
    console.log('[ALERTS] KIS API returned empty, falling back');
  } catch (e) {
    console.error('[ALERTS] KIS API 실패:', e instanceof Error ? e.message : e);
  }

  // KIS 실패 또는 빈 결과 → 캐시 반환
  const cached = await loadCache();
  if (cached) return NextResponse.json(cached);

  // 캐시도 없으면 기존 curated 방식으로 fallback
  try {
    const { fetchCurated52wAlerts } = await import('@/lib/kis-api');
    const { highAlerts, lowAlerts } = await fetchCurated52wAlerts();
    const total = highAlerts.length + lowAlerts.length;
    return NextResponse.json({ highAlerts, lowAlerts, total });
  } catch {
    return NextResponse.json({ highAlerts: [], lowAlerts: [], total: 0 });
  }
}
