// 유저가 실제로 낸 결제 금액에서 "가입 당시 정가"를 구하는 헬퍼.
// 2026-07-23 가격 인상 대응 — Dodo는 Product 가격을 바꿔도 기존 활성 구독은 가입 당시
// 가격을 그대로 유지한다(Change Plan API를 별도 호출해야 이관됨). 그래서 환불 소급계산·
// 업그레이드 크레딧·mypage 표시는 라이브 PLAN_AMOUNTS가 아니라 이 유저가 실제로 낸 금액을
// 기준으로 계산해야 가격 인상 후에도 기존 구독자에게 정확하다.
import { adminClient } from '@/lib/supabase-admin';
import { ANNUAL_DISCOUNT_RATE } from '@/lib/payment-constants';

export interface LastActualPayment {
  amount: number;
  isAnnual: boolean;
}

// 결제수단(계좌이체/Dodo)에 따라 기록 테이블이 다르므로 둘 다 조회해 실제 값이 있는
// 쪽을 채택한다 — 한 유저는 한 가지 결제수단만 쓰므로 최대 한쪽에서만 값이 나온다.
export async function getLastActualPayment(userId: string): Promise<LastActualPayment | null> {
  const [{ data: lastApproved }, { data: lastDodoPayment }] = await Promise.all([
    adminClient
      .from('bank_transfer_requests')
      .select('amount, is_annual')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .order('processed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('payments')
      .select('amount, is_annual')
      .eq('user_id', userId)
      .eq('payment_method', 'DODO')
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (lastApproved) return { amount: lastApproved.amount, isAnnual: lastApproved.is_annual };
  if (lastDodoPayment) return { amount: lastDodoPayment.amount, isAnnual: lastDodoPayment.is_annual };
  return null;
}

// 실 결제액 → 가입 당시 "정가 월요금" 역산. 월간 결제자는 결제액이 곧 정가이고,
// 연간 결제자는 20% 약정 할인을 역산해서 구한다(lib/refund.ts의 연간 소급계산과 동일 공식).
export function deriveMonthlyPriceFromPayment(amount: number, isAnnual: boolean): number {
  return isAnnual ? Math.round(amount / (12 * (1 - ANNUAL_DISCOUNT_RATE))) : amount;
}
