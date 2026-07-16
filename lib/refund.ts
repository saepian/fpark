// 구독 취소/환불 계산 — 계좌이체 특성상 자동 송금이 불가능해 계산까지만 자동화하고
// 실제 송금은 관리자가 /admin/payments "환불 대기" 탭에서 수동으로 처리한다.
// 월간결제(calculateRefund)와 연간결제(calculateAnnualRefund)는 계산 방식 자체가 달라
// 완전히 별도 함수로 분리한다 — 연간은 "약정 할인 소급 취소" 개념이라 일할/이용량 비례가 아니라
// 정가 개월수 환산으로 계산해야 하기 때문(2026-07-08).
//
// ── 월간결제 (calculateRefund) — 환불정책(app/refund/page.tsx) 제6조 ──
//   - 결제일로부터 7일 초과: 환불 없음, 해지예약(다음 결제일부터 서비스 중단) — 하드 컷오프.
//   - 7일 이내: 하이브리드 방식 — "경과일수 비율"과 "실제 이용량 비율" 중 더 큰 쪽으로 차감
//     (결제 당일 한도를 다 쓰고 바로 취소해도 경과일수가 0이라는 이유로 전액환불되는 허점을 막기 위함)
//     - 경과일수비율 = elapsedDays / 30
//     - 기업분석/포트폴리오/종목분석비율 = 각 콘텐츠 건수 / 플랜별 월간 이용 한도(계산은
//       calculateUsageRatio 참고) — 2026-07-14 요금제 재구성 이전엔 기업분석이 일일 한도라
//       ×30을 곱했으나, 월간 전환 이후로는 나머지 콘텐츠와 동일하게 한도 그대로가 분모
//     - 포트폴리오비율만 예외: 0건 0% · 1건 20%(정상 체험 취급, 계단식) · 2건 이상 건수/월간한도
//     - 이용량비율 = max(기업분석비율, 포트폴리오비율, 종목분석비율), 최종차감비율 =
//       max(경과일수비율, 이용량비율), 각각 100% cap
//     - calculateUsageRatio는 lib/upgrade-credit.ts의 업그레이드 크레딧 상한 계산에서도
//       재사용된다 — 단, 거기서는 이 함수의 "7일 쿨링오프" 게이트를 적용하지 않는다(그
//       게이트는 최초 가입 청약철회 정책이라 매달 반복 적용되면 안 됨).

import { PLAN_USAGE_LIMITS, PLAN_AMOUNTS } from '@/lib/payment-constants';

const REFUND_WINDOW_DAYS = 7;
const PRORATION_DENOMINATOR_DAYS = 30;
export const SINGLE_PORTFOLIO_USE_RATIO = 0.2;

export interface UsageRatioResult {
  diagnosisLimit:     number; // 월간 한도(플랜별) — 화면에 "n/한도" 형태로 보여줄 때 사용
  diagnosisRatio:     number;
  portfolioLimit:     number; // 월간 한도(플랜별)
  portfolioRatio:     number;
  stockAnalysisLimit: number; // 월간 한도(플랜별)
  stockAnalysisRatio: number;
  usageRatio:         number; // 세 비율 중 최댓값, 100% cap
}

// 세 콘텐츠(기업분석/포트폴리오/종목분석) 이용 건수를 플랜별 월간 한도 대비 비율로
// 환산 — calculateRefund와 lib/upgrade-credit.ts가 공유하는 순수 계산 로직.
export function calculateUsageRatio(params: {
  plan:               'basic' | 'pro';
  diagnosisCount:     number;
  portfolioCount:     number;
  stockAnalysisCount: number;
}): UsageRatioResult {
  const { plan, diagnosisCount, portfolioCount, stockAnalysisCount } = params;
  const limits = PLAN_USAGE_LIMITS[plan];

  const diagnosisRatio = limits.diagnosis > 0 ? diagnosisCount / limits.diagnosis : 0;
  const portfolioRatio =
    portfolioCount <= 0 ? 0
    : portfolioCount === 1 ? SINGLE_PORTFOLIO_USE_RATIO
    : (limits.portfolio > 0 ? portfolioCount / limits.portfolio : 1);
  const stockAnalysisRatio = limits.stockAnalysis > 0 ? stockAnalysisCount / limits.stockAnalysis : 0;
  const usageRatio = Math.min(1, Math.max(diagnosisRatio, portfolioRatio, stockAnalysisRatio));

  return {
    diagnosisLimit: limits.diagnosis, diagnosisRatio,
    portfolioLimit: limits.portfolio, portfolioRatio,
    stockAnalysisLimit: limits.stockAnalysis, stockAnalysisRatio,
    usageRatio,
  };
}

export interface RefundCalcResult {
  paidAmount:         number;
  elapsedDays:        number;
  elapsedRatio:       number;
  diagnosisCount:     number;
  diagnosisLimit:     number;
  diagnosisRatio:     number;
  portfolioCount:     number;
  portfolioLimit:     number;
  portfolioRatio:     number;
  stockAnalysisCount: number;
  stockAnalysisLimit: number;
  stockAnalysisRatio: number;
  usageRatio:         number;
  finalRatio:         number;
  usageDetected:      boolean;
  // 최종 차감 비율(finalRatio)이 이용실적/경과일 중 어느 쪽에서 왔는지 — 화면에 "OO 기준이
  // 더 커서 적용됨" 문구를 정확히 붙이기 위함. 둘 다 0%면 'none'(차감 없음, 전액환불).
  decidingFactor:  'usage' | 'elapsed' | 'none';
  deductionAmount: number; // paidAmount - refundAmount (계산 과정 화면에 그대로 노출)
  refundEligible:  boolean; // true면 즉시 해지(cancelled), false면 해지예약(pending_cancellation)
  refundAmount:    number;
  reasonText:      string;
}

export function calculateRefund(params: {
  paidAmount:             number;
  subscriptionStartDate:  Date;
  cancelAt:               Date;
  plan:                   'basic' | 'pro';
  diagnosisCount:         number;
  portfolioCount:         number;
  stockAnalysisCount:     number;
}): RefundCalcResult {
  const { paidAmount, subscriptionStartDate, cancelAt, plan, diagnosisCount, portfolioCount, stockAnalysisCount } = params;
  const elapsedDays    = Math.floor((cancelAt.getTime() - subscriptionStartDate.getTime()) / 86_400_000);
  const usageDetected  = diagnosisCount + portfolioCount + stockAnalysisCount > 0;

  const elapsedRatio = elapsedDays / PRORATION_DENOMINATOR_DAYS;
  const {
    diagnosisLimit, diagnosisRatio,
    portfolioLimit, portfolioRatio,
    stockAnalysisLimit, stockAnalysisRatio,
    usageRatio,
  } = calculateUsageRatio({ plan, diagnosisCount, portfolioCount, stockAnalysisCount });

  if (elapsedDays > REFUND_WINDOW_DAYS) {
    return {
      paidAmount, elapsedDays, elapsedRatio,
      diagnosisCount, diagnosisLimit, diagnosisRatio,
      portfolioCount, portfolioLimit, portfolioRatio,
      stockAnalysisCount, stockAnalysisLimit, stockAnalysisRatio,
      usageRatio, finalRatio: 0, usageDetected,
      decidingFactor:  'none',
      deductionAmount: 0,
      refundEligible: false,
      refundAmount:   0,
      reasonText:     `결제일로부터 ${elapsedDays}일 경과 — 환불 대상 아님(7일 초과). 다음 결제일부터 구독이 중단됩니다.`,
    };
  }

  const finalRatio   = Math.min(1, Math.max(elapsedRatio, usageRatio));
  const deduction    = Math.round(paidAmount * finalRatio);
  const refundAmount = Math.max(0, paidAmount - deduction);
  const decidingFactor: 'usage' | 'elapsed' | 'none' =
    finalRatio === 0 ? 'none' : usageRatio >= elapsedRatio ? 'usage' : 'elapsed';

  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  const reasonText =
    `월간결제 · 경과 ${elapsedDays}일(${pct(elapsedRatio)}) · ` +
    `기업분석 ${diagnosisCount}/${diagnosisLimit}(${pct(diagnosisRatio)}) · ` +
    `포트폴리오 ${portfolioCount}/${portfolioLimit}(${pct(portfolioRatio)}) · ` +
    `종목분석 ${stockAnalysisCount}/${stockAnalysisLimit}(${pct(stockAnalysisRatio)}) · ` +
    `최종차감 ${pct(finalRatio)}`;

  return {
    paidAmount, elapsedDays, elapsedRatio,
    diagnosisCount, diagnosisLimit, diagnosisRatio,
    portfolioCount, portfolioLimit, portfolioRatio,
    stockAnalysisCount, stockAnalysisLimit, stockAnalysisRatio,
    usageRatio, finalRatio, usageDetected,
    decidingFactor,
    deductionAmount: deduction,
    refundEligible: true,
    refundAmount,
    reasonText,
  };
}

// ── 연간결제 (calculateAnnualRefund) — "약정 할인 소급 취소" 방식 ──────────────
// 연간결제는 20% 할인을 조건으로 한 약정이므로, 중도 해지 시 그 할인을 소급 취소하고
// 정가(월간 요금) 기준으로 실제 사용한 개월 수만큼만 청구한 뒤 나머지를 환불한다.
// 월간결제처럼 경과일수/이용량 "비율"로 계산하지 않는다 — 순수 개월수(정가 환산) 기준.
//   1) 예외: 7일 이내 + 완전 미사용(진단 0건, 포트폴리오 0건, 종목분석 0건) → 전액환불
//      (전자상거래법 기준 절대 예외, 월간결제와 동일하게 유지)
//   2) 그 외(7일 이내라도 사용했거나, 7일 초과): 해지예약 없이 즉시 해지 + 아래 공식으로 환불
//      - monthsUsed = max(1, ceil(경과일수 / 30)), 최대 12개월로 cap
//      - retroactiveCost = monthsUsed × 플랜 정가 월요금(PLAN_AMOUNTS[plan].monthly)
//      - refundAmount = max(0, 결제금액 - retroactiveCost)
//   연간결제는 "7일 초과 시 환불 불가·해지예약" 규칙을 적용하지 않는다 — 언제든 취소 가능.

const ANNUAL_MAX_MONTHS_CHARGED = 12;

export interface AnnualRefundCalcResult {
  paidAmount:        number;
  elapsedDays:       number;
  monthsUsed:        number;
  monthlyFullPrice:  number; // 플랜 정가 월요금(PLAN_AMOUNTS[plan].monthly) — 소급 계산의 단가
  retroactiveCost:   number;
  diagnosisCount:    number;
  portfolioCount:    number;
  stockAnalysisCount: number;
  usageDetected:     boolean;
  fullRefundException: boolean; // true면 "7일 이내 미사용 전액환불" 예외로 처리된 것
  refundEligible:    boolean; // 연간은 항상 true — 해지예약 없이 즉시 해지
  refundAmount:      number;
  reasonText:        string;
}

export function calculateAnnualRefund(params: {
  paidAmount:             number;
  subscriptionStartDate:  Date;
  cancelAt:               Date;
  plan:                   'basic' | 'pro';
  diagnosisCount:         number;
  portfolioCount:         number;
  stockAnalysisCount:     number;
}): AnnualRefundCalcResult {
  const { paidAmount, subscriptionStartDate, cancelAt, plan, diagnosisCount, portfolioCount, stockAnalysisCount } = params;
  const elapsedDays   = Math.floor((cancelAt.getTime() - subscriptionStartDate.getTime()) / 86_400_000);
  const usageDetected = diagnosisCount + portfolioCount + stockAnalysisCount > 0;

  const monthlyFullPrice = PLAN_AMOUNTS[plan].monthly;

  // 7일 이내 + 완전 미사용 → 전액환불 (전자상거래법 기준 예외, 그대로 유지)
  if (elapsedDays <= REFUND_WINDOW_DAYS && !usageDetected) {
    return {
      paidAmount, elapsedDays, monthsUsed: 0, monthlyFullPrice, retroactiveCost: 0,
      diagnosisCount, portfolioCount, stockAnalysisCount, usageDetected,
      fullRefundException: true,
      refundEligible: true,
      refundAmount:   paidAmount,
      reasonText:     `연간결제 · 결제일로부터 ${elapsedDays}일 경과, 미사용 — 전액환불(7일 이내 미사용 예외)`,
    };
  }

  const monthsUsed       = Math.min(ANNUAL_MAX_MONTHS_CHARGED, Math.max(1, Math.ceil(elapsedDays / PRORATION_DENOMINATOR_DAYS)));
  const retroactiveCost  = monthsUsed * monthlyFullPrice;
  const refundAmount     = Math.max(0, paidAmount - retroactiveCost);

  const reasonText =
    `연간결제(약정 할인 소급 취소) · 경과 ${elapsedDays}일 → ${monthsUsed}개월 사용 (정가 환산) · ` +
    `정가 ${monthlyFullPrice.toLocaleString()}원 × ${monthsUsed}개월 = ${retroactiveCost.toLocaleString()}원 차감`;

  return {
    paidAmount, elapsedDays, monthsUsed, monthlyFullPrice, retroactiveCost,
    diagnosisCount, portfolioCount, stockAnalysisCount, usageDetected,
    fullRefundException: false,
    refundEligible: true, // 연간은 7일 초과해도 해지예약 없이 즉시 해지
    refundAmount,
    reasonText,
  };
}

// ── 이메일 ──────────────────────────────────────────────────────────────────

import { emailShell } from '@/lib/bank-transfer';

export function buildRefundRequestAdminEmailHtml(params: {
  userEmail: string; refundAmount: number; reasonText: string;
  bank: string; accountNumber: string; accountHolder: string;
}): string {
  const { userEmail, refundAmount, reasonText, bank, accountNumber, accountHolder } = params;
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px">
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700;text-align:center">환불 요청이 접수되었습니다</p>
      <p style="margin:0 0 20px;color:#94a3b8;font-size:13px;text-align:center">/admin/payments 환불 대기 탭에서 처리해주세요.</p>
      <div style="background:#161b2b;border:1px solid #2d3348;border-radius:10px;padding:16px 18px">
        <div style="display:flex;justify-content:space-between;padding:6px 0;color:#cbd5e1;font-size:13px">
          <span style="color:#64748b">신청 계정</span><span style="font-weight:700">${userEmail}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;color:#fbbf24;font-size:14px">
          <span>환불 예정액</span><span style="font-weight:800">${refundAmount.toLocaleString()}원</span>
        </div>
        <div style="padding:6px 0;color:#cbd5e1;font-size:12.5px">
          <span style="color:#64748b">계산 근거</span><br />${reasonText}
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;color:#cbd5e1;font-size:13px">
          <span style="color:#64748b">입금 계좌</span><span style="font-weight:700">${bank} ${accountNumber} (${accountHolder})</span>
        </div>
      </div>
    </div>`);
}

// paymentMethod 인자는 선택값이고 기본값이 기존 계좌이체 문구라 기존 호출부(인자 없이
// 호출)는 동작이 완전히 그대로다 — Dodo 호출부만 'DODO'를 넘겨 문구를 바꾼다.
export function buildRefundCompletedEmailHtml(refundAmount: number, paymentMethod: 'BANK_TRANSFER' | 'DODO' = 'BANK_TRANSFER'): string {
  const bodyHtml = paymentMethod === 'DODO'
    ? `신청하신 환불금 ${refundAmount.toLocaleString()}원이 결제하신 카드로 환불되었습니다.<br />
       카드사 정책에 따라 실제 반영까지 며칠 걸릴 수 있습니다.`
    : `신청하신 환불금 ${refundAmount.toLocaleString()}원이 안내주신 계좌로 송금되었습니다.<br />
       입금까지 은행 사정에 따라 다소 시간이 걸릴 수 있습니다.`;
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">💸</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">환불이 완료되었습니다</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">${bodyHtml}</p>
    </div>`);
}

// ── 유저용 취소 확인 메일 (취소 접수 시점, 관리자 알림과 별도로 발송) ────────────

export function buildCancelRefundRequestedEmailHtml(refundAmount: number, paymentMethod: 'BANK_TRANSFER' | 'DODO' = 'BANK_TRANSFER'): string {
  const refundMethodText = paymentMethod === 'DODO' ? '결제하신 카드로 자동 환불됩니다' : '안내주신 계좌로 입금됩니다';
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">✅</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">구독이 취소되었습니다</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">
        환불 예정 금액 <strong style="color:#fbbf24">${refundAmount.toLocaleString()}원</strong>이 계산되어<br />
        확인 후 처리될 예정입니다. 환불 승인 후 영업일 기준 3~7일 이내<br />
        ${refundMethodText}.
      </p>
    </div>`);
}

export function buildCancelReservedEmailHtml(nextBilledAtStr: string): string {
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">📅</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">구독 취소가 접수되었습니다</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">
        현재 결제 기간(<strong style="color:#e2e8f0">${nextBilledAtStr}</strong>)까지는 계속 이용하실 수 있으며,<br />
        이후 자동으로 무료 플랜으로 전환되어 별도로 결제되지 않습니다.
      </p>
    </div>`);
}
