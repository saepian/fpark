import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/supabase-admin';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';

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
  const { data: userRow } = await adminClient
    .from('users')
    .select('plan, created_at, email_alert_enabled, morning_briefing_enabled, subscription_status, payment_method, next_billed_at, depositor_real_name')
    .eq('id', user.id)
    .maybeSingle();


  const plan = (userRow?.plan ?? 'free') as 'free' | 'basic' | 'pro';
  const now  = new Date();
  const { cycleStart, nextCycleStart } = getBillingCycle(
    null,
    now,
  );

  const [diagnosisCount, portfolioCount, payments, pendingBankTransfer] = await Promise.all([
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
          .from('bank_transfer_requests')
          .select('id, requested_at, plan, amount, status')
          .eq('user_id', user.id)
          .gte('requested_at', sixMonthsAgo.toISOString())
          .order('requested_at', { ascending: false })
          .limit(20);
        return (data ?? []).map(r => ({
          id:         r.id,
          created_at: r.requested_at,
          plan:       r.plan,
          amount:     r.amount,
          status:     r.status,
        }));
      } catch {
        return [];
      }
    })(),

    (async () => {
      try {
        const { data } = await adminClient
          .from('bank_transfer_requests')
          .select('depositor_name, amount, plan, is_annual, requested_at')
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .order('requested_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return data;
      } catch {
        return null;
      }
    })(),
  ]);

  return NextResponse.json({
    email: user.email ?? '',
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatarUrl: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    plan,
    createdAt: userRow?.created_at ?? user.created_at,
    emailAlertEnabled: userRow?.email_alert_enabled ?? true,
    morningBriefingEnabled: userRow?.morning_briefing_enabled ?? true,
    depositorRealName: userRow?.depositor_real_name ?? null,
    usage: {
      diagnosisToday: diagnosisCount,
      portfolioMonth: portfolioCount,
      nextResetDate:  nextCycleStart.toISOString(),
    },
    payments,
    subscription: {
      status:        userRow?.subscription_status ?? 'inactive',
      paymentMethod: userRow?.payment_method ?? null,
      nextBilledAt:  userRow?.next_billed_at ?? null,
      pendingBankTransfer: pendingBankTransfer ? {
        depositorName: pendingBankTransfer.depositor_name,
        amount:        pendingBankTransfer.amount,
        plan:          pendingBankTransfer.plan,
        isAnnual:      pendingBankTransfer.is_annual,
        requestedAt:   pendingBankTransfer.requested_at,
      } : null,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const update: { email_alert_enabled?: boolean; morning_briefing_enabled?: boolean; depositor_real_name?: string } = {};
  if (typeof body.email_alert_enabled === 'boolean') update.email_alert_enabled = body.email_alert_enabled;
  if (typeof body.morning_briefing_enabled === 'boolean') update.morning_briefing_enabled = body.morning_briefing_enabled;
  if (typeof body.depositor_real_name === 'string') {
    const trimmed = body.depositor_real_name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: '예금주 실명을 입력해주세요.' }, { status: 400 });
    }
    update.depositor_real_name = trimmed;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }

  const { error } = await adminClient
    .from('users')
    .update(update)
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 오타 등으로 예금주명을 수정한 경우, 이미 접수된 대기중 신청의 매칭 근거도 최신값으로
  // 맞춰준다 — users 값만 바뀌고 이미 만들어진 신청 건이 옛날 값을 계속 들고 있으면
  // 자동 매칭이 조용히 실패하게 된다.
  if (update.depositor_real_name) {
    await adminClient
      .from('bank_transfer_requests')
      .update({ depositor_real_name: update.depositor_real_name })
      .eq('user_id', user.id)
      .eq('status', 'pending');
  }

  return NextResponse.json({ ok: true });
}
