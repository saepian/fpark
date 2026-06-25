import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient(
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

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  const withPrice = await Promise.all(
    (data ?? []).map(async (item) => {
      const market = item.market ?? 'kr';
      try {
        // 해외 종목은 overseas price API 사용
        const priceUrl = market === 'kr'
          ? `${siteUrl}/api/stock/${item.ticker}/price`
          : `${siteUrl}/api/stock/overseas/${item.ticker}/quote`;
        const res = await fetch(priceUrl, {
          signal: AbortSignal.timeout(3000),
          cache: 'no-store',
        });
        if (!res.ok) return { ...item, price: 0, changeRate: 0 };
        const json = await res.json();
        return {
          ...item,
          price:      json.price ?? 0,
          changeRate: json.changeRate ?? 0,
          currency:   json.currency ?? (market === 'kr' ? 'KRW' : 'USD'),
        };
      } catch {
        return { ...item, price: 0, changeRate: 0 };
      }
    }),
  );

  return NextResponse.json(withPrice);
}

export async function POST(request: NextRequest) {
  const { ticker, name, market = 'kr' } = await request.json();
  if (!ticker || !name) return NextResponse.json({ error: 'ticker, name required' }, { status: 400 });

  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { count } = await supabase
    .from('watchlist')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if ((count ?? 0) >= 15) {
    return NextResponse.json({ error: '관심종목은 최대 15개까지 등록할 수 있습니다.' }, { status: 400 });
  }

  const { error } = await supabase
    .from('watchlist')
    .insert({ user_id: user.id, ticker, name, market, sort_order: count ?? 0 });

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
    .from('watchlist')
    .delete()
    .eq('user_id', user.id)
    .eq('ticker', ticker);

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const { order }: { order: string[] } = await request.json();
  if (!Array.isArray(order)) return NextResponse.json({ error: 'order required' }, { status: 400 });

  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await Promise.all(
    order.map((ticker, idx) =>
      supabase
        .from('watchlist')
        .update({ sort_order: idx })
        .eq('user_id', user.id)
        .eq('ticker', ticker),
    ),
  );

  return NextResponse.json({ success: true });
}
