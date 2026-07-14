// Basic → Pro 업그레이드 시 기존 플랜 잔여 기간을 크레딧으로 차감한 실제 청구액 계산.
//
// 크레딧은 두 값 중 작은 쪽이다:
//   1) 날짜비례 크레딧 — 순수하게 "남은 일수 / 30"만 보는 값(이용실적 무관)
//   2) 이용률 상한 — 이번 결제 사이클에 이미 쓴 만큼은 업그레이드 크레딧으로도 인정하지
//      않음(lib/refund.ts의 calculateUsageRatio 재사용 — 세 콘텐츠 중 가장 많이 쓴 비율)
//
// 2026-07-14 수정: 예전엔 (2)를 lib/refund.ts의 calculateRefund()에서 그대로 가져왔는데,
// calculateRefund의 "7일 초과 시 환불 대상 아님(환불 0원)" 게이트는 최초 가입 청약철회
// 쿨링오프 정책이라 매달 반복 적용되면 안 된다. subscription_start_date는 최초 가입(또는
// 재활성화/직전 업그레이드) 시점에만 고정되고 매달 갱신 때는 안 바뀌므로(lib/bank-transfer
// -approval.ts, app/api/payment/webhook/route.ts 확인), 예전 로직대로면 가입 7일이 지난
// 뒤 업그레이드하는 사실상 모든 구독자가 크레딧 0원을 받는 버그가 있었다. 이제는
// "청약철회 쿨링오프"(calculateRefund, 취소/환불 화면 전용)와 "이용률 상한"
// (calculateUsageRatio, 여기·calculateRefund 공용)을 분리해서, 업그레이드 크레딧은 순수
// 이용률만으로 상한을 건다 — 대신 diagnosisCount/portfolioCount/stockAnalysisCount는
// 반드시 "이번 결제 사이클(현재 cycle) 이용 건수"여야 한다(원 가입일 이후 평생 누적이
// 아님 — 호출부 app/api/payment/bank-transfer/request/route.ts에서 lib/plan.ts의
// getUsageCycleStart로 계산해서 넘긴다).
//
// 스코프: 월간결제끼리의 업그레이드만 다룬다(연간이 하나라도 끼면 호출부에서 이 함수를
// 아예 쓰지 않고 정가로 폴백— 연간은 "정가 소급 재계산" 모델이 완전히 달라 별도 설계 필요).

import { calculateUsageRatio } from '@/lib/refund';

const CREDIT_DENOMINATOR_DAYS = 30;

export interface UpgradeCreditResult {
  remainingDays:  number;  // 0~30으로 clamp — 이미 지났으면 0, 30일 초과분은 한 달치로 cap
  creditRatio:    number;  // remainingDays / 30
  proratedCredit: number;  // round(currentPlanMonthly * creditRatio) — 상한 적용 전 값
  usageRatio:     number;  // 이번 사이클 이용률(calculateUsageRatio) — 상한 계산 근거
  usageCap:       number;  // currentPlanMonthly * (1 - usageRatio) — 이용률 기반 상한
  creditAmount:   number;  // min(proratedCredit, usageCap) — 실제 적용되는 최종 크레딧
  cappedByUsage:  boolean; // usageCap이 proratedCredit보다 작아서 상한이 실제로 걸렸는지
}

export function calculateUpgradeCredit(params: {
  currentPlanMonthly: number;
  nextBilledAt:       Date;
  now:                Date;
  currentPlan:        'basic' | 'pro';
  diagnosisCount:     number; // 이번 결제 사이클 이용 건수
  portfolioCount:     number; // 이번 결제 사이클 이용 건수
  stockAnalysisCount: number; // 이번 결제 사이클 이용 건수
}): UpgradeCreditResult {
  const {
    currentPlanMonthly, nextBilledAt, now,
    currentPlan, diagnosisCount, portfolioCount, stockAnalysisCount,
  } = params;

  const rawDays        = Math.floor((nextBilledAt.getTime() - now.getTime()) / 86_400_000);
  const remainingDays  = Math.max(0, Math.min(CREDIT_DENOMINATOR_DAYS, rawDays));
  const creditRatio    = remainingDays / CREDIT_DENOMINATOR_DAYS;
  const proratedCredit = Math.round(currentPlanMonthly * creditRatio);

  const { usageRatio } = calculateUsageRatio({
    plan: currentPlan,
    diagnosisCount,
    portfolioCount,
    stockAnalysisCount,
  });
  const usageCap = Math.round(currentPlanMonthly * (1 - usageRatio));

  const creditAmount = Math.min(proratedCredit, usageCap);

  return {
    remainingDays,
    creditRatio,
    proratedCredit,
    usageRatio,
    usageCap,
    creditAmount,
    cappedByUsage: usageCap < proratedCredit,
  };
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
  currentPlan:        'basic' | 'pro';
  diagnosisCount:     number;
  portfolioCount:     number;
  stockAnalysisCount: number;
}): UpgradeChargeResult {
  const credit = calculateUpgradeCredit(params);
  const chargeAmount = Math.max(0, params.targetPlanMonthly - credit.creditAmount);
  return { credit, chargeAmount };
}
