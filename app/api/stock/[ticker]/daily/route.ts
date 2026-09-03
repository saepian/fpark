import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken, acquireKisRateSlot, cacheJsonResult } from '@/lib/kis-api';
import { isKoreanMarketOpen } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

function headers(token: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=UTF-8',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: 'FHKST01010400',
    custtype: 'P',
  };
}

type DailyRow = { date: string; open: number; high: number; low: number; close: number; volume: number; changeRate: number };

// 2026-09-03 트래픽점검 2번: caching 전엔 종목상세 페이지 로드마다 캐시 없이 KIS를 직접
// 호출했다(8/31엔 레이트리미터 우회만 막음). 최근 5거래일 중 오늘 캔들은 장중엔 계속
// 갱신되는 잠정치라 TTL을 짧게(1분), 장외엔 오늘 캔들도 확정이라 훨씬 길게(3시간) 둔다.
// 마감 직전에 캐싱된 잠정 오늘 캔들이 마감 후에도 TTL 안에 있다는 이유로 그대로 나가는
// 것을 막기 위해 fetchStockPriceCached와 같은 "마감 전 생성분 마감 후 첫 조회 무효화"
// 규칙(invalidateAcrossClose)도 적용한다.
const DAILY_CACHE_TTL_MS_OPEN   = 60_000;         // 장중 1분
const DAILY_CACHE_TTL_MS_CLOSED = 3 * 60 * 60_000; // 장외 3시간
const dailyCacheKey = (ticker: string) => `stock_daily5_${ticker}`;

async function fetchDailyLive(ticker: string): Promise<DailyRow[]> {
  const token = await getAccessToken();

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const mktCode of ['J', 'Q']) {
      const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price`);
      url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
      url.searchParams.set('FID_INPUT_ISCD', ticker);
      url.searchParams.set('FID_PERIOD_DIV_CODE', 'D');
      url.searchParams.set('FID_ORG_ADJ_PRC', '0');

      try {
        // 2026-08-31 트래픽 점검: investors 라우트와 같은 이유로 전역 KIS 레이트리미터
        // 게이트 추가(직접 fetch라 게이트를 우회하고 있었음).
        await acquireKisRateSlot();
        const res = await fetch(url.toString(), {
          headers: headers(token),
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) continue;

        const data = await res.json();
        if (data.rt_cd !== '0' || !Array.isArray(data.output) || data.output.length === 0) continue;

        return data.output.slice(0, 5).map((d: any) => ({
          date: d.stck_bsop_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
          open: Number(d.stck_oprc),
          high: Number(d.stck_hgpr),
          low: Number(d.stck_lwpr),
          close: Number(d.stck_clpr),
          volume: Number(d.acml_vol),
          changeRate: Number(d.prdy_ctrt),
        }));
      } catch {
        continue;
      }
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error('일별 시세 조회 실패');
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const ttlMs = isKoreanMarketOpen() ? DAILY_CACHE_TTL_MS_OPEN : DAILY_CACHE_TTL_MS_CLOSED;

  try {
    const { data } = await cacheJsonResult(
      dailyCacheKey(ticker), ttlMs, () => fetchDailyLive(ticker),
      { invalidateAcrossClose: true },
    );
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: '일별 시세 조회 실패' }, { status: 502 });
  }
}
