import { NextRequest, NextResponse } from 'next/server';
import { captureLastCloseSnapshot } from '@/lib/market-ranking';
import { fetchDailyChart } from '@/lib/kis-api';
import { getDomesticMarketDayContext } from '@/lib/market-day-context';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 장 마감 직후 실행 — 당일 급등/급락 TOP 데이터를 캐시에 저장해서
// 다음날 장 시작 전(전날 데이터 폴백 단계)에 항상 최근 거래일 데이터를 보여줄 수 있게 함.
//
// 2026-07-24: 급등/급락은 /api/market/ranking을 자기 자신에 HTTP로 재호출하던 방식(다른
// 두 target과 동일 패턴)에서, captureLastCloseSnapshot()을 직접 import해 호출하는
// 방식으로 교체했다 — 그 라우트의 "장 마감 후엔 KIS에 과거 날짜로 재조회" 경로가 KIS가
// FID_INPUT_DATE_1을 지원하지 않아(2026-07-24 실측) 이 크론 시각(15:35, 이미 장마감
// 판정)에도 항상 실패하고 있었다. captureLastCloseSnapshot()은 장 상태와 무관하게 항상
// 라이브 파라미터로 조회해 결과를 ranking_{tab}_lastclose 캐시에 저장한다.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/market-cache-warm] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/market-cache-warm] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 0. 거래일 상태 — vercel.json 스케줄(평일 1-5만 실행)로 주말은 이미 제외되므로, 여기서는
  // "평일인데 공휴일이라 국내장이 안 열린 날"만 걸러낸다. 휴장일에 이 크론을 그대로 돌리면
  // captureLastCloseSnapshot()이 "라이브 파라미터로 항상 조회"하는 특성상(위 주석 참고)
  // 데이터 없는 응답이나 공백 스냅샷으로 ranking_{tab}_lastclose 캐시를 덮어써, 정작
  // 장전(다음 거래일 전) 폴백으로 보여줘야 할 "진짜 마지막 거래일 마감 데이터"가 사라질
  // 위험이 있다 — 휴장일엔 아예 건드리지 않고 기존 캐시를 그대로 유지한다. 판정용 차트는
  // daily-alert-email과 동일하게 앵커 종목(삼성전자) 1주치를 가볍게 조회(실행 시각 15:35도
  // 마감 이후라 홀리데이 판정이 신뢰 가능한 구간). 조회 실패 시엔 안전하게 거래일로 간주해
  // 정상 갱신을 진행한다(캐시 미갱신보다 과다 갱신이 덜 해로움).
  const anchorChart = await fetchDailyChart('005930', '1W', { priority: 'cron' }).catch(() => []);
  const marketDayContext = getDomesticMarketDayContext(anchorChart);
  if (!marketDayContext.isTradingDay) {
    console.log(
      `[cron/market-cache-warm] 오늘은 휴장일(${marketDayContext.reason})이라 캐시 갱신 생략, 기존 lastclose 유지 ` +
      `— 마지막 거래일 ${marketDayContext.lastTradingDate}`,
    );
    return NextResponse.json({ done: true, skipped: true, reason: marketDayContext.reason });
  }

  const origin = new URL(request.url).origin;

  const [moversResult, gainersSnapshot, losersSnapshot] = await Promise.allSettled([
    fetch(`${origin}/api/market/movers`, { cache: 'no-store' }).then((res) => ({ path: '/api/market/movers', status: res.status })),
    captureLastCloseSnapshot('급등'),
    captureLastCloseSnapshot('급락'),
  ]);

  if (moversResult.status === 'fulfilled') {
    console.log(`[cron/market-cache-warm] /api/market/movers -> ${moversResult.value.status}`);
  } else {
    console.error('[cron/market-cache-warm] /api/market/movers 실패:', moversResult.reason);
  }

  ([['급등', gainersSnapshot], ['급락', losersSnapshot]] as const).forEach(([tab, r]) => {
    if (r.status === 'fulfilled') {
      console.log(`[cron/market-cache-warm] ${tab} 마감 스냅샷 -> ok:${r.value.ok} rows:${r.value.rowCount}`);
    } else {
      console.error(`[cron/market-cache-warm] ${tab} 마감 스냅샷 실패:`, r.reason);
    }
  });

  return NextResponse.json({ done: true });
}
