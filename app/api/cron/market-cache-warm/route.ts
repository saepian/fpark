import { NextRequest, NextResponse } from 'next/server';
import { captureLastCloseSnapshot } from '@/lib/market-ranking';

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
