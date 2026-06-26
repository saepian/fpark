import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  console.log('[auth/callback] 진입, code:', code ? '있음' : '없음');
  console.log('[auth/callback] 전체 URL:', request.url);

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
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? origin;
      return NextResponse.redirect(`${siteUrl}/?error=auth_failed`);
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? origin;
  console.log('[auth/callback] 리다이렉트:', `${siteUrl}/`);
  return NextResponse.redirect(`${siteUrl}/`);
}
