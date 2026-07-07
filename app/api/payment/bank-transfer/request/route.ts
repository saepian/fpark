// 계좌이체(무통장입금) 신청 접수 — PG 연동 없이 회사 고정 계좌 + 입금자명 매칭 방식.
// 실제 입금 확인/구독 활성화는 관리자가 /admin/payments에서 수동 승인한다.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { PLAN_ALLOWED_AMOUNTS } from '@/lib/payment-constants';
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

export async function POST(request: NextRequest) {
  try {
    const supabase = makeSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증 필요' }, { status: 401 });
    }

    const { plan, isAnnual, amount } = await request.json() as {
      plan?:     'basic' | 'pro';
      isAnnual?: boolean;
      amount?:   number;
    };

    if (!plan || amount == null) {
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });
    }

    const allowed = PLAN_ALLOWED_AMOUNTS[plan] ?? [];
    if (!allowed.includes(amount)) {
      return NextResponse.json({ error: '결제 금액 검증 실패' }, { status: 400 });
    }

    // 이미 대기중인 신청이 있으면 새로 만들지 않고 기존 신청을 그대로 반환 (중복 방지)
    const { data: existing } = await adminClient
      .from('bank_transfer_requests')
      .select('id, depositor_name, amount, plan, is_annual, requested_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, request: existing });
    }

    const depositorName = (user.email ?? '').split('@')[0] || 'user';

    const { data: inserted, error } = await adminClient
      .from('bank_transfer_requests')
      .insert({
        user_id:        user.id,
        plan,
        is_annual:      !!isAnnual,
        amount,
        depositor_name: depositorName,
      })
      .select('id, depositor_name, amount, plan, is_annual, requested_at')
      .single();

    if (error) {
      console.error('[bank-transfer/request] insert 실패:', error);
      return NextResponse.json({ error: '신청 저장 실패' }, { status: 500 });
    }

    console.log(`[bank-transfer/request] 신청 접수 — userId:${user.id} plan:${plan} amount:${amount} depositor:${depositorName}`);
    return NextResponse.json({ ok: true, request: inserted });
  } catch (e) {
    console.error('[bank-transfer/request] 예외:', e);
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
