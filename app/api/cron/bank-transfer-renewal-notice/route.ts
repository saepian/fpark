// 계좌이체 구독 갱신 안내 — 결제 예정일(next_billed_at)이 3일 후인 active 구독자에게
// 매일 안내 메일을 보내고, 관리자 승인 대기 상태(pending_renewal)로 전환한다.
// bank_transfer_requests에 request_type='renewal' 신청을 새로 만들어 어제 만든
// 신규가입 승인 인프라(관리자 페이지, 승인/거절 API)를 그대로 재사용한다.

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { PLAN_AMOUNTS } from '@/lib/payment-constants';
import { computeDepositorName, buildRenewalReminderEmailHtml, sendBankTransferEmail } from '@/lib/bank-transfer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NOTICE_DAYS_BEFORE = 3;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDateOnly(d: Date): Date {
  const shifted = new Date(d.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/bank-transfer-renewal-notice] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/bank-transfer-renewal-notice] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // KST 기준 "3일 후" 하루 전체 범위 — next_billed_at의 시각(time-of-day)은
  // 최초 승인 시점에 따라 들쭉날쭉하므로 날짜 단위로 매칭한다.
  const todayKst = kstDateOnly(new Date());
  const targetStart = new Date(todayKst.getTime() + NOTICE_DAYS_BEFORE * 24 * 60 * 60 * 1000 - KST_OFFSET_MS);
  const targetEnd = new Date(targetStart.getTime() + 24 * 60 * 60 * 1000);

  const { data: dueUsers, error } = await adminClient
    .from('users')
    .select('id, email, plan, next_billed_at, depositor_real_name')
    .eq('subscription_status', 'active')
    .eq('payment_method', 'BANK_TRANSFER')
    .gte('next_billed_at', targetStart.toISOString())
    .lt('next_billed_at', targetEnd.toISOString());

  if (error) {
    console.error('[cron/bank-transfer-renewal-notice] 조회 실패:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let noticed = 0;
  let failed = 0;

  for (const u of dueUsers ?? []) {
    try {
      if (!u.email || !u.next_billed_at) { failed++; continue; }

      // 이번 구독의 결제 주기(연간/월간)는 users 테이블에 없어 최근 승인 이력에서 가져온다
      const { data: lastApproved } = await adminClient
        .from('bank_transfer_requests')
        .select('is_annual')
        .eq('user_id', u.id)
        .eq('status', 'approved')
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const plan = (u.plan === 'pro' ? 'pro' : 'basic') as 'basic' | 'pro';
      const isAnnual = lastApproved?.is_annual ?? false;
      const amount = isAnnual ? PLAN_AMOUNTS[plan].annual : PLAN_AMOUNTS[plan].monthly;
      const depositorName = computeDepositorName(u.email);

      // 갱신 신청은 화면 없이 여기서 바로 생성되므로, 최초 가입 시 입력받아 users에
      // 영구 저장해둔 예금주 실명을 그대로 재사용한다(마이페이지에서 수정 가능). 아직
      // 한 번도 입력한 적 없는 유저(이 기능 이전 가입자)는 null — 자동 매칭 로직이
      // null을 만나면 안전하게 manual_review로 넘긴다.
      const { error: insertError } = await adminClient.from('bank_transfer_requests').insert({
        user_id:             u.id,
        plan,
        is_annual:           isAnnual,
        amount,
        depositor_name:      depositorName,
        depositor_real_name: u.depositor_real_name,
        request_type:        'renewal',
      });
      if (insertError) {
        console.error(`[cron/bank-transfer-renewal-notice] 신청 생성 실패 (${u.email}):`, insertError);
        failed++;
        continue;
      }

      const { error: statusError } = await adminClient
        .from('users')
        .update({ subscription_status: 'pending_renewal' })
        .eq('id', u.id);
      if (statusError) {
        console.error(`[cron/bank-transfer-renewal-notice] 상태 변경 실패 (${u.email}):`, statusError);
      }

      const dueDateStr = new Date(u.next_billed_at).toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
      });

      await sendBankTransferEmail({
        to:      u.email,
        subject: `[fpark] ${dueDateStr} 결제 예정 — 계좌이체 갱신 안내`,
        html:    buildRenewalReminderEmailHtml({ planName: PLAN_AMOUNTS[plan].name, amount, depositorName, dueDateStr }),
        logTag:  'cron/bank-transfer-renewal-notice',
      });

      noticed++;
    } catch (e) {
      console.error(`[cron/bank-transfer-renewal-notice] 처리 중 예외 (${u.email}):`, e);
      failed++;
    }
  }

  console.log(`[cron/bank-transfer-renewal-notice] 완료 — 대상:${dueUsers?.length ?? 0} 안내:${noticed} 실패:${failed}`);
  return NextResponse.json({ ok: true, targetCount: dueUsers?.length ?? 0, noticed, failed });
}
