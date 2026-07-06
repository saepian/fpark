export interface NaverNewsItem {
  title: string;
  description: string;
  url: string;
  pubDate: string;
}

export interface FetchNaverNewsOptions {
  display?: number;        // 기본 5
  sort?: 'sim' | 'date';   // 기본 sim(관련도) — 최신순이 필요하면 'date'
  timeoutMs?: number;      // 기본 4000ms
}

export interface FetchNaverNewsResult {
  items: NaverNewsItem[];
  apiError: boolean;
}

// Naver 뉴스 검색 API 공통 래퍼 — diagnosis(종목진단)/morning-briefing(아침 브리핑)/
// stock 분석/daily-pick(오늘의 수급 상위 기업)이 전부 이 함수를 재사용한다.
// NAVER_NEWS_CLIENT_ID/SECRET(검색 전용 키)만 사용 — NAVER_CLIENT_ID(로그인용)와 무관.
export async function fetchNaverNews(
  query: string,
  options: FetchNaverNewsOptions = {},
): Promise<FetchNaverNewsResult> {
  const { display = 5, sort = 'sim', timeoutMs = 4000 } = options;

  try {
    const url = new URL('https://openapi.naver.com/v1/search/news.json');
    url.searchParams.set('query', query);
    url.searchParams.set('display', String(display));
    if (sort === 'date') url.searchParams.set('sort', 'date');

    const res = await fetch(url.toString(), {
      headers: {
        'X-Naver-Client-Id':     process.env.NAVER_NEWS_CLIENT_ID ?? '',
        'X-Naver-Client-Secret': process.env.NAVER_NEWS_CLIENT_SECRET ?? '',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      console.error(`[naver-news] API 응답 실패 (${query}): HTTP ${res.status}`);
      return { items: [], apiError: true };
    }

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: NaverNewsItem[] = (data.items ?? []).map((item: any) => ({
      title:       String(item.title ?? '').replace(/<[^>]*>/g, ''),
      description: String(item.description ?? '').replace(/<[^>]*>/g, ''),
      url:         String(item.originallink || item.link || ''),
      pubDate:     String(item.pubDate ?? ''),
    }));
    return { items, apiError: false };
  } catch (e) {
    console.error('[naver-news] 조회 실패:', query, e instanceof Error ? e.message : e);
    return { items: [], apiError: true };
  }
}
