// Dodo 결제 완료 웹훅 → 구독 활성화. app/api/webhooks/dodo/route.ts에서만 호출한다.
//
// payments.payment_id는 체크아웃 라우트(3단계)가 세션 생성 직후 session_id를 임시로
// 넣어둔 것 — 여기서 실제 payment_id로 덮어쓴다. 웹훅 바디를 그대로 신뢰하지 않고
// getSubscription()으로 재조회해 next_billing_date를 가져온다(lib/portone.ts의
// getPayment() 재조회 컨벤션과 동일).

import { adminClient } from '@/lib/supabase-admin';
import { activateSubscription } from '@/lib/subscription-activation';
import { getSubscription } from '@/lib/dodo';

export interface ActivateDodoPaymentParams {
  sessionId:      string;         // payments.payment_id 자리에 임시로 들어있던 값
  paymentId:      string;         // Dodo의 실제 payment_id
  subscriptionId: string | null;
}

export interface ActivateDodoPaymentResult {
  ok:      boolean;
  error?:  string;
  skipped?: boolean; // 이미 처리된 이벤트(웹훅 재시도) — 정상 케이스
}

export async function activateDodoPayment(params: ActivateDodoPaymentParams): Promise<ActivateDodoPaymentResult> {
  const { sessionId, paymentId, subscriptionId } = params;

  const { data: pending, error: fetchError } = await adminClient
    .from('payments')
    .select('id, user_id, plan, is_annual, status')
    .eq('payment_id', sessionId)
    .eq('payment_method', 'DODO')
    .maybeSingle();

  if (fetchError || !pending) {
    return { ok: false, error: `pending 레코드를 찾을 수 없음 (sessionId:${sessionId})` };
  }
  if (pending.status !== 'pending') {
    // 웹훅 재시도 — 이미 처리됨. idempotent skip.
    return { ok: true, skipped: true };
  }

  const plan = pending.plan as 'basic' | 'pro';

  let nextBilledAt: Date;
  if (subscriptionId) {
    const subscription = await getSubscription(subscriptionId);
    nextBilledAt = new Date(subscription.next_billing_date);
  } else {
    // 구독형 상품이라 항상 subscription_id가 있어야 하지만, 방어적으로 폴백.
    nextBilledAt = new Date();
    nextBilledAt.setMonth(nextBilledAt.getMonth() + (pending.is_annual ? 12 : 1));
  }

  const { data: userRow } = await adminClient
    .from('users')
    .select('subscription_start_date')
    .eq('id', pending.user_id)
    .maybeSingle();

  const activation = await activateSubscription({
    userId:        pending.user_id,
    plan,
    isAnnual:      pending.is_annual,
    paymentMethod: 'DODO',
    nextBilledAt,
    setStartDate:  !userRow?.subscription_start_date,
  });

  if (!activation.ok) {
    return { ok: false, error: activation.error };
  }

  if (subscriptionId) {
    const { error: subIdError } = await adminClient
      .from('users')
      .update({ dodo_subscription_id: subscriptionId })
      .eq('id', pending.user_id);
    if (subIdError) {
      console.error('[dodo-payment-approval] dodo_subscription_id 저장 실패(구독은 이미 활성화됨):', subIdError);
    }
  }

  const { error: paymentsUpdateError } = await adminClient
    .from('payments')
    .update({ payment_id: paymentId, status: 'completed' })
    .eq('id', pending.id);
  if (paymentsUpdateError) {
    console.error('[dodo-payment-approval] payments 업데이트 실패(구독은 이미 활성화됨):', paymentsUpdateError);
  }

  console.log(
    `[dodo-payment-approval] 활성화 완료 — userId:${pending.user_id} plan:${plan} ` +
    `paymentId:${paymentId} subscriptionId:${subscriptionId}`,
  );
  return { ok: true };
}
