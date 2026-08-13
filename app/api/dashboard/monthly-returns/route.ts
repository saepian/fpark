import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getCachedChartNear } from '@/lib/chart-near-cache';
import { computePortfolioMonthlySeries, computePortfolioDailySeries } from '@/lib/market-utils';
import type { Database } from '@/lib/database.types';

export const dynamic = 'force-dynamic';

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.then(s => s.getAll()),
        setAll: (pairs) => cookieStore.then(s => {
          pairs.forEach(({ name, value, options }) => s.set(name, value, options));
        }),
      },
    },
  );
}

// 3개씩 청크 처리 — KIS API rate limit 회피 (dashboard/holdings, dashboard/risk route와 동일 패턴)
async function fetchInChunks<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  chunkSize = 3,
  gapMs = 250,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(chunk.map(fn));
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
    if (i + chunkSize < items.length) {
      await new Promise(r => setTimeout(r, gapMs));
    }
  }
  return results;
}

// getCachedChartNear(monthsAgo=6)가 "오늘부터 6개월 전까지" 끊김없는 연쇄 데이터를 한 번에
// 주므로(lib/chart-near-cache.ts) chart?period=1Y와 별도로 병합할 필요가 없다. 이 캐시는
// market_cache 테이블에 종목 단위로 24시간 저장되므로(전 유저·전 기능 공유), 같은 종목을
// 포트폴리오진단/종목분석에서 이미 조회했었다면 여기서도 캐시 히트한다.
export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 숨긴 종목은 월별/일별 수익률 추이 계산(투자원금 합계 포함)에서도 제외한다.
  const { data, error } = await supabase
    .from('dashboard_holdings')
    .select('ticker, quantity, avg_price')
    .eq('user_id', user.id)
    .eq('hidden', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const holdingsInput = data ?? [];
  if (holdingsInput.length === 0) return NextResponse.json({ monthly: [], daily: [] });

  const totalInvested = holdingsInput.reduce((s, h) => s + h.avg_price * h.quantity, 0);

  const withPoints = await fetchInChunks(holdingsInput, async (h) => {
    const points = await getCachedChartNear(h.ticker, 6).catch(() => []);
    return { ticker: h.ticker, quantity: h.quantity, points: points.length ? points : null };
  });

  // 일별 보기(최근 30거래일)도 같은 6개월치 points에서 잘라 쓴다 — 별도 조회 없음.
  const monthly = computePortfolioMonthlySeries(withPoints, totalInvested, 6);
  const daily = computePortfolioDailySeries(withPoints, totalInvested, 30);
  return NextResponse.json({ monthly, daily });
}
