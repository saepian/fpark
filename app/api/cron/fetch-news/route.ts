import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import { adminClient as supabase } from '@/lib/supabase-admin';
import { isFinanceRelated } from '@/lib/gemini';
import { batchSummarize, type BatchArticle } from '@/lib/summarize';

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

const CATEGORY_IMAGE_FALLBACK: Record<string, string> = {
  domestic: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=200&fit=crop',
  global:   'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=200&fit=crop',
};
const DEFAULT_IMAGE_FALLBACK = 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=400&h=200&fit=crop';

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

  const results = { saved: 0, skipped: 0, filtered: 0, errors: 0 };
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

  // 4단계: 전체 기사 한 번에 요약 + 이미지 추출 동시 실행
  console.log(`[CRON] 요약 + 이미지 추출 시작 (${candidates.length}개 병렬)`);
  const [summaries, allImageUrls] = await Promise.all([
    batchSummarize(candidates.map((c) => ({ title: c.title, content: c.content } as BatchArticle))).catch((e) => {
      console.error('[CRON] batchSummarize 오류:', e instanceof Error ? e.message.slice(0, 100) : e);
      return candidates.map(() => null as string | null);
    }),
    Promise.all(candidates.map((c) => extractImageUrl(c.item).catch(() => null))),
  ]);
  console.log(`[CRON] 요약 완료: ${summaries.filter(Boolean).length}/${summaries.length}개 성공`);

  // 5단계: Supabase 저장 (병렬)
  await Promise.all(candidates.map(async (c, j) => {
    const summary  = summaries[j] || null;
    const imageUrl = allImageUrls[j];

    const payload = {
      title:        c.title,
      source:       c.source,
      category:     c.category,
      sub_category: 'general' as const,
      original_url: c.url,
      summary,
      stocks:       [],
      image_url:    imageUrl ?? CATEGORY_IMAGE_FALLBACK[c.category] ?? DEFAULT_IMAGE_FALLBACK,
      published_at: c.pubDate,
    };

    let { error } = await supabase.from('articles').insert(payload);

    if (error?.message.includes('sub_category')) {
      const { sub_category: _sc, ...withoutSub } = payload;
      ({ error } = await supabase.from('articles').insert(withoutSub));
    }

    if (error) {
      console.error('[CRON] Insert error:', error.message);
      results.errors++;
    } else {
      results.saved++;
      console.log(`[저장] ${c.category} ${c.source} — ${c.title.slice(0, 50)}`);
    }
  }));

  return NextResponse.json({ ok: true, ...results });
}
