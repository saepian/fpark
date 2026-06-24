import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// DB category/sub_category codes → filter mapping
const CATEGORY_FILTER: Record<string, { field: 'category' | 'sub_category'; value: string }> = {
  domestic:    { field: 'category',     value: 'domestic' },
  global:      { field: 'category',     value: 'global' },
  macro:       { field: 'sub_category', value: 'macro' },
  real_estate: { field: 'sub_category', value: 'real_estate' },
  stock:       { field: 'sub_category', value: 'stock' },
  company:     { field: 'sub_category', value: 'company' },
  crypto:      { field: 'sub_category', value: 'crypto' },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  let query = supabase
    .from('articles')
    .select('*', { count: 'exact' })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (category && category !== 'all') {
    const filter = CATEGORY_FILTER[category];
    if (filter) {
      query = query.eq(filter.field, filter.value);
    }
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('[NEWS API] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ news: data ?? [], total: count ?? 0 });
}
