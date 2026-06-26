import { NextResponse } from 'next/server';

export async function GET() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.NAVER_CLIENT_ID!,
    redirect_uri: process.env.NAVER_REDIRECT_URI!,
    state: Math.random().toString(36).substring(7),
  });
  return NextResponse.redirect(
    `https://nid.naver.com/oauth2.0/authorize?${params}`
  );
}
