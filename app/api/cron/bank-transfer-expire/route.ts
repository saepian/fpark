// 계좌이체(무통장입금) 자동 만료 — 세 가지 케이스를 처리한다.
//   1. 신규가입 신청(request_type='new') 후 3일 내 관리자 승인이 없으면 만료 —
//      플랜은 부여되지 않으며, 다시 신청하려면 요금제 페이지에서 새로 신청해야 한다.
//   2. 갱신 신청(request_type='renewal') — 결제 예정일(next_billed_at) 당일까지도
//      미승인이면 즉시 만료(그레이스 기간 없음). 구독을 free로 강등하고 서비스 접근을
//      제한하며, 만료 안내 메일을 보낸다. 관리자는 /admin/payments에서 뒤늦게
//      "재활성화"로 되살릴 수 있다.
//   3. 해지예약(subscription_status='pending_cancellation', app/api/subscription/cancel에서
//      7일 초과 취소 시 설정) — next_billed_at(현재 결제 기간 만료일)이 지나면 free로 전환.
//      환불 대상이 아니었으므로 별도 안내 메일 없이 조용히 전환.

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { PLAN_AMOUNTS } from '@/lib/payment-constants';
import { buildExpiredEmailHtml, sendBankTransferEmail } from '@/lib/bank-transfer';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NEW_SIGNUP_EXPIRE_AFTER_DAYS = 3;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 결제 예정일 "당일" 끝(자정) — 이 시각을 넘긴 pending_renewal은 그레이스 없이 즉시 만료
function endOfTodayKstUtc(): Date {
  const shifted = new Date(Date.now() + KST_OFFSET_MS);
  const endOfDayKst = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1);
  return new Date(endOfDayKst - KST_OFFSET_MS);
}

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

  // ── 1. 신규가입 3일 미승인 만료 ─────────────────────────────────────────────
  const newSignupCutoff = new Date();
  newSignupCutoff.setDate(newSignupCutoff.getDate() - NEW_SIGNUP_EXPIRE_AFTER_DAYS);

  const { data: expiredNew, error: newError } = await adminClient
    .from('bank_transfer_requests')
    .update({ status: 'expired', processed_at: new Date().toISOString() })
    .eq('status', 'pending')
    .eq('request_type', 'new')
    .lt('requested_at', newSignupCutoff.toISOString())
    .select('id');

  if (newError) {
    console.error('[cron/bank-transfer-expire] 신규가입 만료 처리 실패:', newError);
  }

  // ── 2. 갱신 결제일 당일까지 미승인 시 즉시 만료 (그레이스 기간 없음) ─────────
  const deadline = endOfTodayKstUtc();

  const { data: overdueUsers, error: userFetchError } = await adminClient
    .from('users')
    .select('id, email, plan, next_billed_at')
    .eq('subscription_status', 'pending_renewal')
    .lt('next_billed_at', deadline.toISOString());

  let renewalExpiredCount = 0;
  let renewalExpireFailed = 0;

  if (userFetchError) {
    console.error('[cron/bank-transfer-expire] 갱신 대상 조회 실패:', userFetchError);
  } else {
    for (const u of overdueUsers ?? []) {
      try {
        const { error: userUpdateError } = await adminClient
          .from('users')
          .update({
            plan:                     'free',
            subscription_plan:        'free',
            subscription_status:      'expired',
            subscription_start_date:  null, // 완전히 만료됐으므로 재구독 시 새 기준일로 시작
          })
          .eq('id', u.id);

        if (userUpdateError) {
          console.error(`[cron/bank-transfer-expire] 유저 만료 처리 실패 (${u.email}):`, userUpdateError);
          renewalExpireFailed++;
          continue;
        }

        // 해당 유저의 대기중 갱신 신청도 함께 만료 처리 (관리자 목록에서 "만료됨"으로 이동)
        await adminClient
          .from('bank_transfer_requests')
          .update({ status: 'expired', processed_at: new Date().toISOString() })
          .eq('user_id', u.id)
          .eq('status', 'pending')
          .eq('request_type', 'renewal');

        if (u.email) {
          const planName = PLAN_AMOUNTS[(u.plan === 'pro' ? 'pro' : 'basic') as 'basic' | 'pro'].name;
          await sendBankTransferEmail({
            to:      u.email,
            subject: '[fpark] 구독이 만료되었습니다',
            html:    buildExpiredEmailHtml(planName),
            logTag:  'cron/bank-transfer-expire',
          });
        }

        renewalExpiredCount++;
      } catch (e) {
        console.error(`[cron/bank-transfer-expire] 갱신 만료 처리 중 예외 (${u.email}):`, e);
        renewalExpireFailed++;
      }
    }
  }

  // ── 3. 해지예약(pending_cancellation) — 현재 결제 기간 만료일 도달 시 free 전환 ──
  const { data: cancelledUsers, error: cancelFetchError } = await adminClient
    .from('users')
    .update({
      plan:                     'free',
      subscription_plan:        'free',
      subscription_status:      'cancelled',
      next_billed_at:           null,
      subscription_start_date:  null,
    })
    .eq('subscription_status', 'pending_cancellation')
    .lte('next_billed_at', new Date().toISOString())
    .select('id');

  if (cancelFetchError) {
    console.error('[cron/bank-transfer-expire] 해지예약 만료 처리 실패:', cancelFetchError);
  }

  console.log(
    `[cron/bank-transfer-expire] 완료 — 신규가입 만료:${expiredNew?.length ?? 0} ` +
    `갱신 만료:${renewalExpiredCount} 실패:${renewalExpireFailed} 해지예약 만료:${cancelledUsers?.length ?? 0}`,
  );
  return NextResponse.json({
    ok: true,
    newSignupExpiredCount: expiredNew?.length ?? 0,
    renewalExpiredCount,
    renewalExpireFailed,
    pendingCancellationExpiredCount: cancelledUsers?.length ?? 0,
  });
}
