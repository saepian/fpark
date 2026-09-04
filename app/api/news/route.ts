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

  const buildQuery = () => {
    let q = supabase
      .from('articles')
      .select('*', { count: 'exact' })
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category === 'domestic') {
      // 국내 카테고리만 허용 + 해외 소스 제외
      q = q.in('category', ['국내주식', '경제', 'domestic']);
      for (const src of FOREIGN_SOURCES) {
        q = q.not('source', 'ilike', `%${src}%`);
      }
    } else if (category === 'global') {
      q = q.in('category', ['해외주식', '글로벌', 'global']);
    } else if (category && category !== 'all') {
      // 기존 sub_category 필터 지원
      const SUB_CATEGORY_FILTERS: Record<string, string> = {
        macro: 'macro', real_estate: 'real_estate',
        stock: 'stock', company: 'company', crypto: 'crypto',
      };
      const sub = SUB_CATEGORY_FILTERS[category];
      if (sub) q = q.eq('sub_category', sub);
    }
    return q;
  };
  const query = buildQuery();

  // 2026-09-04 B-1: 홍보성/저관련성 플래그(is_promotional) 행은 메인·뉴스 목록에서 제외. 삭제가 아니라
  // 플래그라 DB엔 남아 있고, 마이그레이션 미적용 상태(컬럼 없음)면 필터 없이 한 번 더 조회해 목록이
  // 통째로 깨지지 않게 한다.
  let { data, error, count } = await query.eq('is_promotional', false);
  if (error && /is_promotional/.test(error.message)) {
    console.warn('[NEWS API] is_promotional 컬럼 없음(마이그레이션 미적용) — 필터 없이 조회');
    ({ data, error, count } = await buildQuery());
  }
  if (error) {
    console.error('[NEWS API] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ news: data ?? [], total: count ?? 0 });
}
