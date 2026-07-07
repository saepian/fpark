// 구독 취소/환불 계산 — 계좌이체 특성상 자동 송금이 불가능해 계산까지만 자동화하고
// 실제 송금은 관리자가 /admin/payments "환불 대기" 탭에서 수동으로 처리한다.
// 환불정책(app/refund/page.tsx) 제6조와 정확히 일치해야 하는 규칙:
//   - 결제일로부터 7일 이내 + 미사용: 전액환불
//   - 7일 이내 + 사용함: 결제금액 - (결제금액 × 경과일수/30)
//   - 7일 초과: 환불 없음, 해지예약(다음 결제일부터 서비스 중단)

const REFUND_WINDOW_DAYS = 7;
const PRORATION_DENOMINATOR_DAYS = 30;

export interface RefundCalcResult {
  elapsedDays:     number;
  refundEligible:  boolean; // true면 즉시 해지(cancelled), false면 해지예약(pending_cancellation)
  refundAmount:    number;
  reasonText:      string;
}

export function calculateRefund(params: {
  paidAmount:             number;
  subscriptionStartDate:  Date;
  cancelAt:               Date;
  usageDetected:          boolean;
}): RefundCalcResult {
  const { paidAmount, subscriptionStartDate, cancelAt, usageDetected } = params;
  const elapsedDays = Math.floor((cancelAt.getTime() - subscriptionStartDate.getTime()) / 86_400_000);

  if (elapsedDays > REFUND_WINDOW_DAYS) {
    return {
      elapsedDays,
      refundEligible: false,
      refundAmount:   0,
      reasonText:     `결제일로부터 ${elapsedDays}일 경과 — 환불 대상 아님(7일 초과). 다음 결제일부터 구독이 중단됩니다.`,
    };
  }

  if (!usageDetected) {
    return {
      elapsedDays,
      refundEligible: true,
      refundAmount:   paidAmount,
      reasonText:     `미사용 · 결제일로부터 ${elapsedDays}일 경과 · 전액환불 ${paidAmount.toLocaleString()}원`,
    };
  }

  const deduction    = Math.round(paidAmount * (elapsedDays / PRORATION_DENOMINATOR_DAYS));
  const refundAmount = Math.max(0, paidAmount - deduction);
  return {
    elapsedDays,
    refundEligible: true,
    refundAmount,
    reasonText: `사용함 · 결제일로부터 ${elapsedDays}일 경과 · 일할차감 ${deduction.toLocaleString()}원 · 환불액 ${refundAmount.toLocaleString()}원`,
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
