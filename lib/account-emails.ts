// 회원가입 완료(환영) / 탈퇴 완료(작별) 메일 — 라이프사이클 전용 헬퍼.
// 발송 자체는 lib/bank-transfer.ts의 sendBankTransferEmail(Resend 래퍼)을 그대로 재사용한다.

import { emailShell } from '@/lib/bank-transfer';

export function buildWelcomeEmailHtml(name: string | null): string {
  const greeting = name ? `${name}님, ` : '';
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">🎉</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">${greeting}Finance Park 가입을 환영합니다</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">
        기업 데이터를 더 스마트하게 분석할 수 있는<br />
        모든 준비가 끝났습니다. 지금 바로 시작해보세요.
      </p>
      <a href="https://fpark.com" style="display:inline-block;margin-top:20px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#fff;text-decoration:none;padding:11px 26px;border-radius:10px;font-size:13.5px;font-weight:600">
        fpark.com 바로가기 →
      </a>
    </div>`);
}

export function buildWithdrawalCompletedEmailHtml(hadActiveSubscription: boolean): string {
  return emailShell(`
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">👋</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">회원 탈퇴가 완료되었습니다</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">
        그동안 Finance Park를 이용해주셔서 감사합니다.<br />
        분석 내역, 관심기업 등 계정과 관련된 모든 데이터가<br />
        영구적으로 삭제되었습니다.
      </p>
      ${hadActiveSubscription ? `
      <p style="margin:16px 0 0;color:#fbbf24;font-size:12.5px;line-height:1.7">
        구독 환불 관련 문의는 saepian2@gmail.com으로 연락 주시면<br />
        환불 정책에 따라 안내해드리겠습니다.
      </p>` : ''}
    </div>`);
}
