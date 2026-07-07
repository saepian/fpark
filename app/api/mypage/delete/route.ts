import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/supabase-admin';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';
import { sendBankTransferEmail } from '@/lib/bank-transfer';
import { buildWithdrawalCompletedEmailHtml } from '@/lib/account-emails';

export const dynamic = 'force-dynamic';

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

export async function DELETE() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userRow } = await adminClient
    .from('users')
    .select('email, plan')
    .eq('id', user.id)
    .maybeSingle();

  // DB 삭제 전에 먼저 안내 메일을 발송한다 — 삭제가 성공한 뒤에는 유저 행을 다시 조회할 수 없다.
  const email = userRow?.email ?? user.email ?? null;
  if (email) {
    await sendBankTransferEmail({
      to: email,
      subject: 'Finance Park 탈퇴가 완료되었습니다',
      html: buildWithdrawalCompletedEmailHtml(userRow?.plan !== 'free'),
      logTag: 'WITHDRAWAL_EMAIL',
    });
  }

  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('[MYPAGE] 회원탈퇴 실패:', error.message);
    return NextResponse.json({ error: '탈퇴 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
