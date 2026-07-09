// Basic → Pro 업그레이드 시 기존 플랜 잔여 기간을 크레딧으로 차감한 실제 청구액 계산.
// lib/refund.ts(취소/환불)와 의도적으로 분리 — calculateRefund()는 "7일 초과 시 환불
// 대상 아님" 같은 전자상거래법 기준 취소 정책이 섞여 있어 업그레이드 크레딧 용도로
// 그대로 재사용하면 7일 지난 유저의 잔여 기간이 0으로 잘못 계산된다. 여기는 순수하게
// "남은 일수 비례"만 본다 — 이용실적 비율 같은 하이브리드 로직 없음.
//
// 스코프: 월간결제끼리의 업그레이드만 다룬다(연간이 하나라도 끼면 호출부에서 이 함수를
// 아예 쓰지 않고 정가로 폴백— 연간은 "정가 소급 재계산" 모델이 완전히 달라 별도 설계 필요).

const CREDIT_DENOMINATOR_DAYS = 30;

export interface UpgradeCreditResult {
  remainingDays: number; // 0~30으로 clamp — 이미 지났으면 0, 30일 초과분은 한 달치로 cap
  creditRatio:   number; // remainingDays / 30
  creditAmount:  number; // round(currentPlanMonthly * creditRatio)
}

export function calculateUpgradeCredit(params: {
  currentPlanMonthly: number;
  nextBilledAt:       Date;
  now:                Date;
}): UpgradeCreditResult {
  const { currentPlanMonthly, nextBilledAt, now } = params;
  const rawDays        = Math.floor((nextBilledAt.getTime() - now.getTime()) / 86_400_000);
  const remainingDays  = Math.max(0, Math.min(CREDIT_DENOMINATOR_DAYS, rawDays));
  const creditRatio    = remainingDays / CREDIT_DENOMINATOR_DAYS;
  const creditAmount   = Math.round(currentPlanMonthly * creditRatio);
  return { remainingDays, creditRatio, creditAmount };
}

export interface UpgradeChargeResult {
  credit:       UpgradeCreditResult;
  chargeAmount: number; // max(0, targetPlanMonthly - credit.creditAmount)
}

export function calculateUpgradeChargeAmount(params: {
  currentPlanMonthly: number;
  targetPlanMonthly:  number;
  nextBilledAt:       Date;
  now:                Date;
}): UpgradeChargeResult {
  const credit = calculateUpgradeCredit(params);
  const chargeAmount = Math.max(0, params.targetPlanMonthly - credit.creditAmount);
  return { credit, chargeAmount };
}
