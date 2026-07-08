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

  // 종목명 단독 검색은 실적 발표처럼 특정 이슈를 짚어내야 하는 날에 취약하다 —
  // 시황/제품 발표 등 그 종목을 언급하는 다른 기사가 워낙 많으면 display 개수 안에서
  // 밀려날 수 있다(2026-07-08 삼성전자 2분기 잠정실적 뉴스 미검색 문의로 실측 확인:
  // "삼성전자" 단독 검색은 date 정렬 20건 안에도 실적 기사가 전혀 안 잡혔지만,
  // "삼성전자 잠정실적"/"삼성전자 실적발표"로는 바로 잡혔고 SK하이닉스로도 동일하게
  // 재현됨 — 특정 종목만의 문제가 아니라 구조적 문제). 실적 관련 보조 쿼리를 병행해
  // pickRelevantNews()가 채점할 후보 폭을 넓힌다.
  const [byStock, byTitle, ...naverResults] = await Promise.all([
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

    ...(stockName
      ? [
          fetchNaverNews(stockName, { sort: 'date' }),
          fetchNaverNews(`${stockName} 잠정실적`, { sort: 'date' }),
          fetchNaverNews(`${stockName} 실적발표`, { sort: 'date' }),
        ]
      : [Promise.resolve({ items: [], apiError: false })]),
  ]);

  const seenNaverTitle = new Set<string>();
  const naverResult = {
    items: naverResults.flatMap((r) => r.items).filter((item) => {
      if (seenNaverTitle.has(item.title)) return false;
      seenNaverTitle.add(item.title);
      return true;
    }),
    apiError: naverResults.every((r) => r.apiError),
  };

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
