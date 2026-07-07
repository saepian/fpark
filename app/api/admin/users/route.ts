// 관리자용 — 전체 회원 목록 + 계좌이체 결제 이력 조회
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

const USER_COLS = 'id, email, created_at, plan, subscription_plan, subscription_status, next_billed_at, stock_credits, portfolio_credits';
const REQUEST_COLS = 'id, user_id, plan, is_annual, amount, depositor_name, status, request_type, requested_at, processed_at';

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [usersRes, requestsRes, authUsersRes] = await Promise.all([
    adminClient.from('users').select(USER_COLS).order('created_at', { ascending: false }),
    adminClient.from('bank_transfer_requests').select(REQUEST_COLS).order('requested_at', { ascending: false }),
    adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (usersRes.error || requestsRes.error) {
    console.error('[admin/users] 조회 실패:', usersRes.error ?? requestsRes.error);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }

  const lastSignInById = new Map<string, string | null>();
  for (const u of authUsersRes.data?.users ?? []) {
    lastSignInById.set(u.id, u.last_sign_in_at ?? null);
  }

  const users = (usersRes.data ?? []).map((u) => ({
    ...u,
    last_sign_in_at: lastSignInById.get(u.id) ?? null,
  }));

  const paymentHistory: Record<string, (typeof requestsRes.data)> = {};
  for (const r of requestsRes.data ?? []) {
    (paymentHistory[r.user_id] ??= []).push(r);
  }

  return NextResponse.json({ ok: true, users, paymentHistory });
}
