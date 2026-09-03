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

    // 텔레그램 연동 토큰(10분 TTL)도 같이 청소 — 별도 크론을 늘리지 않고 이미 매일
    // 도는 이 정리 작업에 얹는다. 만료된 토큰은 마이페이지 재연동 시 새로 발급되므로
    // 그냥 지워도 무해하다.
    const { error: tgError, count: tgDeleted } = await supabase
      .from('telegram_link_tokens')
      .delete({ count: 'exact' })
      .lt('expires_at', new Date().toISOString());
    if (tgError) console.warn('[CLEANUP] 텔레그램 연동 토큰 삭제 실패:', tgError.message);
    else console.log(`[CLEANUP] 만료된 텔레그램 연동 토큰 ${tgDeleted}개 삭제 완료`);

    // 2026-09-03 저장 기능 — saved_reports도 같은 이유로 여기에 얹는다. "오늘 하루
    // 다시보기" 개념이라 물리 삭제 자체는 조회 API가 이미 saved_at=오늘(KST)로
    // 필터링해서 사용자 경험엔 영향 없음(1차 방어선) — 이 삭제는 테이블이 무한정
    // 커지는 걸 막는 위생 관리용 2차 방어선일 뿐이라, 하루 실패해도 다음날 정상
    // 동작한다(설계 확정, 2026-09-03 대화 참고).
    const { error: savedError, count: savedDeleted } = await supabase
      .from('saved_reports')
      .delete({ count: 'exact' })
      .lt('saved_at', cutoff);
    if (savedError) console.warn('[CLEANUP] 저장내역 삭제 실패:', savedError.message);
    else console.log(`[CLEANUP] 어제 이전 저장내역 ${savedDeleted}개 삭제 완료 (기준: ${cutoff} 이전)`);

    return NextResponse.json({
      success: true,
      deleted: count,
      telegramTokensDeleted: tgDeleted ?? 0,
      savedReportsDeleted: savedDeleted ?? 0,
      cutoff,
    });
  } catch (err) {
    console.error('[CLEANUP] 알림 삭제 실패:', err);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
