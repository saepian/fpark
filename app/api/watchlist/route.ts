import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchStockPrice } from '../../../lib/kis-api';
import { fetchOverseasQuote } from '../../../lib/yahoo-finance';

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

  const withPrice = await Promise.all(
    (data ?? []).map(async (item) => {
      const market = item.market ?? 'kr';
      try {
        if (market === 'kr') {
          const stock = await fetchStockPrice(item.ticker);
          return {
            ...item,
            price:      stock.price,
            changeRate: stock.changeRate,
            currency:   'KRW',
          };
        } else {
          const quote = await fetchOverseasQuote(item.ticker);
          return {
            ...item,
            price:      quote.price,
            changeRate: quote.changeRate,
            currency:   quote.currency,
          };
        }
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
