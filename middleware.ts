import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/database.types';

export async function middleware(request: NextRequest) {
  // OAuth 콜백(?code=)은 app/page.tsx가 /auth/callback으로 리다이렉트하는 흐름을 타야 하므로 그대로 통과
  if (request.nextUrl.searchParams.has('code')) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // 비로그인 방문자 — URL은 "/" 그대로 두고 콘텐츠만 /ai-portfolio 랜딩페이지로 rewrite
  // (redirect를 쓰면 광고에 fpark.com 루트로 걸린 링크가 /ai-portfolio로 바뀌어 보이므로 rewrite 사용)
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/ai-portfolio';
    return NextResponse.rewrite(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/'],
};
