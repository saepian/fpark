// 관리자용 — 계좌이체(무통장입금) 대기중 신청 목록 조회
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

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: requests, error } = await adminClient
    .from('bank_transfer_requests')
    .select('id, user_id, plan, is_annual, amount, depositor_name, status, requested_at')
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });

  if (error) {
    console.error('[admin/bank-transfers] 조회 실패:', error);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }

  const userIds = [...new Set((requests ?? []).map(r => r.user_id))];
  const emailByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: userRows } = await adminClient
      .from('users')
      .select('id, email')
      .in('id', userIds);
    for (const u of userRows ?? []) {
      if (u.email) emailByUserId.set(u.id, u.email);
    }
  }

  const items = (requests ?? []).map(r => ({
    ...r,
    email: emailByUserId.get(r.user_id) ?? '(이메일 조회 실패)',
  }));

  return NextResponse.json({ ok: true, items });
}
