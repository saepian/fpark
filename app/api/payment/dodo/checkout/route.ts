// Dodo Payments 체크아웃 세션 생성 — 신규가입 전용(업그레이드는 스코프 밖, bank-transfer의
// computeUpgradeQuote()처럼 별도 크레딧 로직이 필요해 이번 단계에서 다루지 않음).
//
// payments에 pending 레코드를 먼저 만든 뒤 Dodo 세션을 생성한다 — insert가 실패하면 세션도
// 만들지 않는다(안 그러면 결제는 되는데 웹훅이 매칭할 레코드가 없어 활성화 누락 사고가 남).
// payment_id는 NOT NULL 컬럼인데 이 시점엔 Dodo의 실제 payment_id가 없어(confirm:true를
// 안 쓰는 호스티드 체크아웃 플로우) session_id를 임시로 넣어두고, 4단계 웹훅에서 실제
// payment_id로 덮어쓴다.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { createCheckoutSession, type DodoPlan, type BillingCycle } from '@/lib/dodo';
import { PLAN_AMOUNTS } from '@/lib/payment-constants';
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

function isDodoPlan(value: unknown): value is DodoPlan {
  return value === 'basic' || value === 'pro';
}

function isBillingCycle(value: unknown): value is BillingCycle {
  return value === 'monthly' || value === 'annual';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = makeSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증 필요' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as { plan?: unknown; billingCycle?: unknown };
    if (!isDodoPlan(body.plan) || !isBillingCycle(body.billingCycle)) {
      return NextResponse.json({ error: '잘못된 플랜 또는 결제 주기' }, { status: 400 });
    }
    const { plan, billingCycle } = body;

    const { data: userRow } = await adminClient
      .from('users')
      .select('plan, subscription_status')
      .eq('id', user.id)
      .maybeSingle();

    if (userRow && userRow.plan !== 'free' && userRow.subscription_status === 'active') {
      return NextResponse.json({ error: '이미 구독 중인 플랜이 있습니다.' }, { status: 400 });
    }

    const isAnnual = billingCycle === 'annual';
    const amount = isAnnual ? PLAN_AMOUNTS[plan].annual : PLAN_AMOUNTS[plan].monthly;

    let session;
    try {
      session = await createCheckoutSession({
        plan,
        billingCycle,
        userId:    user.id,
        userEmail: user.email,
        returnUrl: `${request.nextUrl.origin}/mypage`,
      });
    } catch (error) {
      console.error('[payment/dodo/checkout] 세션 생성 실패:', error);
      return NextResponse.json({ error: '결제 세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
    }

    const { error: insertError } = await adminClient.from('payments').insert({
      user_id:        user.id,
      plan,
      amount,
      is_annual:      isAnnual,
      payment_id:     session.sessionId,
      status:         'pending',
      payment_method: 'DODO',
    });

    if (insertError) {
      console.error('[payment/dodo/checkout] payments insert 실패:', insertError);
      return NextResponse.json({ error: '결제 세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
    }

    console.log(`[payment/dodo/checkout] 세션 생성 — userId:${user.id} plan:${plan} billingCycle:${billingCycle} sessionId:${session.sessionId}`);
    return NextResponse.json({ checkoutUrl: session.checkoutUrl });
  } catch (e) {
    console.error('[payment/dodo/checkout] 예외:', e);
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
