import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/supabase-admin';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';
import { sendBankTransferEmail } from '@/lib/bank-transfer';
import { buildWithdrawalCompletedEmailHtml } from '@/lib/account-emails';
import { cancelSubscription as cancelDodoSubscription } from '@/lib/dodo';

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
    .select('email, plan, dodo_subscription_id')
    .eq('id', user.id)
    .maybeSingle();

  // 2026-08-31 QA에서 발견: 이 라우트가 Dodo 구독을 취소하지 않고 auth 유저부터 지우고
  // 있었다 — Dodo 활성 구독이 있는 유저가 탈퇴하면 계정은 사라지는데 카드 자동결제는
  // 계속 돌아가는(취소할 화면 자체가 없어짐) 사고가 날 수 있었다. app/api/subscription
  // /cancel/route.ts와 동일한 안전장치: Dodo 구독부터 먼저 멈추고, 실패하면 계정 삭제
  // 자체를 중단한다(취소 안 된 구독을 남긴 채 탈퇴만 되는 상황 방지).
  if (userRow?.dodo_subscription_id) {
    try {
      await cancelDodoSubscription(userRow.dodo_subscription_id, 'immediate');
    } catch (error) {
      console.error('[MYPAGE] 탈퇴 전 Dodo 구독 취소 실패:', error);
      return NextResponse.json({ error: '구독 취소 처리에 실패해 탈퇴를 완료할 수 없습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
    }
  }

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
