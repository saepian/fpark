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
    refunds: (refunds ?? []).map(r => ({ ...r, email: emailByUserId.get(r.user_id) ?? '(이메일 조회 실패)' })),
  });
}
