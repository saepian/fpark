import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';
import { sanitizeRedirect } from '@/lib/auth-redirect';
import { resolvePostAuthRedirect } from '@/lib/post-auth-redirect';

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

    // 신규 유저(약관 미동의)는 원래 목적지로 바로 보내지 않고 동의 페이지를 먼저 거치게 하고,
    // 최초 로그인(구글)이면 환영 메일도 함께 처리한다.
    const userId = data.user?.id;
    if (userId) {
      const finalNext = await resolvePostAuthRedirect(userId, next, {
        email: data.user?.email,
        name: (data.user?.user_metadata?.name as string | undefined) ?? null,
      });
      return NextResponse.redirect(`https://fpark.com${finalNext}`);
    }

    return NextResponse.redirect(`https://fpark.com${next}`);
  }

  return NextResponse.redirect(`https://fpark.com/`);
}
