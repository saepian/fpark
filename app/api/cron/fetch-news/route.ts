import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import { adminClient as supabase } from '@/lib/supabase-admin';
import { isFinanceRelated } from '@/lib/gemini';
import { batchSummarizeAndScore, isNewsFlagged, type BatchArticle, type ScoredSummary } from '@/lib/summarize';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type MediaContent = { $?: { url?: string } } | Array<{ $?: { url?: string } }>;
type CustomItem = {
  'media:content'?: MediaContent;
  'media:thumbnail'?: { $?: { url?: string } };
  'content:encoded'?: string;
};

const parser = new Parser<Record<string, never>, CustomItem>({
  customFields: {
    item: [
      ['media:content', 'media:content'],
      ['media:thumbnail', 'media:thumbnail'],
      ['content:encoded', 'content:encoded'],
    ],
  },
});

const RSS_SOURCES = [
  // 국내
  { url: 'https://www.yna.co.kr/rss/economy.xml',                            source: '연합뉴스',    category: 'domestic' as const },
  { url: 'https://www.hankyung.com/feed/economy',                             source: '한국경제',    category: 'domestic' as const },
  { url: 'https://www.mk.co.kr/rss/30100041/',                                source: '매일경제',    category: 'domestic' as const },
  { url: 'https://www.sedaily.com/rss/economy',                               source: '서울경제',    category: 'domestic' as const },
  // 해외
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',            source: 'CNBC',        category: 'global'   as const },
  { url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html',             source: 'CNBC Top',    category: 'global'   as const },
  { url: 'https://finance.yahoo.com/rss/topstories',                          source: 'Yahoo Finance', category: 'global' as const },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',      source: 'MarketWatch', category: 'global'   as const },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',        source: 'NYT',         category: 'global'   as const },
];

// 카테고리당 최대 수집 기사 수 — domestic 5 + global 5 = 총 10개
const MAX_PER_CATEGORY = 5;
const ITEMS_PER_FEED   = 5;

async function extractImageUrl(item: Parser.Item & CustomItem): Promise<string | null> {
  const mc = item['media:content'];
  if (mc) {
    const url = Array.isArray(mc) ? mc[0]?.$?.url : (mc as { $?: { url?: string } })?.$?.url;
    if (url && url.startsWith('http')) return url;
  }
  const mt = item['media:thumbnail'];
  if (mt?.$?.url && mt.$.url.startsWith('http')) return mt.$.url;
  const enc = (item.enclosure ? [item.enclosure] : []).find((e) => e.type?.startsWith('image/'));
  if (enc?.url) return enc.url;
  const html = item['content:encoded'] ?? item.content ?? item.summary ?? '';
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]?.startsWith('http')) return imgMatch[1];
  return null;
}

// 2026-09-04 메인 뉴스 품질 개선 B-2: 예전엔 RSS 이미지가 없으면 여기서 카테고리 폴백(국내/해외 모두
// 같은 캔들차트 unsplash) URL을 image_url에 그대로 저장해 메인 카드가 전부 같은 사진으로 보였다.
// 이제 폴백은 저장하지 않고 null로 남긴다 — 표시 쪽(components/main/NewsCard.tsx)이 카테고리·기사별로
// 분산된 플레이스홀더를 그린다. 예전 행에 박힌 폴백 URL도 NewsCard가 같은 규칙으로 걸러낸다.

type Candidate = {
  title: string; content: string; url: string;
  source: string; category: 'domestic' | 'global';
  pubDate: string | null; item: Parser.Item & CustomItem;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/fetch-news] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/fetch-news] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = { saved: 0, skipped: 0, filtered: 0, flagged: 0, errors: 0, haiku: null as null | { inputTokens: number; outputTokens: number } };
  const domesticCandidates: Candidate[] = [];
  const globalCandidates:   Candidate[] = [];

  // 1단계: RSS 병렬 수집
  const feedResults = await Promise.allSettled(
    RSS_SOURCES.map(async (source) => {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 4000);
      try {
        const res  = await fetch(source.url, {
          signal:  controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FPark/1.0)' },
        });
        const text = await res.text();
        const feed = await parser.parseString(text);
        return { source, items: feed.items.slice(0, ITEMS_PER_FEED) };
      } finally {
        clearTimeout(tid);
      }
    })
  );

  // 2단계: URL 수집 후 일괄 중복 체크
  type RawItem = { source: (typeof RSS_SOURCES)[number]; item: Parser.Item & CustomItem; url: string };
  const rawItems: RawItem[] = [];

  for (const result of feedResults) {
    if (result.status === 'rejected') {
      console.error('[CRON] RSS fetch error:', result.reason instanceof Error ? result.reason.message : result.reason);
      results.errors++;
      continue;
    }
    for (const item of result.value.items) {
      const url = item.link ?? item.guid;
      if (url) rawItems.push({ source: result.value.source, item: item as Parser.Item & CustomItem, url });
    }
  }

  const allUrls = rawItems.map((r) => r.url);
  const { data: existingRows } = await supabase
    .from('articles')
    .select('original_url')
    .in('original_url', allUrls);
  const existingUrls = new Set((existingRows ?? []).map((r: { original_url: string }) => r.original_url));

  // 3단계: 카테고리별로 분리해서 수집 (domestic / global 각각 MAX_PER_CATEGORY)
  for (const { source, item, url } of rawItems) {
    const cat = source.category;
    const bucket = cat === 'domestic' ? domesticCandidates : globalCandidates;
    if (bucket.length >= MAX_PER_CATEGORY) continue;
    if (existingUrls.has(url)) { results.skipped++; continue; }

    const title   = item.title ?? '(제목 없음)';
    const content = item.contentSnippet ?? item.content ?? item.summary ?? '';

    if (!isFinanceRelated(title, content)) {
      console.log(`[키워드필터] ${source.source} — ${title.slice(0, 50)}`);
      results.filtered++;
      continue;
    }

    bucket.push({ title, content, url, source: source.source, category: cat, pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : null, item });
  }

  const candidates = [...domesticCandidates, ...globalCandidates];
  console.log(
    `[CRON] 후보: domestic=${domesticCandidates.length} global=${globalCandidates.length} 합계=${candidates.length}`,
    `(건너뜀:${results.skipped} 필터:${results.filtered})`
  );

  // 4단계: 전체 기사 한 번에 요약+관련성 스코어링(Haiku 1회) + 이미지 추출 동시 실행
  // 2026-09-04 B-1: 키워드 필터(isFinanceRelated)만으로는 "[게시판] 은행연합회 위문금", "BNK투자증권
  // 금리우대 이벤트", "노원구 청년창업 인증제" 같은 홍보성·지역행사 기사가 그대로 메인에 올라왔다
  // (9/4 실데이터). 요약을 만들던 Haiku 호출에 점수/홍보성 판정을 얹어 크론 1회당 Haiku 1회를
  // 유지한 채 플래그를 저장하고, /api/news가 플래그 행을 제외한다(삭제하지 않음).
  console.log(`[CRON] 요약+스코어링 + 이미지 추출 시작 (${candidates.length}개 병렬)`);
  const fallbackScored: ScoredSummary[] = candidates.map(() => ({ summary: '', relevance: 5, promotional: false, reason: '스코어링 실패 — 보수적으로 노출' }));
  const [scored, allImageUrls] = await Promise.all([
    batchSummarizeAndScore(candidates.map((c) => ({ title: c.title, content: c.content } as BatchArticle))).catch((e) => {
      console.error('[CRON] batchSummarizeAndScore 오류:', e instanceof Error ? e.message.slice(0, 100) : e);
      return { items: fallbackScored, usage: null };
    }),
    Promise.all(candidates.map((c) => extractImageUrl(c.item).catch(() => null))),
  ]);
  results.haiku = scored.usage;
  console.log(`[CRON] 요약 완료: ${scored.items.filter((s) => s.summary).length}/${scored.items.length}개 성공, Haiku usage=${JSON.stringify(scored.usage)}`);

  // 5단계: Supabase 저장 (병렬)
  await Promise.all(candidates.map(async (c, j) => {
    const sc = scored.items[j] ?? fallbackScored[j];
    const flagged = isNewsFlagged(sc);
    if (flagged) results.flagged++;
    const imageUrl = allImageUrls[j];

    const payload = {
      title:        c.title,
      source:       c.source,
      category:     c.category,
      sub_category: 'general' as const,
      original_url: c.url,
      summary:      sc.summary || null,
      stocks:       [],
      image_url:    imageUrl ?? null,
      published_at: c.pubDate,
      relevance_score: sc.relevance,
      is_promotional:  flagged,
    };

    let { error } = await supabase.from('articles').insert(payload);

    // 마이그레이션(20260904_articles_relevance.sql) 미적용 DB에서도 크론이 죽지 않도록 —
    // sub_category 폴백과 같은 패턴. 플래그 없이 저장되면 그 행은 메인에 노출된다(구 동작).
    if (error?.message.includes('relevance_score') || error?.message.includes('is_promotional')) {
      console.warn('[CRON] relevance 컬럼 없음(마이그레이션 미적용) — 플래그 없이 저장');
      const { relevance_score: _rs, is_promotional: _ip, ...withoutFlags } = payload;
      ({ error } = await supabase.from('articles').insert(withoutFlags));
    }
    if (error?.message.includes('sub_category')) {
      const { sub_category: _sc, relevance_score: _rs2, is_promotional: _ip2, ...withoutSub } = payload;
      ({ error } = await supabase.from('articles').insert(withoutSub));
    }

    if (error) {
      console.error('[CRON] Insert error:', error.message);
      results.errors++;
    } else {
      results.saved++;
      console.log(`[저장${flagged ? '·제외' : ''}] ${c.category} ${c.source} — ${c.title.slice(0, 50)} (관련성 ${sc.relevance}${sc.promotional ? ', 홍보성' : ''}${flagged ? ` — ${sc.reason}` : ''})`);
    }
  }));

  return NextResponse.json({ ok: true, ...results });
}
