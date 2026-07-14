// 관리자용 — 전체 회원 목록 + 계좌이체 결제 이력 조회
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-auth';
import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';
import { getUsageCycleStart } from '@/lib/plan';
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
const REQUEST_COLS = 'id, user_id, plan, is_annual, amount, depositor_name, depositor_real_name, status, request_type, requested_at, processed_at';
const REFUND_COLS = 'id, user_id, plan, paid_amount, elapsed_days, refund_amount, refund_status, requested_at, processed_at';

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

  // 2026-07-14 요금제 재구성으로 기업분석도 월간 한도로 전환 — 포트폴리오와 동일하게
  // 이번 결제 사이클 누적치만 집계하면 된다(예전엔 "일일" 한도라 오늘 자정 기준 별도
  // 집계가 필요했으나 더 이상 아님). 종목분석 이용 현황도 함께 집계.
  const users = await Promise.all((usersRes.data ?? []).map(async (u) => {
    const { cycleStart } = getUsageCycleStart(u.subscription_start_date, now);
    const [{ count: diagnosisMonth }, { count: portfolioUsed }, { count: stockAnalysisUsed }] = await Promise.all([
      adminClient.from('stock_diagnosis').select('*', { count: 'exact', head: true })
        .eq('user_id', u.id).gte('created_at', cycleStart.toISOString()),
      adminClient.from('portfolio_diagnosis').select('*', { count: 'exact', head: true })
        .eq('user_id', u.id).gte('created_at', cycleStart.toISOString()),
      adminClient.from('stock_analysis_usage').select('*', { count: 'exact', head: true })
        .eq('user_id', u.id).gte('usage_date', cycleStart.toISOString().split('T')[0]),
    ]);
    const limits = PLAN_USAGE_LIMITS[u.plan as 'free' | 'basic' | 'pro'] ?? PLAN_USAGE_LIMITS.free;

    return {
      ...u,
      last_sign_in_at:        lastSignInById.get(u.id) ?? null,
      diagnosis_used_month:   diagnosisMonth ?? 0,
      diagnosis_limit:        limits.diagnosis,
      portfolio_used:         portfolioUsed ?? 0,
      portfolio_limit:        limits.portfolio,
      stock_analysis_used:    stockAnalysisUsed ?? 0,
      stock_analysis_limit:   limits.stockAnalysis,
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
