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

  // adminClient 호출 실패(로컬 dev 안전장치 등)를 그대로 던지면 클라이언트에서는
  // 500 → r.ok===false → null 로만 흡수돼(OnboardingChecklist.tsx) 원인 파악 없이
  // "체크리스트가 그냥 안 뜸"으로만 보인다 — 서버 로그에 명확히 남긴다.
  let userRow: { created_at: string | null; onboarding_watchlist_added: boolean; onboarding_report_viewed: boolean; onboarding_alert_enabled: boolean; onboarding_dismissed: boolean } | null = null;
  let portfolioCount = 0;
  try {
    const [{ data, error: userErr }, { count, error: pfErr }] = await Promise.all([
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
    if (userErr) console.error('[ONBOARDING] users 조회 실패:', userErr.message);
    if (pfErr) console.error('[ONBOARDING] portfolio_diagnosis 조회 실패:', pfErr.message);
    userRow = data;
    portfolioCount = count ?? 0;
  } catch (e) {
    console.error('[ONBOARDING] GET 조회 예외 — shouldShow:false로 폴백:', e instanceof Error ? e.message : e);
    return NextResponse.json({
      shouldShow: false, requiredComplete: false,
      watchlistAdded: false, reportViewed: false, alertEnabled: false, portfolioAdded: false,
    });
  }

  const createdAt = userRow?.created_at ?? user.created_at;
  const daysSinceSignup = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;

  const watchlistAdded = userRow?.onboarding_watchlist_added ?? false;
  const reportViewed   = userRow?.onboarding_report_viewed   ?? false;
  const alertEnabled   = userRow?.onboarding_alert_enabled   ?? false;
  const dismissed      = userRow?.onboarding_dismissed       ?? false;
  const portfolioAdded = portfolioCount > 0; // 선택 항목 — 별도 플래그 없이 실제 이용 여부로 판단

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
