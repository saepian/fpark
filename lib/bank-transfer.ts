// 계좌이체(무통장입금) 신규가입/갱신 공용 헬퍼 — 신규가입 승인 라우트, 갱신 안내/만료
// 크론이 전부 이 파일을 통해서만 입금자명 계산, 이메일 발송, 다음 결제일 계산을 한다.
// PG를 전혀 모르는 계층이라 나중에 PG가 바뀌어도 이 파일은 손댈 필요가 없어야 한다.

import { Resend } from 'resend';
import { BANK_TRANSFER_ACCOUNT } from '@/lib/payment-constants';

// 가입 시와 동일한 규칙 — 이메일 아이디 부분을 입금자명으로 사용
export function computeDepositorName(email: string | null | undefined): string {
  return (email ?? '').split('@')[0] || 'user';
}

export function computeNextBilledAt(from: Date, isAnnual: boolean): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + (isAnnual ? 12 : 1));
  return next;
}

export function emailShell(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finance Park</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:40px 20px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:800;color:#818cf8">Finance Park</div>
    </div>
    ${bodyHtml}
    <p style="text-align:center;color:#334155;font-size:11px;margin-top:24px">Finance Park · saepian2@gmail.com</p>
  </div>
</body>
</html>`;
}

export function buildApprovalEmailHtml(planName: string, paymentMethod: 'BANK_TRANSFER' | 'DODO' = 'BANK_TRANSFER'): string {
  const headline = paymentMethod === 'DODO' ? '카드 결제가 확인되었습니다' : '입금 확인이 완료되었습니다';
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">✅</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">${headline}</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">
        ${planName} 구독이 정상적으로 활성화되었습니다.<br />
        지금 바로 fpark.com에서 이용해보세요.
      </p>
      <a href="https://fpark.com" style="display:inline-block;margin-top:20px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#fff;text-decoration:none;padding:11px 26px;border-radius:10px;font-size:13.5px;font-weight:600">
        fpark.com 바로가기 →
      </a>
    </div>`);
}

export function buildRenewalReminderEmailHtml(params: {
  planName: string; amount: number; depositorRealName: string | null; dueDateStr: string;
}): string {
  const { planName, amount, depositorRealName, dueDateStr } = params;
  const depositorRow = depositorRealName
    ? `<div style="display:flex;justify-content:space-between;padding:6px 0;color:#fbbf24;font-size:14px">
         <span>예금주명</span><span style="font-weight:800">${depositorRealName}</span>
       </div>`
    : `<div style="padding:6px 0;color:#fbbf24;font-size:12.5px;line-height:1.6">
         예금주명이 등록되어 있지 않아 자동 확인이 어렵습니다. 입금 후 관리자가 직접 확인해드리니
         조금 더 걸릴 수 있어요 — 마이페이지에서 예금주명을 등록해두시면 다음 결제부터 자동으로 처리됩니다.
       </div>`;
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px">
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700;text-align:center">다음 결제일이 다가옵니다</p>
      <p style="margin:0 0 20px;color:#94a3b8;font-size:13px;text-align:center">
        ${planName} 구독 갱신을 위해 아래 계좌로 입금해주세요.
      </p>
      <div style="background:#161b2b;border:1px solid #2d3348;border-radius:10px;padding:16px 18px">
        <div style="display:flex;justify-content:space-between;padding:6px 0;color:#cbd5e1;font-size:13px">
          <span style="color:#64748b">결제 예정일</span><span style="font-weight:700">${dueDateStr}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;color:#cbd5e1;font-size:13px">
          <span style="color:#64748b">입금 계좌</span><span style="font-weight:700">${BANK_TRANSFER_ACCOUNT.bankName} ${BANK_TRANSFER_ACCOUNT.accountNumber}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;color:#cbd5e1;font-size:13px">
          <span style="color:#64748b">입금 금액</span><span style="font-weight:700">${amount.toLocaleString()}원</span>
        </div>
        ${depositorRow}
      </div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;line-height:1.7;text-align:center">
        입금이 확인되면 최대 30분 이내 자동으로 갱신됩니다. 예금주명·금액이 정확히 일치해야
        자동 처리되며, 확인이 어려운 경우 관리자가 직접 확인 후 처리해드립니다(영업일 기준 1일 이내).
      </p>
      <p style="margin:12px 0 0;color:#f87171;font-size:12px;line-height:1.7;text-align:center">
        결제 예정일까지 입금이 확인되지 않으면 구독이 만료되어 Basic/Pro 기능 이용이 제한됩니다.
        그레이스 기간(유예) 없이 당일 마감 기준으로 처리되니 미리 입금해주세요.
      </p>
    </div>`);
}

export function buildExpiredEmailHtml(planName: string): string {
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">⏰</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">구독이 만료되었습니다</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">
        결제 기한 내 입금이 확인되지 않아 ${planName} 구독이 만료되어<br />
        서비스 이용이 제한됩니다. 재구독을 원하시면 요금제 페이지에서<br />
        다시 계좌이체를 신청해주세요.
      </p>
      <a href="https://fpark.com/pricing" style="display:inline-block;margin-top:20px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#fff;text-decoration:none;padding:11px 26px;border-radius:10px;font-size:13.5px;font-weight:600">
        재구독하러 가기 →
      </a>
    </div>`);
}

export async function sendBankTransferEmail(params: {
  to: string; subject: string; html: string; logTag: string;
}): Promise<boolean> {
  const { to, subject, html, logTag } = params;
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[${logTag}] RESEND_API_KEY 미설정 — 이메일 발송 생략`);
    return false;
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Finance Park <noreply@fpark.com>',
      to:   [to],
      subject,
      html,
    });
    console.log(`[${logTag}] 이메일 발송 완료: ${to}`);
    return true;
  } catch (e) {
    console.error(`[${logTag}] 이메일 발송 실패:`, e instanceof Error ? e.message : e);
    return false;
  }
}
