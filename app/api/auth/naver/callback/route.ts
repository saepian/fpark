import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';
import { sanitizeRedirect } from '@/lib/auth-redirect';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code) {
    return NextResponse.redirect('https://fpark.com/?error=auth_failed');
  }

  // 로그인 CSRF 방어 — /api/auth/naver가 심어둔 nonce 쿠키와 state가 일치해야만 진행한다
  // (일치하지 않으면 이 브라우저가 시작한 로그인이 아니라는 뜻이므로 즉시 차단, 네이버
  // 토큰 교환 호출 자체를 하지 않는다). 쿠키가 만료/유실된 정상 케이스(다른 탭에서 다시
  // 시도 등)도 여기로 들어오므로 에러 문구는 "실패"로만 안내하고 서버 로그에 원인을 남긴다.
  const cookieStore = await cookies();
  const expectedState = cookieStore.get('naver_oauth_state')?.value;
  const redirectTo = sanitizeRedirect(cookieStore.get('naver_oauth_redirect')?.value);
  if (!state || !expectedState || state !== expectedState) {
    console.error('[NAVER_CALLBACK] state 불일치 — CSRF 의심 또는 쿠키 만료:', { hasState: !!state, hasExpected: !!expectedState });
    return NextResponse.redirect('https://fpark.com/?error=auth_failed');
  }

  // 네이버 액세스 토큰 받기
  const tokenRes = await fetch('https://nid.naver.com/oauth2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.NAVER_CLIENT_ID!,
      client_secret: process.env.NAVER_CLIENT_SECRET!,
      code,
      state,
    }),
  });
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    return NextResponse.redirect('https://fpark.com/?error=auth_failed');
  }

  // 네이버 사용자 정보 받기
  const userRes = await fetch('https://openapi.naver.com/v1/nid/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData = await userRes.json();
  const naverUser = userData.response;

  // Supabase에 유저 생성/로그인 — cookieStore는 위에서 이미 받아뒀다(state 검증에 재사용).
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  // 이메일로 기존 유저 확인
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = (existingUsers?.users ?? []).find(
    (u: { email?: string }) => u.email === naverUser.email
  );

  if (!existingUser) {
    // 새 유저 생성
    const { data: newUser, error } = await supabase.auth.admin.createUser({
      email: naverUser.email,
      email_confirm: true,
      user_metadata: {
        full_name: naverUser.name || naverUser.nickname,
        avatar_url: naverUser.profile_image,
        provider: 'naver',
      },
    });
    if (error || !newUser.user) {
      return NextResponse.redirect('https://fpark.com/?error=auth_failed');
    }
  }

  // 약관 동의 체크 + 환영 메일 발송은 /auth/confirm에서 공용 헬퍼(resolvePostAuthRedirect)로
  // 일괄 처리한다 — 여기서 redirectTo를 그대로 next로 넘기기만 하면 된다.

  // 세션 링크 생성
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: naverUser.email,
  });

  if (linkError || !linkData) {
    console.log('generateLink 에러:', linkError);
    return NextResponse.redirect('https://fpark.com/?error=auth_failed');
  }

  console.log('linkData.properties:', JSON.stringify(linkData.properties));

  const hashed_token = linkData.properties.hashed_token;

  const response = NextResponse.redirect(
    `https://fpark.com/auth/confirm?token_hash=${hashed_token}&type=magiclink&next=${encodeURIComponent(redirectTo)}`
  );
  response.cookies.delete('naver_oauth_state');
  response.cookies.delete('naver_oauth_redirect');
  return response;
}
