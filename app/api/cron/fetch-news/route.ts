import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import { createClient } from '@supabase/supabase-js';
import { isFinanceRelated } from '@/lib/gemini';
import { batchSummarize, type BatchArticle } from '@/lib/summarize';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel Pro: 5분

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// rss-parser가 기본적으로 처리하지 않는 media 네임스페이스 타입
type MediaContent = { $?: { url?: string } } | Array<{ $?: { url?: string } }>;
type CustomItem = {
  'media:content'?: MediaContent;
  'media:thumbnail'?: { $?: { url?: string } };
  'content:encoded'?: string;
};

const parser = new Parser<Record<string, never>, CustomItem>({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FPark/1.0)' },
  customFields: {
    item: [
      ['media:content', 'media:content'],
      ['media:thumbnail', 'media:thumbnail'],
      ['content:encoded', 'content:encoded'],
    ],
  },
});

const RSS_SOURCES = [
  { url: 'https://www.yna.co.kr/rss/economy.xml',                              source: '연합뉴스',  category: 'domestic' as const, max: 20 },
  { url: 'https://www.hankyung.com/feed/economy',                               source: '한국경제',  category: 'domestic' as const, max: 20 },
  { url: 'https://www.mk.co.kr/rss/30100041/',                                  source: '매일경제',  category: 'domestic' as const, max: 20 },
  { url: 'https://www.sedaily.com/rss/economy',                                 source: '서울경제',  category: 'domestic' as const, max: 20 },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',              source: 'CNBC',      category: 'global'   as const, max: 15 },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',          source: 'NYT',       category: 'global'   as const, max: 15 },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',        source: 'MarketWatch', category: 'global' as const, max: 10 },
];

const BATCH_SIZE = 5;

// 이미지 URL 추출 (우선순위: media > enclosure > img태그 > og:image)
async function extractImageUrl(
  item: Parser.Item & CustomItem,
  articleUrl: string
): Promise<string | null> {
  // 1순위-a: media:content
  const mc = item['media:content'];
  if (mc) {
    const url = Array.isArray(mc) ? mc[0]?.$?.url : (mc as { $?: { url?: string } })?.$?.url;
    if (url && url.startsWith('http')) return url;
  }
  // 1순위-b: media:thumbnail
  const mt = item['media:thumbnail'];
  if (mt?.$?.url && mt.$.url.startsWith('http')) return mt.$.url;
  // 1순위-c: enclosure (rss-parser 네이티브)
  const enc = (item.enclosure ? [item.enclosure] : []).find((e) => e.type?.startsWith('image/'));
  if (enc?.url) return enc.url;

  // 2순위: content:encoded 또는 description에서 첫 번째 img src 추출
  const html = item['content:encoded'] ?? item.content ?? item.summary ?? '';
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]?.startsWith('http')) return imgMatch[1];

  // 3순위: 원문 페이지의 og:image (타임아웃 3초)
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(articleUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FPark/1.0)' },
    });
    clearTimeout(tid);
    const pageHtml = await res.text();
    const ogMatch =
      pageHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      pageHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch?.[1]?.startsWith('http')) return ogMatch[1];
  } catch {
    // 타임아웃·네트워크 오류 무시
  }

  return null;
}

// 이미지 추출 실패 시 category별 기본 이미지
const CATEGORY_IMAGE_FALLBACK: Record<string, string> = {
  domestic: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=200&fit=crop',
  global:   'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=200&fit=crop',
};
const DEFAULT_IMAGE_FALLBACK = 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=400&h=200&fit=crop';

type Candidate = {
  title: string;
  content: string;
  url: string;
  source: string;
  category: 'domestic' | 'global';
  pubDate: string | null;
  item: Parser.Item & CustomItem;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = { saved: 0, skipped: 0, filtered: 0, errors: 0 };
  const candidates: Candidate[] = [];

  // 1단계: RSS 수집 + 중복 체크 + 키워드 필터 (Gemini 호출 없음)
  for (const source of RSS_SOURCES) {
    try {
      const feed  = await parser.parseURL(source.url);
      const items = feed.items.slice(0, source.max);

      for (const item of items) {
        const url = item.link ?? item.guid;
        if (!url) continue;

        const { data: existing } = await supabase
          .from('articles')
          .select('id')
          .eq('original_url', url)
          .maybeSingle();

        if (existing) { results.skipped++; continue; }

        const title   = item.title ?? '(제목 없음)';
        const content = item.contentSnippet ?? item.content ?? item.summary ?? '';

        if (!isFinanceRelated(title, content)) {
          console.log(`[키워드필터] ${source.source} — ${title.slice(0, 50)}`);
          results.filtered++;
          continue;
        }

        candidates.push({
          title,
          content,
          url,
          source:   source.source,
          category: source.category,
          pubDate:  item.pubDate ? new Date(item.pubDate).toISOString() : null,
          item:     item as Parser.Item & CustomItem,
        });
      }
    } catch (e) {
      console.error(`RSS fetch error [${source.source}]:`, e);
      results.errors++;
    }
  }

  console.log(`[CRON] 후보: ${candidates.length}개 (건너뜀: ${results.skipped}, 키워드필터: ${results.filtered})`);

  // 2단계: 5개씩 배치로 Gemini 요약 + 이미지 추출 병렬 처리
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchArticles: BatchArticle[] = batch.map((c) => ({ title: c.title, content: c.content }));

    console.log(`[CRON] 배치 처리 ${i + 1}~${i + batch.length}/${candidates.length}`);

    const [summaries, imageUrls] = await Promise.all([
      batchSummarize(batchArticles).catch((e) => {
        console.error('[CRON] batchSummarize 오류:', e instanceof Error ? e.message.slice(0, 100) : e);
        return batch.map(() => null as string | null);
      }),
      Promise.all(batch.map((c) => extractImageUrl(c.item, c.url).catch(() => null))),
    ]);

    console.log(`[CRON] 요약 결과: ${summaries.filter(Boolean).length}/${summaries.length}개 성공`);

    for (let j = 0; j < batch.length; j++) {
      const c        = batch[j];
      // Gemini 실패 시 null 저장 → backfill이 IS NULL로 찾을 수 있음
      const summary  = summaries[j] || null;
      const imageUrl = imageUrls[j];

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

      // PostgREST 스키마 캐시 stale → sub_category 없이 재시도
      if (error?.message.includes('sub_category')) {
        const { sub_category: _sc, ...withoutSub } = payload;
        ({ error } = await supabase.from('articles').insert(withoutSub));
      }

      if (error) {
        console.error('Insert error:', error.message);
        results.errors++;
      } else {
        results.saved++;
        console.log(`[저장] ${c.source} — ${c.title.slice(0, 50)}`);
      }
    }

    // 배치 간 딜레이 (Gemini rate limit 대응)
    if (i + BATCH_SIZE < candidates.length) {
      await new Promise((r) => setTimeout(r, 15000));
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
