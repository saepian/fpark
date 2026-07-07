// 관리자용 — 계좌이체(무통장입금) 대기중 신청 + 최근 만료된 신청(재활성화용) 목록 조회
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-auth';
import type { Database } from '@/lib/database.types';

const EXPIRED_LOOKBACK_DAYS = 30;

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

const SELECT_COLS = 'id, user_id, plan, is_annual, amount, depositor_name, status, request_type, requested_at, processed_at';

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const lookbackFrom = new Date();
  lookbackFrom.setDate(lookbackFrom.getDate() - EXPIRED_LOOKBACK_DAYS);

  const [pendingRes, expiredRes] = await Promise.all([
    adminClient
      .from('bank_transfer_requests')
      .select(SELECT_COLS)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false }),
    adminClient
      .from('bank_transfer_requests')
      .select(SELECT_COLS)
      .eq('status', 'expired')
      .gte('requested_at', lookbackFrom.toISOString())
      .order('processed_at', { ascending: false }),
  ]);

  if (pendingRes.error || expiredRes.error) {
    console.error('[admin/bank-transfers] 조회 실패:', pendingRes.error ?? expiredRes.error);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }

  const allRequests = [...(pendingRes.data ?? []), ...(expiredRes.data ?? [])];
  const userIds = [...new Set(allRequests.map(r => r.user_id))];
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

  const withEmail = (r: (typeof allRequests)[number]) => ({
    ...r,
    email: emailByUserId.get(r.user_id) ?? '(이메일 조회 실패)',
  });

  return NextResponse.json({
    ok: true,
    pending: (pendingRes.data ?? []).map(withEmail),
    expired: (expiredRes.data ?? []).map(withEmail),
  });
}
