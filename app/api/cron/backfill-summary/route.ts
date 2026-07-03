import { NextRequest, NextResponse } from 'next/server';
import { adminClient as supabase } from '@/lib/supabase-admin';
import { batchSummarize } from '@/lib/summarize';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 5;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // summary가 null이거나 빈 문자열('')인 기사 최근 50개
  const { data: articles, error: fetchError } = await supabase
    .from('articles')
    .select('id, title, summary')
    .or('summary.is.null,summary.eq.')
    .order('published_at', { ascending: false })
    .limit(50);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!articles?.length) {
    return NextResponse.json({ message: '처리할 기사 없음', processed: 0 });
  }

  console.log('[BACKFILL] summary 없는 기사:', articles.length);

  let processed = 0;

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);

    let summaries: string[];
    try {
      summaries = await batchSummarize(batch.map((a) => ({ title: a.title, content: '' })));
    } catch (e) {
      console.error('[BACKFILL] batchSummarize 오류:', e instanceof Error ? e.message.slice(0, 150) : e);
      summaries = batch.map(() => '');
    }

    for (let j = 0; j < batch.length; j++) {
      const summary = summaries[j];
      if (!summary) continue;

      const { error } = await supabase
        .from('articles')
        .update({ summary })
        .eq('id', batch[j].id);

      if (error) {
        console.error('[BACKFILL] 업데이트 실패:', error.message);
      } else {
        processed++;
        console.log(`[BACKFILL] 업데이트: ${batch[j].title.slice(0, 50)}`);
      }
    }

    if (i + BATCH_SIZE < articles.length) {
      await new Promise((r) => setTimeout(r, 15000));
    }
  }

  return NextResponse.json({
    message: `${processed}개 기사 요약 완료`,
    total: articles.length,
    processed,
  });
}
