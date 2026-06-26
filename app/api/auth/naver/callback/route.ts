import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
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
      state: searchParams.get('state') || '',
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

  // Supabase에 유저 생성/로그인
  const cookieStore = await cookies();
  const supabase = createServerClient(
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
  const existingUser = existingUsers?.users?.find(
    u => u.email === naverUser.email
  );

  let userId;
  if (existingUser) {
    userId = existingUser.id;
  } else {
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
    userId = newUser.user.id;
  }

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

  return NextResponse.redirect(
    `https://fpark.com/auth/confirm?token_hash=${hashed_token}&type=magiclink&next=/`
  );
}
