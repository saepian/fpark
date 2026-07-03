import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getAccessToken, fetchWatch52w, assertKisTokenValid, withKisTokenRetry } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';
import type { AlertResponse, AlertStock } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const CACHE_KEY = 'alerts_52w';

// sortCode '1' = 52주 신고가, '2' = 52주 신저가
async function fetchHighLow(sortCode: '1' | '2'): Promise<AlertStock[]> {
  return withKisTokenRetry(async () => {
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

    if (!res.ok) throw new Error(`high-price API HTTP [${res.status}]`);

    let data: Record<string, unknown>;
    try {
      data = await res.json();
    } catch {
      throw new Error(`high-price API 응답 파싱 실패 [${res.status}] — 빈 응답`);
    }

    console.log(
      `[ALERTS] sortCode:${sortCode} rt_cd:${data.rt_cd} msg1:${data.msg1} count:${(data.output as unknown[])?.length ?? 0}`,
    );

    assertKisTokenValid(data, 'FHPST01400000');
    if (data.rt_cd !== '0') {
      throw new Error(`high-price API [${res.status}] ${data.msg1 ?? ''}`);
    }

    return ((data.output as any[]) ?? []).slice(0, 10).map((item: any) => ({
      ticker: item.stck_shrn_iscd,
      name: item.hts_kor_isnm,
      price: Number(item.stck_prpr),
      ...(sortCode === '1'
        ? { high52w: Number(item.stck_dmax) }
        : { low52w: Number(item.stck_dmin) }),
    }));
  });
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

// 로그인한 사용자의 국내 관심종목 ticker 목록 조회
async function getWatchlistTickers(): Promise<string[]> {
  try {
    const cookieStore = cookies();
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => (cookieStore as any).then
            ? (cookieStore as any).then((s: any) => s.getAll())
            : (cookieStore as any).getAll(),
          setAll: () => {},
        },
      },
    );
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return [];

    const { data } = await authClient
      .from('watchlist')
      .select('ticker')
      .eq('user_id', user.id)
      .or('market.eq.kr,market.is.null');

    const tickers = (data ?? []).map((w: { ticker: string }) => w.ticker);
    if (tickers.length > 0) {
      console.log(`[ALERTS] 관심종목 ${tickers.length}개: ${tickers.join(', ')}`);
    }
    return tickers;
  } catch (e) {
    console.warn('[ALERTS] 관심종목 조회 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

export async function GET() {
  // 시장 랭킹 조회와 관심종목 ticker 조회를 병렬로 시작
  // watchlist fetch는 tickers 확보 직후 연쇄 실행
  const rankingPromise = Promise.all([fetchHighLow('1'), fetchHighLow('2')]);
  const watchPromise = getWatchlistTickers().then((tickers) =>
    tickers.length > 0
      ? fetchWatch52w(tickers)
      : Promise.resolve({ highAlerts: [] as AlertStock[], lowAlerts: [] as AlertStock[] }),
  );

  // 1. 시장 랭킹 처리
  let baseHigh: AlertStock[] = [];
  let baseLow: AlertStock[] = [];
  let rankingOk = false;

  try {
    const [highAlerts, lowAlerts] = await rankingPromise;
    const validHigh = highAlerts.filter((s) => s.price > 0 && s.name);
    const validLow  = lowAlerts.filter((s) => s.price > 0 && s.name);

    console.log(`[ALERTS] 신고가 목록: ${validHigh.map(s => `${s.ticker}(${s.name})`).join(', ') || '없음'}`);
    console.log(`[ALERTS] 신저가 목록: ${validLow.map(s => `${s.ticker}(${s.name})`).join(', ') || '없음'}`);
    console.log(`[ALERTS] 036420 신고가 포함: ${validHigh.some(s => s.ticker === '036420')}, 신저가 포함: ${validLow.some(s => s.ticker === '036420')}`);

    if (validHigh.length > 0 || validLow.length > 0) {
      baseHigh = validHigh;
      baseLow  = validLow;
      rankingOk = true;

      void supabase.from('market_cache').upsert({
        key: CACHE_KEY,
        data: { highAlerts: validHigh, lowAlerts: validLow, total: validHigh.length + validLow.length },
        updated_at: new Date().toISOString(),
      });
    } else {
      console.log('[ALERTS] KIS 랭킹 API 빈 결과, 캐시 fallback');
    }
  } catch (e) {
    console.error('[ALERTS] KIS 랭킹 API 실패:', e instanceof Error ? e.message : e);
  }

  // 랭킹 실패 또는 빈 결과 → 캐시 fallback
  if (!rankingOk) {
    const cached = await loadCache();
    if (cached) {
      baseHigh = cached.highAlerts ?? [];
      baseLow  = cached.lowAlerts ?? [];
    } else {
      // 캐시도 없으면 curated 방식 fallback
      try {
        const { fetchCurated52wAlerts } = await import('@/lib/kis-api');
        const fallback = await fetchCurated52wAlerts();
        baseHigh = fallback.highAlerts;
        baseLow  = fallback.lowAlerts;
      } catch {}
    }
  }

  // 2. 관심종목 52주 체크 결과 합치기 (중복 ticker 제외)
  let watchHigh: AlertStock[] = [];
  let watchLow:  AlertStock[] = [];
  try {
    const watchResult = await watchPromise;
    watchHigh = watchResult.highAlerts;
    watchLow  = watchResult.lowAlerts;
  } catch (e) {
    console.warn('[ALERTS] 관심종목 52w 조회 실패:', e instanceof Error ? e.message : e);
  }

  const baseHighSet = new Set(baseHigh.map((s) => s.ticker));
  const baseLowSet  = new Set(baseLow.map((s) => s.ticker));

  const mergedHigh = [...baseHigh, ...watchHigh.filter((s) => !baseHighSet.has(s.ticker))];
  const mergedLow  = [...baseLow,  ...watchLow.filter((s)  => !baseLowSet.has(s.ticker))];

  const result: AlertResponse = {
    highAlerts: mergedHigh,
    lowAlerts:  mergedLow,
    total:      mergedHigh.length + mergedLow.length,
    isCached:   !rankingOk,
    cachedAt:   null,
  };

  return NextResponse.json(result);
}
