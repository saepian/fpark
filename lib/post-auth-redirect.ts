// 로그인/이메일 인증이 성공적으로 완료된 직후 공통으로 처리해야 할 것들:
// 1) 최초 1회 환영 메일 발송(welcome_email_sent_at 마커)
// 2) 약관 미동의 유저는 next로 바로 보내지 않고 동의 페이지를 먼저 거치게 함
// /auth/callback(OAuth, PKCE)과 /auth/confirm(이메일 인증/매직링크, token_hash) 양쪽에서
// 동일하게 호출한다 — 두 라우트에 각각 복제해두면 한쪽만 고치는 실수가 나기 쉽다.
//
// 웰컴 페이지(/welcome)는 더 이상 여기서 강제 리다이렉트하지 않는다 — 가입 직후
// 뜨는 관심기업 등록 모달에 보조 링크로만 노출한다(선택적 진입).

import { adminClient } from '@/lib/supabase-admin';
import { sendBankTransferEmail } from '@/lib/bank-transfer';
import { buildWelcomeEmailHtml } from '@/lib/account-emails';

export async function resolvePostAuthRedirect(
  userId: string,
  next: string,
  fallback?: { email?: string | null; name?: string | null },
): Promise<string> {
  const { data: userRow } = await adminClient
    .from('users')
    .select('terms_agreed_at, welcome_email_sent_at, email')
    .eq('id', userId)
    .maybeSingle();

  if (userRow && !userRow.welcome_email_sent_at) {
    await adminClient
      .from('users')
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq('id', userId);

    const to = userRow.email ?? fallback?.email ?? null;
    if (to) {
      await sendBankTransferEmail({
        to,
        subject: 'Finance Park 가입을 환영합니다 🎉',
        html: buildWelcomeEmailHtml(fallback?.name ?? null),
        logTag: 'WELCOME_EMAIL',
      });
    }
  }

  if (!userRow?.terms_agreed_at) {
    return `/auth/agree-terms?next=${encodeURIComponent(next)}`;
  }

  return next;
}
