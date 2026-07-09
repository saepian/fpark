// 이메일 회원가입 서버 라우트. 클라이언트가 supabase.auth.signUp()을 직접 호출하던 걸
// 이 라우트로 옮긴 이유: Gmail은 로컬파트의 '.'과 '+alias'를 무시하고 전부 같은 받은편지함으로
// 배달하기 때문에(gusidy817@gmail.com == g.us.idu.y.8.1.7@gmail.com == gusidy817+1@gmail.com),
// 같은 사람이 "다른 계정처럼 보이는" 이메일로 여러 번 가입해 계정당 무료 크레딧 등을 반복
// 수령할 수 있다. 이메일 인증(Confirm email)은 타인/가짜 이메일 가입은 막아도 본인 소유
// 받은편지함의 dot/alias 변형까지는 막지 못하므로, gmail/googlemail 도메인에 한해 서버에서
// 정규화한 뒤 기존 가입자와 충돌하는지 사전 차단한다.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase-admin';
import type { Database } from '@/lib/database.types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function normalizeGmail(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split('@');
  return `${local.split('+')[0].replace(/\./g, '')}@${domain}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as
    | { email?: string; password?: string; name?: string; phone?: string | null }
    | null;

  const email = body?.email?.trim() ?? '';
  const password = body?.password ?? '';
  const name = body?.name?.trim() ?? '';
  const phone = body?.phone || null;

  if (!EMAIL_RE.test(email) || password.length < 8) {
    return NextResponse.json({ error: 'validation_error' }, { status: 400 });
  }

  const domain = email.toLowerCase().split('@')[1];
  if (GMAIL_DOMAINS.has(domain)) {
    const target = normalizeGmail(email);
    const { data: candidates, error: lookupError } = await adminClient
      .from('users')
      .select('email')
      .or('email.ilike.%@gmail.com,email.ilike.%@googlemail.com');

    if (lookupError) {
      console.error('[auth/signup] gmail 중복조회 실패:', lookupError);
      return NextResponse.json({ error: 'signup_failed' }, { status: 500 });
    }

    const collision = (candidates ?? []).some((u) => normalizeGmail(u.email) === target);
    if (collision) {
      return NextResponse.json({ error: 'duplicate_email' }, { status: 400 });
    }
  }

  const anon = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const agreedAt = new Date().toISOString();
  const { error } = await anon.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: 'https://fpark.com/auth/callback',
      data: {
        name,
        phone,
        terms_agreed_at: agreedAt,
        privacy_agreed_at: agreedAt,
      },
    },
  });

  if (error) {
    if (error.message === 'User already registered') {
      return NextResponse.json({ error: 'duplicate_email' }, { status: 400 });
    }
    console.error('[auth/signup] signUp 실패:', error.message);
    return NextResponse.json({ error: 'signup_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
