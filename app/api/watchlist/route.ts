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

// 1회 재시도 래퍼 (KIS rate limit 대비)
async function withRetry<T>(fn: () => Promise<T>, delayMs = 1000): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise(r => setTimeout(r, delayMs));
    return fn();
  }
}

// 3개씩 청크 처리 — KIS API rate limit 회피
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
    .from('watchlist')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = data ?? [];

  const withPrice = await fetchInChunks(
    items,
    async (item) => {
      const market = item.market ?? 'kr';
      try {
        return await withRetry(async () => {
          if (market === 'kr') {
            const stock = await fetchStockPrice(item.ticker);
            return { ...item, price: stock.price, changeRate: stock.changeRate, currency: 'KRW' };
          } else {
            const quote = await fetchOverseasQuote(item.ticker);
            return { ...item, price: quote.price, changeRate: quote.changeRate, currency: quote.currency };
          }
        });
      } catch {
        // 재시도 후에도 실패 — price: 0으로 반환해 클라이언트가 재시도하게 함
        return { ...item, price: 0, changeRate: 0, currency: market === 'kr' ? 'KRW' : 'USD' };
      }
    },
    3,   // 3개씩
    250, // 250ms 간격
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
