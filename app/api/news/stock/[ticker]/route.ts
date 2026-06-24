import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { STOCK_NAMES } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  const [byStock, byTitle] = await Promise.all([
    supabase
      .from('articles')
      .select('id, title, source, category, sub_category, original_url, summary, stocks, image_url, published_at, created_at')
      .filter('stocks', 'cs', JSON.stringify([{ code: ticker }]))
      .order('published_at', { ascending: false })
      .limit(6),

    STOCK_NAMES[ticker]
      ? supabase
          .from('articles')
          .select('id, title, source, category, sub_category, original_url, summary, stocks, image_url, published_at, created_at')
          .ilike('title', `%${STOCK_NAMES[ticker]}%`)
          .order('published_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (byStock.error) {
    console.error('[NEWS/STOCK API] error:', byStock.error);
    return NextResponse.json({ error: byStock.error.message }, { status: 500 });
  }

  const seen = new Set<string>();
  const news = [...(byStock.data ?? []), ...(byTitle.data ?? [])]
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 6);

  return NextResponse.json({ news });
}
