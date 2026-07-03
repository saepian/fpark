import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/news-cleanup] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/news-cleanup] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error, count } = await supabase
      .from('articles')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);

    if (error) throw error;

    console.log(`[CLEANUP] 뉴스 ${count}개 삭제 완료`);

    return NextResponse.json({
      success: true,
      deleted: count,
      message: `${count}개의 오래된 뉴스가 삭제되었습니다.`,
    });
  } catch (err) {
    console.error('[CLEANUP] 실패:', err);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
