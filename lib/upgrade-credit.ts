// Basic → Pro 업그레이드 시 기존 플랜 잔여 기간을 크레딧으로 차감한 실제 청구액 계산.
//
// 크레딧은 두 값 중 작은 쪽이다:
//   1) 날짜비례 크레딧 — 순수하게 "남은 일수 / 30"만 보는 값(이용실적 무관)
//   2) 환불 상한 — 지금 이 순간 구독을 취소했다면 lib/refund.ts(calculateRefund)가
//      돌려줄 실제 환불액
// (2)를 상한으로 씌우는 이유(2026-07-09 확정): "지금 그만두면 얼마 돌려받는지"와
// "업그레이드하면 얼마 인정받는지"가 서로 다른 기준이면 안 된다는 원칙 — 이미 쓴
// 만큼은 업그레이드에서도 크레딧으로 인정하지 않는다. 참고로 calculateRefund()의
// "7일 초과 시 환불 대상 아님(환불액 0)" 정책도 그대로 상한에 반영되므로, 결제일로부터
// 7일이 지난 뒤에 업그레이드하면 크레딧이 0원이 되어 정가 그대로 청구된다 — 이 역시
// "지금 취소해도 한 푼도 못 돌려받는 시점이면 업그레이드도 마찬가지"라는 같은 원칙의
// 자연스러운 결과다.
//
// 스코프: 월간결제끼리의 업그레이드만 다룬다(연간이 하나라도 끼면 호출부에서 이 함수를
// 아예 쓰지 않고 정가로 폴백— 연간은 "정가 소급 재계산" 모델이 완전히 달라 별도 설계 필요).

import { calculateRefund } from '@/lib/refund';

const CREDIT_DENOMINATOR_DAYS = 30;

export interface UpgradeCreditResult {
  remainingDays:       number;  // 0~30으로 clamp — 이미 지났으면 0, 30일 초과분은 한 달치로 cap
  creditRatio:         number;  // remainingDays / 30
  proratedCredit:      number;  // round(currentPlanMonthly * creditRatio) — 상한 적용 전 값
  refundCap:           number;  // 지금 취소했다면 돌려받을 실제 환불액(calculateRefund) — 상한
  creditAmount:        number;  // min(proratedCredit, refundCap) — 실제 적용되는 최종 크레딧
  cappedByRefund:      boolean; // refundCap이 proratedCredit보다 작아서 상한이 실제로 걸렸는지
  refundWindowExpired: boolean; // calculateRefund()의 7일 환불 기한이 지나 refundCap이
                                 // 강제로 0이 된 상태인지 — 화면에서 "왜 크레딧이 0인지"
                                 // 안내 문구를 붙일지 판단하는 데 씀
}

export function calculateUpgradeCredit(params: {
  currentPlanMonthly:    number;
  nextBilledAt:          Date;
  now:                   Date;
  subscriptionStartDate: Date;
  currentPlan:           'basic' | 'pro';
  diagnosisCount:        number;
  portfolioCount:        number;
}): UpgradeCreditResult {
  const {
    currentPlanMonthly, nextBilledAt, now,
    subscriptionStartDate, currentPlan, diagnosisCount, portfolioCount,
  } = params;

  const rawDays        = Math.floor((nextBilledAt.getTime() - now.getTime()) / 86_400_000);
  const remainingDays  = Math.max(0, Math.min(CREDIT_DENOMINATOR_DAYS, rawDays));
  const creditRatio    = remainingDays / CREDIT_DENOMINATOR_DAYS;
  const proratedCredit = Math.round(currentPlanMonthly * creditRatio);

  const refundCalc = calculateRefund({
    paidAmount: currentPlanMonthly,
    subscriptionStartDate,
    cancelAt: now,
    plan: currentPlan,
    diagnosisCount,
    portfolioCount,
  });
  const refundCap = refundCalc.refundAmount;

  const creditAmount = Math.min(proratedCredit, refundCap);

  return {
    remainingDays,
    creditRatio,
    proratedCredit,
    refundCap,
    creditAmount,
    cappedByRefund: refundCap < proratedCredit,
    refundWindowExpired: !refundCalc.refundEligible,
  };
}

export interface UpgradeChargeResult {
  credit:       UpgradeCreditResult;
  chargeAmount: number; // max(0, targetPlanMonthly - credit.creditAmount)
}

export function calculateUpgradeChargeAmount(params: {
  currentPlanMonthly:    number;
  targetPlanMonthly:     number;
  nextBilledAt:          Date;
  now:                   Date;
  subscriptionStartDate: Date;
  currentPlan:           'basic' | 'pro';
  diagnosisCount:        number;
  portfolioCount:        number;
}): UpgradeChargeResult {
  const credit = calculateUpgradeCredit(params);
  const chargeAmount = Math.max(0, params.targetPlanMonthly - credit.creditAmount);
  return { credit, chargeAmount };
}
