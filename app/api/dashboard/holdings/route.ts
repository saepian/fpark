import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchStockQuote } from '@/lib/kis-api';
import { checkPlan, resolveDashboardHoldingsLimit } from '@/lib/plan';
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

// 3개씩 청크 처리 — KIS API rate limit 회피 (watchlist route와 동일 패턴)
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

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('dashboard_holdings')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = data ?? [];

  const withPrice = await fetchInChunks(
    items,
    async (item) => {
      try {
        // 시세와 52주고저/시총/PER/PBR/업종을 같은 KIS 응답(inquire-price)에서 함께 받는다
        // (fetchStockQuote) — 카드에 52주고저·시총, 산업군별 비중 도넛에 업종을 추가해도
        // 호출 횟수는 늘지 않음.
        const stock = await fetchStockQuote(item.ticker);
        return {
          ...item,
          currentPrice: stock.price, changeRate: stock.changeRate,
          week52High: stock.week52High, week52Low: stock.week52Low,
          marketCap: stock.marketCap, per: stock.per, pbr: stock.pbr,
          sector: stock.sector,
        };
      } catch {
        return {
          ...item,
          currentPrice: 0, changeRate: 0,
          week52High: 0, week52Low: 0, marketCap: '', per: 0, pbr: 0,
          sector: '',
        };
      }
    },
    3,
    250,
  );

  // 프론트가 "N/한도" 표시·등록 버튼 비활성화를 판단할 수 있도록 플랜 한도도 함께 반환
  // (watchlist는 플랜 무관 고정 15개라 이 정보가 필요 없었지만, 대시보드는 플랜별로 다름).
  const plan  = await checkPlan(supabase, user.id, user.email);
  const limit = resolveDashboardHoldingsLimit(plan);

  return NextResponse.json({ holdings: withPrice, limit, plan });
}

export async function POST(request: NextRequest) {
  const { ticker, name, avgPrice, buyDate, quantity } = await request.json();
  if (!ticker || !name || !avgPrice || !quantity) {
    return NextResponse.json({ error: 'ticker, name, avgPrice, quantity required' }, { status: 400 });
  }

  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 동일 종목 재등록은 신규 등록이 아니라 매수정보 갱신(upsert) — 등록 종목 수
  // 한도(resolveDashboardHoldingsLimit)는 신규 종목 추가일 때만 검사한다.
  const { data: existing } = await supabase
    .from('dashboard_holdings')
    .select('id')
    .eq('user_id', user.id)
    .eq('ticker', ticker)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('dashboard_holdings')
      .update({ name, avg_price: avgPrice, buy_date: buyDate ?? null, quantity })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  const plan  = await checkPlan(supabase, user.id, user.email);
  const limit = resolveDashboardHoldingsLimit(plan);
  const { count } = await supabase
    .from('dashboard_holdings')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if ((count ?? 0) >= limit) {
    return NextResponse.json(
      { error: `현재 플랜에서는 최대 ${limit}개 종목까지 등록할 수 있습니다.` },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('dashboard_holdings')
    .insert({ user_id: user.id, ticker, name, market: 'kr', avg_price: avgPrice, buy_date: buyDate ?? null, quantity });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { ticker } = await request.json();
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await supabase
    .from('dashboard_holdings')
    .delete()
    .eq('user_id', user.id)
    .eq('ticker', ticker);

  return NextResponse.json({ success: true });
}
