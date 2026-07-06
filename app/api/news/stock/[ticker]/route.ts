import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { STOCK_NAMES, fetchStockPrice } from '@/lib/kis-api';
import { fetchNaverNews } from '@/lib/naver-news';
import { pickRelevantNews } from '@/lib/stock-analysis-data';
import type { NewsItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

// 종목 상세 페이지 사이드바 위젯이라 같은 종목이 짧은 시간 내 반복 요청되기 쉬움 —
// 매번 Naver API를 호출하지 않도록 인스턴스 단위 짧은 캐시를 둔다. Vercel 서버리스 특성상
// 인스턴스 간 공유는 보장되지 않지만, 동일 웜 인스턴스로 재진입하는 트래픽(같은 종목 페이지
// 재방문·리프레시)은 이걸로 충분히 걸러진다.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { news: NewsItem[]; expiresAt: number }>();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  const cached = cache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ news: cached.news });
  }

  // STOCK_NAMES는 스크리닝용으로 curated된 ~90종목만 커버 — 그 밖의 종목도 이름 검색이
  // 되도록 KIS에서 실시간으로 종목명을 해석(실패 시 STOCK_NAMES로 폴백)
  const stockName = STOCK_NAMES[ticker] ?? await fetchStockPrice(ticker).then((p) => p.name, () => undefined);

  const [byStock, byTitle, naverResult] = await Promise.all([
    supabase
      .from('articles')
      .select('id, title, source, category, sub_category, original_url, summary, stocks, image_url, published_at, created_at')
      .filter('stocks', 'cs', JSON.stringify([{ code: ticker }]))
      .order('published_at', { ascending: false })
      .limit(6),

    stockName
      ? supabase
          .from('articles')
          .select('id, title, source, category, sub_category, original_url, summary, stocks, image_url, published_at, created_at')
          .ilike('title', `%${stockName}%`)
          .order('published_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [], error: null }),

    stockName ? fetchNaverNews(stockName) : Promise.resolve({ items: [], apiError: false }),
  ]);

  if (byStock.error) {
    console.error('[NEWS/STOCK API] error:', byStock.error);
    return NextResponse.json({ error: byStock.error.message }, { status: 500 });
  }

  const seenId = new Set<string>();
  const dbNews: NewsItem[] = [...(byStock.data ?? []), ...(byTitle.data ?? [])].filter((item) => {
    if (seenId.has(item.id)) return false;
    seenId.add(item.id);
    return true;
  });

  // DB 캐시 뉴스 + Naver 실시간 검색 결과를 diagnosis/stock 분석과 동일하게
  // pickRelevantNews로 관련도 스코어링 — 제목에 종목명이 스쳐가는 시황 기사가
  // "관련 뉴스"로 오탐되지 않도록 걸러낸 뒤에만 채택한다.
  const candidates = [
    ...dbNews.map((n) => ({ title: n.title, summary: n.summary ?? undefined })),
    ...naverResult.items.map((n) => ({ title: n.title, summary: n.description })),
  ];
  const relevantTitles = stockName
    ? new Set(pickRelevantNews(candidates, stockName, undefined, 6).map((c) => c.title))
    : new Set(dbNews.map((n) => n.title)); // 종목명 매핑이 없으면 기존처럼 DB 결과 그대로 사용

  const dbRelevant = dbNews.filter((n) => relevantTitles.has(n.title));

  const naverRelevant: NewsItem[] = naverResult.items
    .filter((n) => relevantTitles.has(n.title))
    .map((n, i) => ({
      id:            `naver-${ticker}-${i}`,
      title:         n.title,
      source:        '네이버뉴스',
      category:      'domestic',
      sub_category:  null,
      original_url:  n.url,
      summary:       n.description,
      stocks:        stockName ? [{ code: ticker, name: stockName }] : null,
      image_url:     null,
      published_at:  n.pubDate ? new Date(n.pubDate).toISOString() : new Date().toISOString(),
      created_at:    new Date().toISOString(),
    }));

  const seenTitle = new Set<string>();
  const news = [...dbRelevant, ...naverRelevant]
    .filter((item) => {
      if (seenTitle.has(item.title)) return false;
      seenTitle.add(item.title);
      return true;
    })
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, 6);

  cache.set(ticker, { news, expiresAt: Date.now() + CACHE_TTL_MS });

  return NextResponse.json({ news });
}
