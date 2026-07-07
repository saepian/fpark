// 계좌이체(무통장입금) 신청 후 3일 내 관리자 승인이 없으면 자동 만료 처리.
// 플랜은 부여되지 않으며, 다시 신청하려면 요금제 페이지에서 새로 신청해야 한다.

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const EXPIRE_AFTER_DAYS = 3;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/bank-transfer-expire] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/bank-transfer-expire] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EXPIRE_AFTER_DAYS);

  const { data: expired, error } = await adminClient
    .from('bank_transfer_requests')
    .update({ status: 'expired', processed_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('requested_at', cutoff.toISOString())
    .select('id, user_id, plan, requested_at');

  if (error) {
    console.error('[cron/bank-transfer-expire] 업데이트 실패:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  console.log(`[cron/bank-transfer-expire] 만료 처리: ${expired?.length ?? 0}건`);
  return NextResponse.json({ ok: true, expiredCount: expired?.length ?? 0 });
}
