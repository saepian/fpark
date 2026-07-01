import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient(
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

// RLS 우회를 위해 service role key 사용 (읽기 전용 조회)
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// 날짜 d가 해당 월에 존재하지 않으면 말일로 클램핑 (e.g., 1월 31일 → 2월 28일)
function monthDay(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay), 0, 0, 0, 0);
}

// subscription_start_date 기준 현재 사이클 시작일 & 다음 초기화일 계산
// null이면 매월 1일 기준 폴백
function getBillingCycle(subscriptionStartDate: string | null, now: Date): {
  cycleStart: Date;
  nextCycleStart: Date;
} {
  if (!subscriptionStartDate) {
    return {
      cycleStart:      new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      nextCycleStart:  new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0),
    };
  }
  const startDay = new Date(subscriptionStartDate).getDate();
  const y = now.getFullYear();
  const m = now.getMonth();
  const thisMonthStart = monthDay(y, m, startDay);

  if (thisMonthStart <= now) {
    return { cycleStart: thisMonthStart, nextCycleStart: monthDay(y, m + 1, startDay) };
  }
  return { cycleStart: monthDay(y, m - 1, startDay), nextCycleStart: thisMonthStart };
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // users 테이블 조회 — service role key로 RLS 우회
  const { data: userRow, error: userRowError } = await adminClient
    .from('users')
    .select('plan, created_at')
    .eq('id', user.id)
    .maybeSingle();

  if (userRowError) console.error('[MYPAGE] userRow 조회 에러:', JSON.stringify(userRowError));

  const plan = (userRow?.plan ?? 'free') as 'free' | 'basic' | 'pro';
  const now  = new Date();
  const { cycleStart, nextCycleStart } = getBillingCycle(
    null,
    now,
  );

  const [diagnosisCount, portfolioCount, payments] = await Promise.all([
    (() => {
      const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0];
      return adminClient
        .from('stock_diagnosis')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', `${todayKst}T00:00:00+09:00`)
        .then(r => r.count ?? 0);
    })(),

    adminClient
      .from('portfolio_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', cycleStart.toISOString())
      .then(r => r.count ?? 0),

    (async () => {
      try {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const { data } = await adminClient
          .from('payments')
          .select('id, created_at, plan, amount, status')
          .eq('user_id', user.id)
          .gte('created_at', sixMonthsAgo.toISOString())
          .order('created_at', { ascending: false })
          .limit(20);
        return data ?? [];
      } catch {
        return [];
      }
    })(),
  ]);

  // DEBUG: remove after verifying plan
  console.log('[MYPAGE] user.id:', user.id, 'plan:', plan, 'userRow:', JSON.stringify(userRow), 'error:', JSON.stringify(userRowError));

  return NextResponse.json({
    email: user.email ?? '',
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatarUrl: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    plan,
    _debug_userId: user.id,
    _debug_userRow: userRow,
    _debug_userRowError: userRowError,
    createdAt: userRow?.created_at ?? user.created_at,
    usage: {
      diagnosisToday: diagnosisCount,
      portfolioMonth: portfolioCount,
      nextResetDate:  nextCycleStart.toISOString(),
    },
    payments,
  });
}
