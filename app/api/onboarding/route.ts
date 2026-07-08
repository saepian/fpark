import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import type { Database } from '@/lib/database.types';

export const dynamic = 'force-dynamic';

const VISIBLE_WINDOW_DAYS = 7;

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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: userRow }, { count: portfolioCount }] = await Promise.all([
    adminClient
      .from('users')
      .select('created_at, onboarding_watchlist_added, onboarding_report_viewed, onboarding_alert_enabled, onboarding_dismissed')
      .eq('id', user.id)
      .maybeSingle(),
    adminClient
      .from('portfolio_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ]);

  const createdAt = userRow?.created_at ?? user.created_at;
  const daysSinceSignup = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;

  const watchlistAdded = userRow?.onboarding_watchlist_added ?? false;
  const reportViewed   = userRow?.onboarding_report_viewed   ?? false;
  const alertEnabled   = userRow?.onboarding_alert_enabled   ?? false;
  const dismissed      = userRow?.onboarding_dismissed       ?? false;
  const portfolioAdded = (portfolioCount ?? 0) > 0; // 선택 항목 — 별도 플래그 없이 실제 이용 여부로 판단

  const requiredComplete = watchlistAdded && reportViewed && alertEnabled;

  // 가입 7일 이내 + 닫지 않음일 때만 노출. requiredComplete는 여기서 걸러내지 않고
  // 클라이언트에 그대로 전달한다 — 클라이언트가 "모두 완료!" 축하 메시지를 한 번 보여준 뒤
  // dismissed=true로 저장해 스스로 닫도록 하기 위함(완료 즉시 서버에서 숨겨버리면 축하 메시지를
  // 보여줄 타이밍이 없다). 기존 유저(가입 오래됨)에게는 daysSinceSignup 조건에서 자연히 걸러진다.
  const shouldShow = daysSinceSignup <= VISIBLE_WINDOW_DAYS && !dismissed;

  return NextResponse.json({
    shouldShow,
    requiredComplete,
    watchlistAdded,
    reportViewed,
    alertEnabled,
    portfolioAdded,
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.dismissed !== true) {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }

  const { error } = await adminClient
    .from('users')
    .update({ onboarding_dismissed: true })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
