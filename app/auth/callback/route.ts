import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  console.log('[auth/callback] 진입, code:', code ? '있음' : '없음');
  console.log('[auth/callback] 전체 URL:', request.url);

  // netlify.app 도메인으로 온 경우 fpark.com으로 리다이렉트
  if (request.url.includes('netlify.app') && code) {
    console.log('[auth/callback] netlify.app 도메인 감지, fpark.com으로 리다이렉트');
    return NextResponse.redirect(`https://fpark.com/auth/callback?code=${code}`);
  }

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
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
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    console.log('[auth/callback] exchangeCodeForSession 결과:', error ? error.message : '성공');

    if (error) {
      return NextResponse.redirect(`https://fpark.com/?error=auth_failed`);
    }
  }

  return NextResponse.redirect(`https://fpark.com/`);
}
