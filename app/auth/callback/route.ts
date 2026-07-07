import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';
import { sanitizeRedirect } from '@/lib/auth-redirect';
import { adminClient } from '@/lib/supabase-admin';
import { sendBankTransferEmail } from '@/lib/bank-transfer';
import { buildWelcomeEmailHtml } from '@/lib/account-emails';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = sanitizeRedirect(searchParams.get('next'));

  // netlify.app 도메인으로 온 경우 fpark.com으로 리다이렉트
  if (request.url.includes('netlify.app') && code) {
    const fwdNext = next !== '/' ? `&next=${encodeURIComponent(next)}` : '';
    return NextResponse.redirect(`https://fpark.com/auth/callback?code=${code}${fwdNext}`);
  }

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options),
              );
            } catch {}
          },
        },
      },
    );
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(`https://fpark.com/?error=auth_failed`);
    }

    // 신규 유저(약관 미동의)는 원래 목적지로 바로 보내지 않고 동의 페이지를 먼저 거치게 한다.
    // 기존 가입자는 terms_agreed_at이 이미 채워져 있으므로 바로 next로 이동.
    const userId = data.user?.id;
    if (userId) {
      const { data: userRow } = await adminClient
        .from('users')
        .select('terms_agreed_at, welcome_email_sent_at, email')
        .eq('id', userId)
        .maybeSingle();

      // 이메일 인증 완료(이메일 가입) 또는 최초 로그인(구글)의 첫 콜백 진입 시점에 1회만 환영 메일 발송.
      if (userRow && !userRow.welcome_email_sent_at) {
        await adminClient
          .from('users')
          .update({ welcome_email_sent_at: new Date().toISOString() })
          .eq('id', userId);

        const to = userRow.email ?? data.user?.email ?? null;
        if (to) {
          const name = (data.user?.user_metadata?.name as string | undefined) ?? null;
          await sendBankTransferEmail({
            to,
            subject: 'Finance Park 가입을 환영합니다 🎉',
            html: buildWelcomeEmailHtml(name),
            logTag: 'WELCOME_EMAIL',
          });
        }
      }

      if (!userRow?.terms_agreed_at) {
        return NextResponse.redirect(
          `https://fpark.com/auth/agree-terms?next=${encodeURIComponent(next)}`,
        );
      }
    }

    return NextResponse.redirect(`https://fpark.com${next}`);
  }

  return NextResponse.redirect(`https://fpark.com/`);
}
