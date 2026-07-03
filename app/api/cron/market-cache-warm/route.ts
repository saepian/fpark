import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 장 마감 직후 실행 — 당일 급등/급락 TOP 데이터를 캐시에 저장해서
// 다음날 장 시작 전(전날 데이터 폴백 단계)에 항상 최근 거래일 데이터를 보여줄 수 있게 함.
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
  const targets = [
    '/api/market/movers',
    '/api/market/ranking?tab=급등',
    '/api/market/ranking?tab=급락',
  ];

  const results = await Promise.allSettled(
    targets.map((path) => fetch(`${origin}${path}`, { cache: 'no-store' }).then((res) => ({ path, status: res.status })))
  );

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`[cron/market-cache-warm] ${targets[i]} -> ${r.value.status}`);
    } else {
      console.error(`[cron/market-cache-warm] ${targets[i]} 실패:`, r.reason);
    }
  });

  return NextResponse.json({ done: true });
}
