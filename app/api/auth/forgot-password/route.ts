import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';

type GoTrueIdentity = { provider: string; id: string };
type GoTrueUser = {
  id: string;
  email?: string;
  identities?: GoTrueIdentity[];
  user_metadata?: Record<string, string>;
};

export async function POST(request: NextRequest) {
  let email: string;
  try {
    const body = await request.json();
    email = (body.email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  // 유저 조회 (listUsers는 소규모 프로젝트에서 충분히 실용적)
  const { data, error: listError } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listError) {
    console.error('[forgot-password] listUsers error:', listError);
    // 조회 실패해도 보안상 sent처럼 처리
    return NextResponse.json({ status: 'sent' });
  }

  const user = (data.users as GoTrueUser[]).find(
    (u) => u.email?.toLowerCase() === email
  );

  if (!user) {
    // 존재하지 않는 이메일 — 보안상 sent로 처리 (계정 존재 여부 노출 방지)
    return NextResponse.json({ status: 'sent' });
  }

  const identities = user.identities ?? [];
  const metadata   = user.user_metadata ?? {};

  // 네이버 커스텀 OAuth: admin.createUser로 생성, user_metadata.provider = 'naver'
  if (metadata.provider === 'naver') {
    return NextResponse.json({ status: 'oauth', provider: 'naver' });
  }

  // 구글 OAuth: identities에 google provider 존재 + email identity 없음
  const hasGoogle = identities.some((i) => i.provider === 'google');
  const hasEmail  = identities.some((i) => i.provider === 'email');
  if (hasGoogle && !hasEmail) {
    return NextResponse.json({ status: 'oauth', provider: 'google' });
  }

  // 이메일/비밀번호 계정 → 재설정 링크 발송
  const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://fpark.com/auth/callback?next=/auth/reset-password',
  });

  if (resetError) {
    console.error('[forgot-password] resetPasswordForEmail error:', resetError);
    return NextResponse.json({ error: resetError.message }, { status: 500 });
  }

  return NextResponse.json({ status: 'sent' });
}
