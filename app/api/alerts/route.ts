import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getAccessToken, acquireKisRateSlot, fetchWatch52w, assertKisTokenValid, withKisTokenRetry, cacheJsonResult } from '@/lib/kis-api';
import { isKoreanMarketOpen } from '@/lib/market-utils';
import type { AlertResponse, AlertStock } from '@/lib/types';
import type { Database } from '@/lib/database.types';

export const dynamic = 'force-dynamic';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const CACHE_KEY = 'alerts_52w';

// 2026-09-03 트래픽점검 9번: 헤더의 알림 버튼(components/layout/AlertButton.tsx)이
// 로그인 여부와 무관하게 전체 페이지에서 60초마다 폴링하는데, 이 시장 전체 랭킹
// (52주 신고/신저 근접)에는 TTL 캐싱이 전혀 없어(라이브 실패 시에만 캐시로 폴백하는
// 구조) 매 폴링·매 방문자마다 KIS 2건을 라이브로 호출했다 — movers(8번)와 같은 문제
// 형태. 폴링 주기(60초)에 맞춰 장중 TTL을 잡는다. 유저별 관심종목 52주 체크
// (fetchWatch52w)는 개인화된 데이터라 캐싱 대상에서 제외 — 이 라우트에서 캐싱하는 건
// "시장 전체" 랭킹 부분뿐이다.
const RANKING_CACHE_TTL_MS_OPEN   = 60_000;      // 장중 1분(폴링 주기보다 짧게 잡아 과도한 지연 없이)
const RANKING_CACHE_TTL_MS_CLOSED = 30 * 60_000; // 장외 30분

// sortCode '1' = 52주 신고가(근접), '2' = 52주 신저가(근접)
// KIS의 국내주식 신고_신저근접종목 상위 API[v1_국내주식-105] (tr_id FHPST01870000)
// 예전에 쓰던 /ranking/high-price + FHPST01400000 조합은 KIS에 존재하지 않는 엔드포인트라 상시 404였음.
async function fetchHighLow(sortCode: '1' | '2'): Promise<AlertStock[]> {
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();

    const params = new URLSearchParams({
      FID_APLY_RANG_VOL: '0',
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_COND_SCR_DIV_CODE: '20187',
      FID_DIV_CLS_CODE: '0',
      FID_INPUT_CNT_1: '0', // 괴리율 최소
      FID_INPUT_CNT_2: '0', // 괴리율 최대 — 0~0으로 "정확히 52주 신고/신저에 도달한" 종목만 조회
      FID_PRC_CLS_CODE: sortCode === '1' ? '0' : '1', // 0:신고근접, 1:신저근접
      FID_INPUT_ISCD: '0000', // 전체 시장(코스피+코스닥)
      FID_TRGT_CLS_CODE: '0',
      FID_TRGT_EXLS_CLS_CODE: '0',
      FID_APLY_RANG_PRC_1: '0',
      FID_APLY_RANG_PRC_2: '100000000',
    });

    // 2026-09-03 트래픽점검 9번: 레이트리미터 게이트가 없어 우회 중이었던 걸 추가 — 헤더
    // 알림 버튼(비로그인 포함 전 방문자 60초 폴링), 크론 아님 → 'user' 우선순위.
    await acquireKisRateSlot({ priority: 'user' });
    const res = await fetch(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/near-new-highlow?${params}`,
      {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          appkey: process.env.KIS_APP_KEY!,
          appsecret: process.env.KIS_APP_SECRET!,
          tr_id: 'FHPST01870000',
          custtype: 'P',
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) throw new Error(`near-new-highlow API HTTP [${res.status}]`);

    let data: Record<string, unknown>;
    try {
      data = await res.json();
    } catch {
      throw new Error(`near-new-highlow API 응답 파싱 실패 [${res.status}] — 빈 응답`);
    }

    console.log(
      `[ALERTS] sortCode:${sortCode} rt_cd:${data.rt_cd} msg1:${data.msg1} count:${(data.output as unknown[])?.length ?? 0}`,
    );

    assertKisTokenValid(data, 'FHPST01870000');
    if (data.rt_cd !== '0') {
      throw new Error(`near-new-highlow API [${res.status}] ${data.msg1 ?? ''}`);
    }

    return ((data.output as any[]) ?? []).slice(0, 10).map((item: any) => ({
      ticker: item.mksc_shrn_iscd,
      name: item.hts_kor_isnm,
      price: Number(item.stck_prpr),
      ...(sortCode === '1'
        ? { high52w: Number(item.new_hgpr) }
        : { low52w: Number(item.new_lwpr) }),
    }));
  });
}

// cacheJsonResult의 fetchLive 콜백 — 시장 전체 신고가/신저가 랭킹만 담당(개인화된
// 관심종목 체크는 GET에서 별도로 병렬 처리).
async function fetchHighLowRanking(): Promise<{ highAlerts: AlertStock[]; lowAlerts: AlertStock[] }> {
  const [highAlerts, lowAlerts] = await Promise.all([fetchHighLow('1'), fetchHighLow('2')]);
  const validHigh = highAlerts.filter((s) => s.price > 0 && s.name);
  const validLow  = lowAlerts.filter((s) => s.price > 0 && s.name);

  console.log(`[ALERTS] 신고가 목록: ${validHigh.map(s => `${s.ticker}(${s.name})`).join(', ') || '없음'}`);
  console.log(`[ALERTS] 신저가 목록: ${validLow.map(s => `${s.ticker}(${s.name})`).join(', ') || '없음'}`);

  if (validHigh.length === 0 && validLow.length === 0) {
    throw new Error('신고가/신저가 랭킹 결과 0건');
  }
  return { highAlerts: validHigh, lowAlerts: validLow };
}

// 로그인한 사용자의 국내 관심종목 ticker 목록 조회
async function getWatchlistTickers(): Promise<string[]> {
  try {
    const cookieStore = cookies();
    const authClient = createServerClient<Database>(
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
  // 시장 랭킹 조회(캐시 우선)와 관심종목 ticker 조회를 병렬로 시작
  // watchlist fetch는 tickers 확보 직후 연쇄 실행
  const ttlMs = isKoreanMarketOpen() ? RANKING_CACHE_TTL_MS_OPEN : RANKING_CACHE_TTL_MS_CLOSED;
  const rankingPromise = cacheJsonResult(CACHE_KEY, ttlMs, fetchHighLowRanking);
  const watchPromise = getWatchlistTickers().then((tickers) =>
    tickers.length > 0
      ? fetchWatch52w(tickers, { priority: 'batch' }) // 2026-09-03 트래픽점검 11번: 관심종목 수만큼 서버 내부 fan-out → 'batch'
      : Promise.resolve({ highAlerts: [] as AlertStock[], lowAlerts: [] as AlertStock[] }),
  );

  // 1. 시장 랭킹 처리
  let baseHigh: AlertStock[] = [];
  let baseLow: AlertStock[] = [];
  let rankingOk = false;

  try {
    const { data } = await rankingPromise;
    baseHigh = data.highAlerts;
    baseLow  = data.lowAlerts;
    rankingOk = true;
  } catch (e) {
    // cacheJsonResult 자체가 이미 "라이브 실패 시 stale 캐시 폴백"을 시도한 뒤이므로,
    // 여기 도달했다는 건 캐시조차 없었다는 뜻 — curated 방식으로 최후 폴백.
    console.error('[ALERTS] 랭킹 조회 실패(캐시도 없음):', e instanceof Error ? e.message : e);
    try {
      const { fetchCurated52wAlerts } = await import('@/lib/kis-api');
      const fallback = await fetchCurated52wAlerts({ priority: 'batch' }); // 20종목 fan-out 최후 폴백 → 'batch'
      baseHigh = fallback.highAlerts;
      baseLow  = fallback.lowAlerts;
    } catch {}
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
