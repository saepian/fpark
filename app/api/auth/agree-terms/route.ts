// 소셜 로그인(네이버/구글) 신규 유저용 — 약관/개인정보처리방침 동의 기록.
// 이메일 회원가입은 signUp() 시점에 user_metadata로 실어 보내 트리거가 바로 기록하므로
// 이 라우트를 거치지 않는다. 여기는 세션이 이미 있는 소셜 로그인 신규 유저 전용.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import type { Database } from '@/lib/database.types';

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.then(s => s.getAll()),
        setAll: (pairs) => cookieStore.then(s => {
          pairs.forEach(({ name, value, options }) => s.set(name, value, options));
        }),
      },
    },
  );
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await adminClient
    .from('users')
    .select('terms_agreed_at, privacy_agreed_at')
    .eq('id', user.id)
    .maybeSingle();

  const agreed = !!(data?.terms_agreed_at && data?.privacy_agreed_at);
  return NextResponse.json({ ok: true, agreed });
}

export async function POST(request: NextRequest) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { agreeTerms?: boolean; agreePrivacy?: boolean };
  if (!body.agreeTerms || !body.agreePrivacy) {
    return NextResponse.json({ error: '필수 약관에 모두 동의해주세요.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await adminClient
    .from('users')
    .update({ terms_agreed_at: now, privacy_agreed_at: now })
    .eq('id', user.id);

  if (error) {
    console.error('[auth/agree-terms] 업데이트 실패:', error);
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
