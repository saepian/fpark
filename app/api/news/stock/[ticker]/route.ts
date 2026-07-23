import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { STOCK_NAMES, fetchStockPrice } from '@/lib/kis-api';
import { selectRelevantNews, type NewsCandidate } from '@/lib/news-selection';
import type { NewsItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

// 2026-07-23: 종목명 단독 검색 + 구식 스코어링(pickRelevantNews)이 "네이버"처럼 일상어와
// 겹치는 종목에서 무관 기사(현대글로비스 매출, 삼성 성과급 등)를 "관련뉴스"로 잘못
// 채택하는 문제를 실측 확인 — 원인은 두 가지: (1) 종목명 단독 검색의 노이즈 범람,
// (2) pickRelevantNews의 실적 키워드 가산점(+3)이 단독으로 채택 기준(2점)을 넘어
// 종목명과 무관한 기사도 "실적/매출" 단어만 있으면 통과시키던 로직 결함. 종목분석/
// 기업분석/포트폴리오진단에서 이미 검증된 selectRelevantNews(종목명+코드 병행 검색 +
// Haiku 1차 선별)로 교체. 캐시도 인스턴스 메모리(10분, 서버리스 인스턴스 간 미공유)에서
// selectRelevantNews 내부의 market_cache(20분, Supabase 공유 — 같은 ticker 키를
// 다른 세 라우트와 공유)로 자연스럽게 대체된다.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  // STOCK_NAMES는 스크리닝용으로 curated된 ~90종목만 커버 — 그 밖의 종목도 이름 검색이
  // 되도록 KIS에서 실시간으로 종목명을 해석(실패 시 STOCK_NAMES로 폴백)
  const stockName = STOCK_NAMES[ticker] ?? await fetchStockPrice(ticker).then((p) => p.name, () => undefined);

  if (!stockName) {
    return NextResponse.json({ news: [] });
  }

  const dbNewsPromise: Promise<NewsCandidate[]> = (async () => {
    const [byStock, byTitle] = await Promise.all([
      supabase
        .from('articles')
        .select('title, source, original_url, summary, published_at')
        .filter('stocks', 'cs', JSON.stringify([{ code: ticker }]))
        .order('published_at', { ascending: false })
        .limit(6),
      supabase
        .from('articles')
        .select('title, source, original_url, summary, published_at')
        .ilike('title', `%${stockName}%`)
        .order('published_at', { ascending: false })
        .limit(6),
    ]);

    const seen = new Set<string>();
    return [...(byStock.data ?? []), ...(byTitle.data ?? [])]
      .filter((n) => {
        if (seen.has(n.title)) return false;
        seen.add(n.title);
        return true;
      })
      .map((n) => ({
        title:   n.title,
        summary: n.summary ?? undefined,
        date:    n.published_at ? new Date(n.published_at).toISOString() : undefined,
        url:     n.original_url,
        source:  n.source,
      }));
  })();

  const { items } = await selectRelevantNews(ticker, stockName, dbNewsPromise);

  const news: NewsItem[] = items.map((n, i) => ({
    id:           `news-${ticker}-${i}`,
    title:        n.title,
    source:       n.source ?? '네이버뉴스',
    category:     'domestic',
    sub_category: null,
    original_url: n.url || `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(n.title)}`,
    summary:      n.summary ?? '',
    stocks:       [{ code: ticker, name: stockName }],
    image_url:    null,
    published_at: n.date && !isNaN(Date.parse(n.date)) ? new Date(n.date).toISOString() : new Date().toISOString(),
    created_at:   new Date().toISOString(),
  }));

  return NextResponse.json({ news });
}
