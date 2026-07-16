// 결제수단과 무관한 users 구독 활성화 쓰기 — lib/bank-transfer-approval.ts의
// approveBankTransferRequest()와 lib/dodo-payment-approval.ts의 activateDodoPayment()가
// 공유한다. 두 곳이 각자 users.update()를 들고 있으면 한쪽만 고치고 다른 쪽을 놓치는
// 사고가 나기 쉬워서 이 쓰기 자체를 여기 하나로 모았다.

import { adminClient } from '@/lib/supabase-admin';

export interface ActivateSubscriptionParams {
  userId:        string;
  plan:          'basic' | 'pro';
  isAnnual:      boolean;
  paymentMethod: string; // 'BANK_TRANSFER' | 'DODO'
  nextBilledAt:  Date;
  // subscription_start_date는 최초 구독 시점(또는 만료 후 재활성화/업그레이드 시점)에만
  // 고정한다 — 갱신에서는 절대 건드리지 않는다(월간 사용량 한도 계산의 청구 기준일이기
  // 때문). 이 값을 새로 세팅할지는 호출부가 자신의 request_type/재활성화 여부를 보고 판단.
  setStartDate:  boolean;
}

export interface ActivateSubscriptionResult {
  ok:     boolean;
  error?: string;
}

export async function activateSubscription(params: ActivateSubscriptionParams): Promise<ActivateSubscriptionResult> {
  const { userId, plan, isAnnual, paymentMethod, nextBilledAt, setStartDate } = params;

  const { error } = await adminClient.from('users').update({
    plan,
    subscription_plan:   plan,
    subscription_status: 'active',
    payment_method:      paymentMethod,
    next_billed_at:      nextBilledAt.toISOString(),
    is_annual:           isAnnual,
    ...(setStartDate ? { subscription_start_date: new Date().toISOString() } : {}),
  }).eq('id', userId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
