// 관리자용 — 전체 회원 목록 + 계좌이체 결제 이력 조회
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-auth';
import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';
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

const USER_COLS = 'id, email, created_at, plan, subscription_plan, subscription_status, next_billed_at, subscription_start_date, stock_credits, portfolio_credits';
const REQUEST_COLS = 'id, user_id, plan, is_annual, amount, depositor_name, status, request_type, requested_at, processed_at';
const REFUND_COLS = 'id, user_id, plan, paid_amount, elapsed_days, refund_amount, refund_status, requested_at, processed_at';

// mypage/portfolio-diagnosis와 동일한 규칙 — subscription_start_date 기준 이번 결제
// 사이클 시작일(무료 유저는 매월 1일). "이번 달 이용현황" 집계 구간으로 재사용.
function getBillingCycleStart(subscriptionStartDate: string | null, now: Date): Date {
  if (!subscriptionStartDate) {
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }
  const startDay = new Date(subscriptionStartDate).getDate();
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDay = (yr: number, mo: number) => new Date(yr, mo + 1, 0).getDate();
  const thisMonthStart = new Date(y, m, Math.min(startDay, lastDay(y, m)), 0, 0, 0, 0);
  if (thisMonthStart <= now) return thisMonthStart;
  return new Date(y, m - 1, Math.min(startDay, lastDay(y, m - 1)), 0, 0, 0, 0);
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [usersRes, requestsRes, refundsRes, authUsersRes] = await Promise.all([
    adminClient.from('users').select(USER_COLS).order('created_at', { ascending: false }),
    adminClient.from('bank_transfer_requests').select(REQUEST_COLS).order('requested_at', { ascending: false }),
    adminClient.from('refund_requests').select(REFUND_COLS).order('requested_at', { ascending: false }),
    adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (usersRes.error || requestsRes.error || refundsRes.error) {
    console.error('[admin/users] 조회 실패:', usersRes.error ?? requestsRes.error ?? refundsRes.error);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }

  const lastSignInById = new Map<string, string | null>();
  for (const u of authUsersRes.data?.users ?? []) {
    lastSignInById.set(u.id, u.last_sign_in_at ?? null);
  }

  const now = new Date();
  // 종목진단은 "일일" 한도라 오늘 자정(KST) 기준으로 별도 집계 — 이번 달 누적치와
  // 같은 분모로 비교하면(예: 45/11) 정상적으로 여러 날 나눠 쓴 유저도 한도 초과처럼 보인다.
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
  const todayStartUtc = `${todayKst}T00:00:00+09:00`;

  const users = await Promise.all((usersRes.data ?? []).map(async (u) => {
    const cycleStart = getBillingCycleStart(u.subscription_start_date, now);
    const [{ count: diagnosisToday }, { count: diagnosisMonth }, { count: portfolioUsed }] = await Promise.all([
      adminClient.from('stock_diagnosis').select('*', { count: 'exact', head: true })
        .eq('user_id', u.id).gte('created_at', todayStartUtc),
      adminClient.from('stock_diagnosis').select('*', { count: 'exact', head: true })
        .eq('user_id', u.id).gte('created_at', cycleStart.toISOString()),
      adminClient.from('portfolio_diagnosis').select('*', { count: 'exact', head: true })
        .eq('user_id', u.id).gte('created_at', cycleStart.toISOString()),
    ]);
    const limits = PLAN_USAGE_LIMITS[u.plan as 'free' | 'basic' | 'pro'] ?? PLAN_USAGE_LIMITS.free;

    return {
      ...u,
      last_sign_in_at:      lastSignInById.get(u.id) ?? null,
      diagnosis_used_today: diagnosisToday ?? 0,
      diagnosis_used_month: diagnosisMonth ?? 0,
      diagnosis_limit:      limits.diagnosis,
      portfolio_used:       portfolioUsed ?? 0,
      portfolio_limit:      limits.portfolio,
    };
  }));

  const paymentHistory: Record<string, (typeof requestsRes.data)> = {};
  for (const r of requestsRes.data ?? []) {
    (paymentHistory[r.user_id] ??= []).push(r);
  }

  const refundHistory: Record<string, (typeof refundsRes.data)> = {};
  for (const r of refundsRes.data ?? []) {
    (refundHistory[r.user_id] ??= []).push(r);
  }

  return NextResponse.json({ ok: true, users, paymentHistory, refundHistory });
}
