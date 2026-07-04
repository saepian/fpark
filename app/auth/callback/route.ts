import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';
import { sanitizeRedirect } from '@/lib/auth-redirect';

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
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(`https://fpark.com/?error=auth_failed`);
    }

    return NextResponse.redirect(`https://fpark.com${next}`);
  }

  return NextResponse.redirect(`https://fpark.com/`);
}
