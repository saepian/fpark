import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchDividendHistory } from '@/lib/kis-api';
import { fetchDividendSummary, type DartDividendSummary } from '@/lib/dart-api';
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

// 3개씩 청크 처리 — KIS API rate limit 회피 (dashboard/holdings, dashboard/risk 라우트와 동일 패턴)
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

export interface DashboardDividendItem {
  ticker: string;
  dividendSummary: DartDividendSummary | null;
  // 종목카드 배지 모달은 "최신 배당 1건"만 보여주므로(5년 매트릭스 불필요), 여기서
  // fetchDividendHistory(최신순 정렬됨)의 첫 건만 잘라 응답 payload를 가볍게 유지한다.
  latestDividend: {
    recordDate: string; payDate: string | null; kind: '분기' | '결산'; kindLabel: string; perShareAmount: number;
  } | null;
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 숨긴 종목은 배당현황 배지에서도 제외 — KIS/DART 호출도 그만큼 아낀다.
  const { data, error } = await supabase
    .from('dashboard_holdings')
    .select('ticker')
    .eq('user_id', user.id)
    .eq('hidden', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickers = [...new Set((data ?? []).map(r => r.ticker))];

  // fetchDividendSummary(DART, 7일 캐시)·fetchDividendHistory(KIS, 24시간 캐시)는 이미
  // market_cache에 티커 단위로 캐시돼 있어(portfolio-diagnosis와 공유) 여기서 별도
  // 캐시 계층을 추가로 두지 않는다 — 페이지 진입 시 1회만 호출하는 것으로 충분.
  const dividends: DashboardDividendItem[] = await fetchInChunks(tickers, async (ticker) => {
    const [summary, history] = await Promise.all([
      fetchDividendSummary(ticker),
      fetchDividendHistory(ticker, { priority: 'batch' }), // 2026-09-03 트래픽점검 11번: 보유종목 수만큼 fan-out → 'batch'
    ]);
    return {
      ticker,
      dividendSummary: summary,
      latestDividend: history[0]
        ? {
            recordDate: history[0].recordDate, payDate: history[0].payDate,
            kind: history[0].kind, kindLabel: history[0].kindLabel, perShareAmount: history[0].perShareAmount,
          }
        : null,
    };
  });

  return NextResponse.json({ dividends });
}
