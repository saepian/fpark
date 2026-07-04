import { NextRequest, NextResponse } from 'next/server';
import { sanitizeRedirect } from '@/lib/auth-redirect';

// state 파라미터에 로그인 후 돌아갈 경로를 실어 보낸다 — 네이버가 콜백 시 그대로 echo.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const redirectTo = sanitizeRedirect(searchParams.get('redirect'));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.NAVER_CLIENT_ID!,
    redirect_uri: process.env.NAVER_REDIRECT_URI!,
    state: redirectTo,
  });
  return NextResponse.redirect(
    `https://nid.naver.com/oauth2.0/authorize?${params}`
  );
}
