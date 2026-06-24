/**
 * image_url이 null인 기존 뉴스의 og:image를 일괄 업데이트.
 * 실행: npx tsx scripts/backfill-images.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// .env.local 로드 (tsx는 dotenv 자동 로드 안 함)
const envPath = resolve(process.cwd(), '.env.local');
readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const [key, ...vals] = line.split('=');
  if (key?.trim() && vals.length) process.env[key.trim()] = vals.join('=').trim();
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BATCH = 10;
const DELAY_MS = 500; // 배치 간 딜레이

async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FPark/1.0)' },
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const imgUrl = match?.[1];
    return imgUrl?.startsWith('http') ? imgUrl : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== backfill-images 시작 ===');
  let offset = 0;
  let total = 0;
  let updated = 0;
  let failed = 0;

  while (true) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, original_url')
      .is('image_url', null)
      .order('published_at', { ascending: false })
      .range(offset, offset + BATCH - 1);

    if (error) { console.error('fetch error:', error.message); break; }
    if (!data || data.length === 0) break;

    console.log(`\n[배치 ${Math.floor(offset / BATCH) + 1}] ${data.length}건 처리 중...`);

    await Promise.all(
      data.map(async (row) => {
        total++;
        const imageUrl = await fetchOgImage(row.original_url);
        if (!imageUrl) { failed++; return; }

        const { error: upErr } = await supabase
          .from('articles')
          .update({ image_url: imageUrl })
          .eq('id', row.id);

        if (upErr) {
          console.error(`  [ERROR] ${row.id}: ${upErr.message}`);
          failed++;
        } else {
          console.log(`  [OK] ${imageUrl.slice(0, 60)}`);
          updated++;
        }
      })
    );

    offset += BATCH;
    if (data.length < BATCH) break;
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\n=== 완료 ===`);
  console.log(`전체: ${total} | 업데이트: ${updated} | 실패(og 없음): ${failed}`);
}

main().catch(console.error);
