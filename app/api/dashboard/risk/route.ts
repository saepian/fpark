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
// 별도 엔드포인트로 분리했다.
// 2026-08-28: 이전엔 여기에 티커 단위 인메모리 캐시(인스턴스별로 격리돼 서버리스
// 인스턴스가 여러 개면 캐시 효과가 흩어짐)를 따로 걸었었는데, fetchDailyChart('1Y')가
// 이제 market_cache(Supabase) 기반 TTL 캐시를 자체 내장해(장중 5분/장외 1시간) 모든
// 인스턴스·모든 라우트(dashboard/analysis, portfolio-diagnosis 등)가 캐시를 공유하므로
// 이 로컬 캐시는 이중캐싱일 뿐이라 제거 — fetchDailyChart를 그냥 직접 호출한다.
interface RiskData { mdd: number; volatility: number; fiveDayChange: number | null }

// 최근 5거래일 종가 대비 등락률 — 별도 조회 없이 위험도 계산용으로 이미 받아온 1년치
// 종가(chart)에서 마지막 6개(5거래일 전 ~ 오늘)만 뽑아 계산한다. closes는 오름차순.
function computeFiveDayChange(closes: number[]): number | null {
  const valid = closes.filter(c => c > 0);
  if (valid.length < 6) return null;
  const [from, to] = [valid[valid.length - 6], valid[valid.length - 1]];
  return from > 0 ? ((to - from) / from) * 100 : null;
}

async function getRiskMetrics(ticker: string): Promise<RiskData | null> {
  try {
    const chart = await fetchDailyChart(ticker, '1Y', { priority: 'batch' }); // 2026-09-03: 보유종목 fan-out → 'batch'(거부 대신 대기)
    const closes = chart.map(p => p.close);
    const risk = computeRiskMetrics(closes);
    if (!risk) return null;
    return { ...risk, fiveDayChange: computeFiveDayChange(closes) };
  } catch {
    return null;
  }
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 숨긴 종목은 위험도 산점도 계산에서도 제외 — KIS 호출도 그만큼 아낀다.
  const { data, error } = await supabase
    .from('dashboard_holdings')
    .select('ticker')
    .eq('user_id', user.id)
    .eq('hidden', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickers = [...new Set((data ?? []).map(r => r.ticker))];
  const risk = await fetchInChunks(tickers, async (ticker) => {
    const metrics = await getRiskMetrics(ticker);
    return {
      ticker,
      mdd: metrics?.mdd ?? null,
      volatility: metrics?.volatility ?? null,
      fiveDayChange: metrics?.fiveDayChange ?? null,
    };
  });

  return NextResponse.json({ risk });
}
