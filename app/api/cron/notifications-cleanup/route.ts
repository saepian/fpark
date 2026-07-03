import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// 매일 00:00 KST 실행 — 오늘 이전(어제까지) 알림 데이터를 DB에서 완전히 삭제
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/notifications-cleanup] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/notifications-cleanup] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0];
    const cutoff = `${todayKst}T00:00:00+09:00`;

    const { error, count } = await supabase
      .from('notifications')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);

    if (error) throw error;

    console.log(`[CLEANUP] 알림 ${count}개 삭제 완료 (기준: ${cutoff} 이전)`);

    return NextResponse.json({
      success: true,
      deleted: count,
      cutoff,
    });
  } catch (err) {
    console.error('[CLEANUP] 알림 삭제 실패:', err);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
