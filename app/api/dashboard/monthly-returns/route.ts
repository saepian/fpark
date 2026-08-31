import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getCachedChartNear, isChartCacheFreshFromToday } from '@/lib/chart-near-cache';
import { computePortfolioMonthlySeries, computePortfolioDailySeries } from '@/lib/market-utils';
import { getDomesticMarketDayContext } from '@/lib/market-day-context';
import { kstDateStr } from '@/lib/ai-grounding';
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

  // "오늘의 등락" 위젯(대시보드 페이지)이 비거래일(주말·공휴일)에 마지막 거래일 데이터를
  // "오늘"인 것처럼 라벨링하던 문제 — 여기서 이미 조회한 차트 데이터(withPoints)를 그대로
  // 재사용해 거래일 여부를 판정한다(app/api/dashboard/analysis/route.ts와 동일한
  // firstAvailableChart 패턴, 새 KIS 호출 없음).
  const firstAvailable = withPoints.find(w => (w.points?.length ?? 0) > 0) ?? null;
  let marketDay = getDomesticMarketDayContext(firstAvailable?.points ?? []);

  // 2026-08-31 QA에서 실측된 버그: getCachedChartNear는 24시간 롤링 캐시라, 토요일에
  // 워밍된 캐시가 월요일 오후까지 "신선함" 취급되며 그 안엔 금요일 마감 데이터만 들어있다
  // — 그 결과 월요일 오전(실제 거래일)에 이 캐시만 보고 "마지막 행이 오늘이 아니다 =
  // 휴장"으로 오판해 실제 거래일을 비거래일로 잘못 라벨링했다. 캐시가 오늘 갱신된 적이
  // 없다면 "오늘 데이터가 없다"는 신호 자체를 신뢰할 수 없으므로, 비거래일 판정이 나왔을
  // 때만(항상은 아님 — 불필요한 캐시 조회 최소화) 이 캐시가 진짜 오늘자 조회였는지 한 번
  // 더 확인하고, 아니라면 보수적으로 거래일로 되돌린다(market-day-context.ts의 "판정 실패
  // 시엔 안전하게 거래일로 간주" 원칙과 동일).
  if (!marketDay.isTradingDay && firstAvailable) {
    const cacheIsFromToday = await isChartCacheFreshFromToday(firstAvailable.ticker, 6);
    if (!cacheIsFromToday) {
      console.warn(
        `[DASHBOARD-MONTHLY-RETURNS] ${firstAvailable.ticker} 캐시가 오늘 갱신된 적이 없어 ` +
        `비거래일 판정을 신뢰할 수 없음 — 보수적으로 거래일로 되돌림`,
      );
      marketDay = { isTradingDay: true, lastTradingDate: kstDateStr(new Date()), daysSinceLastTradingDate: 0, reason: null };
    }
  }

  return NextResponse.json({ monthly, daily, marketDay });
}
