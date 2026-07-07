import { adminClient } from '@/lib/supabase-admin';

// PG/MoR 확정 전이라 이 파일은 "결제 완료 이벤트를 받으면 크레딧을 더해준다"는
// 개념만 담당하고 특정 결제대행사를 전혀 알지 못한다. 나중에 PG가 정해지면
// app/api/webhooks/<pg-name>/route.ts가 결제 검증 후 grantCredits()만 호출하면
// 되도록 설계 — 이 파일은 그때도 수정할 필요가 없어야 한다.

export type CreditType = 'stock' | 'portfolio';

export type GrantResult =
  | { success: true; remaining: number }
  | { success: false; error: string };

export type DeductResult =
  | { success: true; remaining: number }
  | { success: false; reason: 'insufficient' | 'error'; error?: string };

/**
 * 크레딧 충전 — 결제 완료 이벤트(어떤 PG의 웹훅이든)를 받으면 이 함수만 호출한다.
 * add_credit RPC로 원자적으로 증가시키므로 웹훅 재전송(at-least-once)이 겹쳐도
 * 그만큼 여러 번 호출되면 각각 반영된다 — 웹훅 자체의 중복 호출 방지(idempotency
 * key 체크 등)는 호출하는 쪽(웹훅 핸들러)의 책임이며 이 함수의 책임이 아니다.
 */
export async function grantCredits(
  userId: string,
  type: CreditType,
  amount: number,
): Promise<GrantResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { success: false, error: `invalid amount: ${amount}` };
  }

  const { data, error } = await adminClient.rpc('add_credit', {
    p_user_id: userId,
    p_credit_type: type,
    p_amount: amount,
  });

  if (error) {
    console.error('[CREDITS] grantCredits 실패:', { userId, type, amount, error: error.message });
    return { success: false, error: error.message };
  }

  return { success: true, remaining: data as number };
}

/**
 * 크레딧 차감 — deduct_credit RPC(UPDATE ... WHERE credits > 0 RETURNING)로
 * 원자적으로 수행해 동시 요청 레이스 컨디션을 방지한다. 기존 코드처럼
 * "SELECT로 읽고 JS에서 -1 계산 후 UPDATE"하지 않으므로 이중 사용이 불가능하다.
 * remaining이 null이면 크레딧이 0 이하라 차감이 거부된 것 — 호출부는 이 경우
 * 반드시 사용을 거부해야 한다(이미 DB에서 차감을 막았으므로 추가 확인 불필요).
 */
export async function deductCredit(
  userId: string,
  type: CreditType,
): Promise<DeductResult> {
  const { data, error } = await adminClient.rpc('deduct_credit', {
    p_user_id: userId,
    p_credit_type: type,
  });

  if (error) {
    console.error('[CREDITS] deductCredit 실패:', { userId, type, error: error.message });
    return { success: false, reason: 'error', error: error.message };
  }

  if (data === null) {
    return { success: false, reason: 'insufficient' };
  }

  return { success: true, remaining: data as number };
}
