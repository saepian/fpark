// 웰컴 페이지(/welcome) 1회 노출 마커 갱신.
// 페이지 방문(마운트) 또는 "건너뛰고 시작하기" 클릭 시 호출되어 has_seen_welcome을
// true로 갱신한다 — 이후에는 resolvePostAuthRedirect가 다시 /welcome으로 보내지 않는다.
import { NextResponse } from 'next/server';
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

export async function POST() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await adminClient
    .from('users')
    .update({ has_seen_welcome: true })
    .eq('id', user.id);

  if (error) {
    console.error('[api/welcome] 업데이트 실패:', error);
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
