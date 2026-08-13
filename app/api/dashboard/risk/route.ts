import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchDailyChart } from '@/lib/kis-api';
import { computeRiskMetrics } from '@/lib/stock-analysis-data';
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

// 3개씩 청크 처리 — KIS API rate limit 회피 (dashboard/holdings route와 동일 패턴)
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

// MDD/변동성은 1년치 일봉 차트가 필요해 시세 조회보다 훨씬 무거운 호출이다. 5분
// 시세폴링(dashboard/holdings)에는 얹지 않고 클라이언트가 페이지 진입 시 1회만 부르는
// 별도 엔드포인트로 분리했고, 여기에 티커 단위 인메모리 캐시(app/api/search/route.ts와
// 동일한 패턴)를 걸어 같은 티커를 여러 유저가 반복 조회해도 KIS 호출이 시간당 1회로
// 수렴하게 한다 — 종가 기반 지표라 장중에 값이 바뀌지 않으므로 1시간 TTL이면 충분하다.
const RISK_CACHE_TTL_MS = 60 * 60 * 1000;
const riskCache = new Map<string, { data: { mdd: number; volatility: number } | null; expiresAt: number }>();

async function getRiskMetrics(ticker: string) {
  const cached = riskCache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  let data: { mdd: number; volatility: number } | null = null;
  try {
    const chart = await fetchDailyChart(ticker, '1Y');
    data = computeRiskMetrics(chart.map(p => p.close));
  } catch {
    data = null;
  }
  riskCache.set(ticker, { data, expiresAt: Date.now() + RISK_CACHE_TTL_MS });
  return data;
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('dashboard_holdings')
    .select('ticker')
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickers = [...new Set((data ?? []).map(r => r.ticker))];
  const risk = await fetchInChunks(tickers, async (ticker) => {
    const metrics = await getRiskMetrics(ticker);
    return { ticker, mdd: metrics?.mdd ?? null, volatility: metrics?.volatility ?? null };
  });

  return NextResponse.json({ risk });
}
