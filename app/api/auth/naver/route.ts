import { NextRequest, NextResponse } from 'next/server';
import { sanitizeRedirect } from '@/lib/auth-redirect';

// 2026-08-31 QA에서 발견: state 파라미터에 로그인 후 돌아갈 경로만 실어 보내고 있었다 —
// 이 브라우저가 실제로 이 로그인을 시작했는지 검증하는 CSRF 방어 용도로는 전혀 안 쓰이던
// 것. 공격자가 자기 네이버 계정으로 미리 받아둔 code를 피해자 브라우저에서
// /api/auth/naver/callback?code=<공격자 code>로 열게 하면, 피해자가 공격자의
// fpark.com 계정으로 로그인되는 로그인 CSRF가 성립한다(state가 리다이렉트 경로 문자열일
// 뿐이라 아무 값이나 넣어도 콜백이 그대로 신뢰). 무작위 nonce를 httpOnly 쿠키에 심고
// state로도 함께 보내, 콜백에서 두 값이 일치하는 요청만(=이 브라우저가 실제로 시작한
// 로그인만) 처리하도록 수정 — redirect 목적지는 별도 쿠키로 분리해서 나른다.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const redirectTo = sanitizeRedirect(searchParams.get('redirect'));
  const csrfState = crypto.randomUUID();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.NAVER_CLIENT_ID!,
    redirect_uri: process.env.NAVER_REDIRECT_URI!,
    state: csrfState,
  });
  const response = NextResponse.redirect(
    `https://nid.naver.com/oauth2.0/authorize?${params}`
  );
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/' };
  response.cookies.set('naver_oauth_state', csrfState, cookieOpts);
  response.cookies.set('naver_oauth_redirect', redirectTo, cookieOpts);
  return response;
}
