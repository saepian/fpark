// 관리자용 — 계좌이체(무통장입금) 신청 승인/거절/재활성화
// action='approve': 대기중(pending) 신청 승인 — request_type이 'new'면 최초 구독 시작,
//   'renewal'이면 기존 next_billed_at을 기준으로 다음 주기 연장(구독 시작일은 불변).
// action='reject': 대기중 신청 거절 — 유저 구독 상태는 건드리지 않음(만료는 별도 크론이 처리).
// action='reactivate': 만료(expired)된 신청을 관리자가 뒤늦게 되살릴 때 — 오늘부터 새 주기.
//
// 주의: 크레딧 시스템(stock_credits/portfolio_credits, lib/credits.ts)과는 완전히 별개 —
// 이 라우트는 credits 컬럼을 전혀 건드리지 않는다.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-auth';
import { PLAN_AMOUNTS } from '@/lib/payment-constants';
import { computeNextBilledAt, buildApprovalEmailHtml, sendBankTransferEmail } from '@/lib/bank-transfer';
import type { Database } from '@/lib/database.types';

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.then(s => s.getAll()),
        setAll: (pairs) => cookieStore.then(s => {
          pairs.forEach(({ name, value, options }) => s.set(name, value, options));
        }),
      },
    },
  );
}

type Action = 'approve' | 'reject' | 'reactivate';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { action } = await request.json() as { action?: Action };
  if (action !== 'approve' && action !== 'reject' && action !== 'reactivate') {
    return NextResponse.json({ error: '잘못된 action' }, { status: 400 });
  }

  const { data: reqRow, error: fetchError } = await adminClient
    .from('bank_transfer_requests')
    .select('id, user_id, plan, is_annual, amount, status, request_type')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !reqRow) {
    return NextResponse.json({ error: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });
  }

  if ((action === 'approve' || action === 'reject') && reqRow.status !== 'pending') {
    return NextResponse.json({ error: `이미 처리된 신청입니다 (상태: ${reqRow.status})` }, { status: 409 });
  }
  if (action === 'reactivate' && reqRow.status !== 'expired') {
    return NextResponse.json({ error: `만료된 신청만 재활성화할 수 있습니다 (상태: ${reqRow.status})` }, { status: 409 });
  }

  if (action === 'reject') {
    const { error } = await adminClient
      .from('bank_transfer_requests')
      .update({ status: 'rejected', processed_at: new Date().toISOString(), processed_by: user.email })
      .eq('id', id);
    if (error) {
      console.error('[admin/bank-transfers] 거절 처리 실패:', error);
      return NextResponse.json({ error: '처리 실패' }, { status: 500 });
    }
    console.log(`[admin/bank-transfers] 거절 — requestId:${id} by:${user.email}`);
    return NextResponse.json({ ok: true, status: 'rejected' });
  }

  // ── 승인 / 재활성화 ─────────────────────────────────────────────────────
  const plan = reqRow.plan as 'basic' | 'pro';

  const { data: existingUserRow } = await adminClient
    .from('users')
    .select('subscription_start_date, next_billed_at, email')
    .eq('id', reqRow.user_id)
    .maybeSingle();

  let nextBilledAt: Date;
  if (action === 'reactivate') {
    // 뒤늦은 재활성화 — 오늘부터 새 주기 시작
    nextBilledAt = computeNextBilledAt(new Date(), reqRow.is_annual);
  } else if (reqRow.request_type === 'renewal' && existingUserRow?.next_billed_at) {
    // 갱신 승인 — 기존 결제 예정일을 기준으로 다음 주기 연장(청구 기준일 유지)
    nextBilledAt = computeNextBilledAt(new Date(existingUserRow.next_billed_at), reqRow.is_annual);
  } else {
    // 신규가입 승인
    nextBilledAt = computeNextBilledAt(new Date(), reqRow.is_annual);
  }

  // subscription_start_date는 최초 구독 시점(또는 만료 후 재활성화 시점)에만 고정 —
  // 갱신 승인에서는 절대 건드리지 않는다(월간 사용량 한도 계산의 청구 기준일이기 때문).
  const shouldSetStartDate = !existingUserRow?.subscription_start_date;

  const { error: updateError } = await adminClient.from('users').update({
    plan,
    subscription_plan:   plan,
    subscription_status: 'active',
    payment_method:      'BANK_TRANSFER',
    next_billed_at:      nextBilledAt.toISOString(),
    ...(shouldSetStartDate ? { subscription_start_date: new Date().toISOString() } : {}),
  }).eq('id', reqRow.user_id);

  if (updateError) {
    console.error('[admin/bank-transfers] users 업데이트 실패:', updateError);
    return NextResponse.json({ error: '구독 활성화 실패' }, { status: 500 });
  }

  const { error: statusError } = await adminClient
    .from('bank_transfer_requests')
    .update({ status: 'approved', processed_at: new Date().toISOString(), processed_by: user.email })
    .eq('id', id);
  if (statusError) {
    console.error('[admin/bank-transfers] 상태 업데이트 실패(구독은 이미 활성화됨):', statusError);
    // 유저 플랜은 이미 활성화됐으므로 에러를 반환하지 않고 로그만 남김
  }

  // 승인 확인 이메일 (실패해도 승인 자체는 유지 — 이메일은 부가 기능)
  const email = existingUserRow?.email;
  if (email) {
    await sendBankTransferEmail({
      to:      email,
      subject: '[fpark] 입금 확인 완료 — 구독이 활성화되었습니다',
      html:    buildApprovalEmailHtml(PLAN_AMOUNTS[plan].name),
      logTag:  'admin/bank-transfers',
    });
  }

  console.log(`[admin/bank-transfers] ${action} — requestId:${id} userId:${reqRow.user_id} plan:${plan} type:${reqRow.request_type} by:${user.email}`);
  return NextResponse.json({ ok: true, status: 'approved' });
}
