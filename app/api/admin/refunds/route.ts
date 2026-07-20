// 관리자용 — 환불 대기/처리 목록 조회
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-auth';
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

const SELECT_COLS = `id, user_id, plan, paid_amount, usage_detected, elapsed_days, refund_amount, \
refund_reason, refund_status, refund_account_bank, refund_account_number, refund_account_holder, \
requested_at, processed_at, processed_by`;

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: refunds, error } = await adminClient
    .from('refund_requests')
    .select(SELECT_COLS)
    .order('requested_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[admin/refunds] 조회 실패:', error);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }

  const userIds = [...new Set((refunds ?? []).map(r => r.user_id))];
  const emailByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: userRows } = await adminClient.from('users').select('id, email').in('id', userIds);
    for (const u of userRows ?? []) {
      if (u.email) emailByUserId.set(u.id, u.email);
    }
  }

  return NextResponse.json({
    ok: true,
    refunds: (refunds ?? []).map(r => ({
      ...r,
      email: emailByUserId.get(r.user_id) ?? '(이메일 조회 실패)',
      // refund_requests엔 payment_method 컬럼이 없다 — 계좌이체는 refund_status='requested'가
      // 되려면 계좌 정보 입력이 필수(app/api/subscription/cancel/route.ts 196-201줄)라
      // refund_account_bank가 항상 채워져 있고, Dodo는 카드로 자동환불되므로 항상 null이다
      // (환불 API가 지갑 잔액 부족 등으로 실패해 dodo_refund_id가 안 채워진 경우도 포함).
      // 따라서 refund_account_bank 유무로 안전하게 구분 가능.
      payment_method: r.refund_account_bank === null ? 'DODO' as const : 'BANK_TRANSFER' as const,
    })),
  });
}
