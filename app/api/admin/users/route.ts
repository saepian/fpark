// 관리자용 — 전체 회원 목록 + 계좌이체/카드결제 이력 조회
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-auth';
import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';
import { isStockAnalysisDaily, type Plan } from '@/lib/plan';
import { aggregateUsageCounts, minCycleStart, type UsageAggregationUser } from '@/lib/usage-aggregation';
import { listAllAuthUsers } from '@/lib/list-all-auth-users';
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
const PAYMENT_COLS = 'id, user_id, plan, is_annual, amount, status, payment_method, created_at';

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1단계: 유저 수와 무관한 고정 쿼리 5개 — listUsers는 listAllAuthUsers로 페이지네이션해
  // 1000명 상한에서 조용히 잘리던 문제를 해결(lib/list-all-auth-users.ts).
  const [usersRes, requestsRes, refundsRes, paymentsRes, authUsers] = await Promise.all([
    adminClient.from('users').select(USER_COLS).order('created_at', { ascending: false }),
    adminClient.from('bank_transfer_requests').select(REQUEST_COLS).order('requested_at', { ascending: false }),
    adminClient.from('refund_requests').select(REFUND_COLS).order('requested_at', { ascending: false }),
    adminClient.from('payments').select(PAYMENT_COLS).order('created_at', { ascending: false }),
    listAllAuthUsers('[admin/users]'),
  ]);

  if (usersRes.error || requestsRes.error || refundsRes.error || paymentsRes.error) {
    console.error('[admin/users] 조회 실패:', usersRes.error ?? requestsRes.error ?? refundsRes.error ?? paymentsRes.error);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }

  const now = new Date();
  const todayKst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

  const rawUsers = usersRes.data ?? [];
  const userIds = rawUsers.map((u) => u.id);
  const aggregationUsers: UsageAggregationUser[] = rawUsers.map((u) => ({
    id:                     u.id,
    plan:                   (u.plan as Plan) ?? 'free',
    subscriptionStartDate:  u.subscription_start_date,
  }));

  // 2단계: 사용량 집계용 벌크 쿼리 3개(유저 수와 무관) — 예전엔 유저 1명당 3개씩(N+1)
  // 날리던 것을, 전체 유저의 로우를 한 번씩만 가져와 lib/usage-aggregation.ts에서
  // user_id별로 그룹핑 후 각자의 사이클 경계로 재필터링하는 방식으로 대체.
  // minCycleStart(전체 유저 중 가장 이른 cycleStart)를 하한으로 걸어 불필요한 과거
  // 데이터 스캔을 줄인다 — 모든 유저의 실제 cycleStart보다 항상 이르거나 같으므로
  // 정확도 손실 없음(집계 단계에서 유저별로 다시 정확히 필터링됨).
  let diagnosisRows: { user_id: string | null; created_at: string | null }[] = [];
  let portfolioRows: { user_id: string | null; created_at: string | null }[] = [];
  let stockAnalysisRows: { user_id: string | null; usage_date: string }[] = [];

  if (userIds.length > 0) {
    const bulkFrom = minCycleStart(aggregationUsers, now).toISOString();
    const [diagnosisRes, portfolioRes, stockAnalysisRes] = await Promise.all([
      adminClient.from('stock_diagnosis').select('user_id, created_at').in('user_id', userIds).gte('created_at', bulkFrom),
      adminClient.from('portfolio_diagnosis').select('user_id, created_at').in('user_id', userIds).gte('created_at', bulkFrom),
      adminClient.from('stock_analysis_usage').select('user_id, usage_date').in('user_id', userIds).gte('usage_date', bulkFrom.split('T')[0]),
    ]);
    if (diagnosisRes.error || portfolioRes.error || stockAnalysisRes.error) {
      console.error('[admin/users] 사용량 조회 실패:', diagnosisRes.error ?? portfolioRes.error ?? stockAnalysisRes.error);
      return NextResponse.json({ error: '조회 실패' }, { status: 500 });
    }
    diagnosisRows = diagnosisRes.data ?? [];
    portfolioRows = portfolioRes.data ?? [];
    stockAnalysisRows = stockAnalysisRes.data ?? [];
  }

  const usageCounts = aggregateUsageCounts(aggregationUsers, diagnosisRows, portfolioRows, stockAnalysisRows, now, todayKst);

  const users = rawUsers.map((u) => {
    const plan = (u.plan as 'free' | 'basic' | 'pro') ?? 'free';
    const limits = PLAN_USAGE_LIMITS[plan] ?? PLAN_USAGE_LIMITS.free;
    const counts = usageCounts.get(u.id) ?? { diagnosisUsed: 0, portfolioUsed: 0, stockAnalysisUsed: 0 };

    return {
      ...u,
      last_sign_in_at:        authUsers.get(u.id)?.lastSignInAt ?? null,
      diagnosis_used_month:   counts.diagnosisUsed,
      diagnosis_limit:        limits.diagnosis,
      portfolio_used:         counts.portfolioUsed,
      portfolio_limit:        limits.portfolio,
      stock_analysis_used:    counts.stockAnalysisUsed,
      stock_analysis_limit:   limits.stockAnalysis,
      stock_analysis_daily:   isStockAnalysisDaily(plan),
    };
  });

  const paymentHistory: Record<string, (typeof requestsRes.data)> = {};
  for (const r of requestsRes.data ?? []) {
    (paymentHistory[r.user_id] ??= []).push(r);
  }

  const refundHistory: Record<string, (typeof refundsRes.data)> = {};
  for (const r of refundsRes.data ?? []) {
    (refundHistory[r.user_id] ??= []).push(r);
  }

  const cardPaymentHistory: Record<string, (typeof paymentsRes.data)> = {};
  for (const p of paymentsRes.data ?? []) {
    (cardPaymentHistory[p.user_id] ??= []).push(p);
  }

  return NextResponse.json({ ok: true, users, paymentHistory, refundHistory, cardPaymentHistory });
}
