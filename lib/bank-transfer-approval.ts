// 계좌이체 신청 승인 처리 — 관리자 수동 승인(app/api/admin/bank-transfers/[id]/route.ts)과
// 자동 매칭 승인(app/api/cron/bank-transfer-auto-match, lib/codef-payment-matching.ts)이
// 반드시 이 함수 하나만 통해서 구독을 활성화한다. 두 경로가 각자 구현을 들고 있으면 한쪽만
// 고치고 다른 쪽을 놓치는 사고가 나기 쉬워서 승인 로직 자체를 여기 하나로 모았다.
//
// lib/bank-transfer.ts는 PG를 모르는 순수 헬퍼 계층으로 유지하고, DB 쓰기가 있는 이 함수는
// 별도 파일로 분리했다.

import { adminClient } from '@/lib/supabase-admin';
import { PLAN_AMOUNTS } from '@/lib/payment-constants';
import { computeNextBilledAt, buildApprovalEmailHtml, sendBankTransferEmail } from '@/lib/bank-transfer';

export type BankTransferApprovalAction = 'approve' | 'reactivate';

// 판별 유니온(discriminated union) 대신 flat 형태로 둔다 — 이 프로젝트 tsconfig는
// strict:false라 `{ok:true}|{ok:false,...}` 형태의 유니온은 `if (!result.ok)` /
// `if (result.ok) {} else {}` 양쪽 다 좁혀지지(narrowing) 않는 문제가 있었음(직접 확인).
export interface BankTransferApprovalResult {
  ok:      boolean;
  error?:  string;
  status?: number;
}

export async function approveBankTransferRequest(
  requestId:   string,
  action:      BankTransferApprovalAction,
  processedBy: string,
): Promise<BankTransferApprovalResult> {
  const { data: reqRow, error: fetchError } = await adminClient
    .from('bank_transfer_requests')
    .select('id, user_id, plan, is_annual, amount, status, request_type')
    .eq('id', requestId)
    .maybeSingle();

  if (fetchError || !reqRow) {
    return { ok: false, error: '신청 내역을 찾을 수 없습니다.', status: 404 };
  }
  if (action === 'approve' && reqRow.status !== 'pending') {
    return { ok: false, error: `이미 처리된 신청입니다 (상태: ${reqRow.status})`, status: 409 };
  }
  if (action === 'reactivate' && reqRow.status !== 'expired') {
    return { ok: false, error: `만료된 신청만 재활성화할 수 있습니다 (상태: ${reqRow.status})`, status: 409 };
  }

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
    is_annual:           reqRow.is_annual,
    ...(shouldSetStartDate ? { subscription_start_date: new Date().toISOString() } : {}),
  }).eq('id', reqRow.user_id);

  if (updateError) {
    console.error('[bank-transfer-approval] users 업데이트 실패:', updateError);
    return { ok: false, error: '구독 활성화 실패', status: 500 };
  }

  const { error: statusError } = await adminClient
    .from('bank_transfer_requests')
    .update({ status: 'approved', processed_at: new Date().toISOString(), processed_by: processedBy })
    .eq('id', requestId);
  if (statusError) {
    console.error('[bank-transfer-approval] 상태 업데이트 실패(구독은 이미 활성화됨):', statusError);
    // 유저 플랜은 이미 활성화됐으므로 에러를 반환하지 않고 로그만 남김
  }

  // 승인 확인 이메일 (실패해도 승인 자체는 유지 — 이메일은 부가 기능)
  const email = existingUserRow?.email;
  if (email) {
    await sendBankTransferEmail({
      to:      email,
      subject: '[fpark] 입금 확인 완료 — 구독이 활성화되었습니다',
      html:    buildApprovalEmailHtml(PLAN_AMOUNTS[plan].name),
      logTag:  'bank-transfer-approval',
    });
  }

  console.log(
    `[bank-transfer-approval] ${action} — requestId:${requestId} userId:${reqRow.user_id} ` +
    `plan:${plan} type:${reqRow.request_type} by:${processedBy}`,
  );
  return { ok: true };
}
