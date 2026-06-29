import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// 해외 뉴스 소스 목록 (domestic 조회 시 제외)
const FOREIGN_SOURCES = [
  'CNBC', 'Yahoo Finance', 'Reuters', 'Bloomberg', 'MarketWatch',
  'Financial Times', 'The Wall Street Journal', 'WSJ', 'AP News',
  'AP', 'CNN Business', 'Forbes', 'Business Insider', 'Investing.com',
];

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

  if (category === 'domestic') {
    // 국내 카테고리만 허용 + 해외 소스 제외
    query = query.in('category', ['국내주식', '경제', 'domestic']);
    for (const src of FOREIGN_SOURCES) {
      query = query.not('source', 'ilike', `%${src}%`);
    }
  } else if (category === 'global') {
    query = query.in('category', ['해외주식', '글로벌', 'global']);
  } else if (category && category !== 'all') {
    // 기존 sub_category 필터 지원
    const SUB_CATEGORY_FILTERS: Record<string, string> = {
      macro: 'macro', real_estate: 'real_estate',
      stock: 'stock', company: 'company', crypto: 'crypto',
    };
    const sub = SUB_CATEGORY_FILTERS[category];
    if (sub) query = query.eq('sub_category', sub);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('[NEWS API] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ news: data ?? [], total: count ?? 0 });
}
