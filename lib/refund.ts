// 구독 취소/환불 계산 — 계좌이체 특성상 자동 송금이 불가능해 계산까지만 자동화하고
// 실제 송금은 관리자가 /admin/payments "환불 대기" 탭에서 수동으로 처리한다.
// 환불정책(app/refund/page.tsx) 제6조와 정확히 일치해야 하는 규칙:
//   - 결제일로부터 7일 초과: 환불 없음, 해지예약(다음 결제일부터 서비스 중단) — 하드 컷오프, 변경 없음
//   - 7일 이내: 하이브리드 방식 — "경과일수 비율"과 "실제 이용량 비율" 중 더 큰 쪽으로 차감
//     (결제 당일 한도를 다 쓰고 바로 취소해도 경과일수가 0이라는 이유로 전액환불되는 허점을 막기 위함)
//     - 경과일수비율 = elapsedDays / 30
//     - 기업분석비율 = 결제일 이후 stock_diagnosis 건수 / (일일한도 × 30)
//     - 포트폴리오비율 = 0건 0% · 1건 20%(정상 체험 취급, 계단식) · 2건 이상 건수/월간한도
//     - 이용량비율 = max(기업분석비율, 포트폴리오비율), 최종차감비율 = max(경과일수비율, 이용량비율), 각각 100% cap

import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';

const REFUND_WINDOW_DAYS = 7;
const PRORATION_DENOMINATOR_DAYS = 30;
const SINGLE_PORTFOLIO_USE_RATIO = 0.2;

export interface RefundCalcResult {
  elapsedDays:     number;
  elapsedRatio:    number;
  diagnosisCount:  number;
  diagnosisRatio:  number;
  portfolioCount:  number;
  portfolioRatio:  number;
  usageRatio:      number;
  finalRatio:      number;
  usageDetected:   boolean;
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
}): RefundCalcResult {
  const { paidAmount, subscriptionStartDate, cancelAt, plan, diagnosisCount, portfolioCount } = params;
  const elapsedDays    = Math.floor((cancelAt.getTime() - subscriptionStartDate.getTime()) / 86_400_000);
  const usageDetected  = diagnosisCount + portfolioCount > 0;
  const limits         = PLAN_USAGE_LIMITS[plan];

  const elapsedRatio   = elapsedDays / PRORATION_DENOMINATOR_DAYS;
  const diagnosisDenom = limits.diagnosis * PRORATION_DENOMINATOR_DAYS;
  const diagnosisRatio = diagnosisDenom > 0 ? diagnosisCount / diagnosisDenom : 0;
  const portfolioRatio =
    portfolioCount <= 0 ? 0
    : portfolioCount === 1 ? SINGLE_PORTFOLIO_USE_RATIO
    : (limits.portfolio > 0 ? portfolioCount / limits.portfolio : 1);
  const usageRatio     = Math.min(1, Math.max(diagnosisRatio, portfolioRatio));

  if (elapsedDays > REFUND_WINDOW_DAYS) {
    return {
      elapsedDays, elapsedRatio, diagnosisCount, diagnosisRatio, portfolioCount, portfolioRatio,
      usageRatio, finalRatio: 0, usageDetected,
      refundEligible: false,
      refundAmount:   0,
      reasonText:     `결제일로부터 ${elapsedDays}일 경과 — 환불 대상 아님(7일 초과). 다음 결제일부터 구독이 중단됩니다.`,
    };
  }

  const finalRatio   = Math.min(1, Math.max(elapsedRatio, usageRatio));
  const deduction    = Math.round(paidAmount * finalRatio);
  const refundAmount = Math.max(0, paidAmount - deduction);

  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  const reasonText =
    `경과 ${elapsedDays}일(${pct(elapsedRatio)}) · ` +
    `기업분석 ${diagnosisCount}/${diagnosisDenom}(${pct(diagnosisRatio)}) · ` +
    `포트폴리오 ${portfolioCount}/${limits.portfolio}(${pct(portfolioRatio)}) · ` +
    `최종차감 ${pct(finalRatio)}`;

  return {
    elapsedDays, elapsedRatio, diagnosisCount, diagnosisRatio, portfolioCount, portfolioRatio,
    usageRatio, finalRatio, usageDetected,
    refundEligible: true,
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

export function buildRefundCompletedEmailHtml(refundAmount: number): string {
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">💸</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">환불이 완료되었습니다</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">
        신청하신 환불금 ${refundAmount.toLocaleString()}원이 안내주신 계좌로 송금되었습니다.<br />
        입금까지 은행 사정에 따라 다소 시간이 걸릴 수 있습니다.
      </p>
    </div>`);
}

// ── 유저용 취소 확인 메일 (취소 접수 시점, 관리자 알림과 별도로 발송) ────────────

export function buildCancelRefundRequestedEmailHtml(refundAmount: number): string {
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">✅</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">구독이 취소되었습니다</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">
        환불 예정 금액 <strong style="color:#fbbf24">${refundAmount.toLocaleString()}원</strong>이 계산되어<br />
        확인 후 처리될 예정입니다. 환불 승인 후 영업일 기준 3~7일 이내<br />
        안내주신 계좌로 입금됩니다.
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
