import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
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

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [userRow, diagnosisCount, portfolioCount, payments] = await Promise.all([
    supabase.from('users').select('plan, created_at').eq('id', user.id).maybeSingle()
      .then(r => r.data),

    (() => {
      const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0];
      return supabase
        .from('stock_diagnosis')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', `${todayKst}T00:00:00+09:00`)
        .then(r => r.count ?? 0);
    })(),

    (() => {
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      return supabase
        .from('portfolio_diagnosis')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', monthStart.toISOString())
        .then(r => r.count ?? 0);
    })(),

    (async () => {
      try {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const { data } = await supabase
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

  const plan = (userRow?.plan ?? 'free') as 'free' | 'basic' | 'pro';

  return NextResponse.json({
    email: user.email ?? '',
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatarUrl: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    plan,
    createdAt: userRow?.created_at ?? user.created_at,
    usage: {
      diagnosisToday: diagnosisCount,
      portfolioMonth: portfolioCount,
    },
    payments,
  });
}
