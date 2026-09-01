import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
// 2026-08-31: fetchStockPrice(라이브) → fetchStockPriceCached — 홈 관심종목 위젯이 유저마다
// 주기 폴링하는 라우트라 같은 종목을 유저 수만큼 KIS 재조회하던 최상위 병목. 공용 캐시
// (lib/kis-api.ts, 장중 30초/장외 30분)로 /price·dashboard·검색과 시세를 공유한다.
import { fetchStockPricesCached } from '../../../lib/kis-api';
import { fetchOverseasQuote } from '../../../lib/yahoo-finance';
import type { Database } from '../../../lib/database.types';

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

// 2026-09-01: 포트폴리오분석 "워치리스트에서 불러오기"가 느리다는 불편 — 실측(12종목) 콜드
// 9.0초 / 웜 2.5~3.1초. 원인은 (a) 그 화면은 종목코드·이름만 쓰는데 시세까지 붙여 기다렸고,
// (b) 시세 부착이 3개 청크 + 250ms 딜레이 + 종목당 캐시 DB 왕복 구조라 캐시 히트여도 1초대가
// 그대로 쌓였기 때문(트래픽 점검 때 본 "캐시 히트인데 청크 스로틀 잔재로 느림"과 같은 클래스).
// → ?prices=0 이면 시세 없이 DB 조회만으로 즉시 반환(포트폴리오 폼용), 기본 경로는
//   fetchStockPricesCached로 캐시를 IN 쿼리 한 번에 읽고 미스만 라이브(전역 게이트가 페이싱).
//   해외 종목(Yahoo)은 원래 청크 로직을 그대로 유지한다.
export async function GET(request: NextRequest) {
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
  const withoutPrices = request.nextUrl.searchParams.get('prices') === '0';
  if (withoutPrices) return NextResponse.json(items);

  const krItems = items.filter(i => (i.market ?? 'kr') === 'kr');
  const { prices: krPrices } = await fetchStockPricesCached(krItems.map(i => i.ticker));
  const krPriced = new Map(krItems.map(item => {
    const stock = krPrices.get(item.ticker);
    return [item.ticker, stock
      ? { ...item, price: stock.price, changeRate: stock.changeRate, currency: 'KRW' }
      // 라이브까지 실패 — price: 0으로 반환해 클라이언트가 재시도하게 함(기존 정책)
      : { ...item, price: 0, changeRate: 0, currency: 'KRW' }];
  }));

  const overseasItems = items.filter(i => (i.market ?? 'kr') !== 'kr');
  const overseasPriced = await fetchInChunks(
    overseasItems,
    async (item) => {
      try {
        return await withRetry(async () => {
          const quote = await fetchOverseasQuote(item.ticker);
          return { ...item, price: quote.price, changeRate: quote.changeRate, currency: quote.currency };
        });
      } catch {
        return { ...item, price: 0, changeRate: 0, currency: 'USD' };
      }
    },
    3, 250,
  );
  const overseasMap = new Map(overseasPriced.map(o => [o.ticker, o]));

  // 원래 sort_order 순서 유지
  const withPrice = items.map(item =>
    (item.market ?? 'kr') === 'kr' ? krPriced.get(item.ticker)! : (overseasMap.get(item.ticker) ?? { ...item, price: 0, changeRate: 0, currency: 'USD' }),
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

  // N개 개별 UPDATE → RPC 단일 호출로 개선 (update_watchlist_order 함수 필요)
  const { error } = await supabase.rpc('update_watchlist_order', {
    p_user_id: user.id,
    p_tickers: order,
    p_orders:  order.map((_, i) => i),
  });

  if (error) {
    console.error('[watchlist PATCH] RPC 실패:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
