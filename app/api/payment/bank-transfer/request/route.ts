// 계좌이체(무통장입금) 신청 접수 — PG 연동 없이 회사 고정 계좌 + 예금주 실명 매칭 방식.
// depositor_real_name(신청 시 입력받은 예금주 실명)을 users에도 영구 저장해 갱신 신청
// (화면 없이 크론이 자동 생성)에서도 재사용한다. 자동 매칭(cron/bank-transfer-auto-match)이
// 유니크하게 확정하지 못하면 관리자가 /admin/payments에서 수동 승인한다.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { PLAN_ALLOWED_AMOUNTS } from '@/lib/payment-constants';
import { computeDepositorName } from '@/lib/bank-transfer';
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

    const { plan, isAnnual, amount, depositorRealName } = await request.json() as {
      plan?:              'basic' | 'pro';
      isAnnual?:          boolean;
      amount?:            number;
      depositorRealName?: string;
    };

    if (!plan || amount == null) {
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });
    }

    const realName = depositorRealName?.trim();
    if (!realName) {
      return NextResponse.json({ error: '예금주 실명을 입력해주세요.' }, { status: 400 });
    }

    const allowed = PLAN_ALLOWED_AMOUNTS[plan] ?? [];
    if (!allowed.includes(amount)) {
      return NextResponse.json({ error: '결제 금액 검증 실패' }, { status: 400 });
    }

    // users.depositor_real_name을 최신값으로 유지 — 갱신 신청은 화면 없이 크론이 자동
    // 생성하므로(bank-transfer-renewal-notice) 여기 저장된 값을 매번 재사용한다.
    await adminClient
      .from('users')
      .update({ depositor_real_name: realName })
      .eq('id', user.id);

    // 이미 대기중인 신청이 있으면 새로 만들지 않고, 예금주명만 최신값으로 갱신 후 반환
    // (중복 방지 + 재제출 시 오타 수정 반영)
    const { data: existing } = await adminClient
      .from('bank_transfer_requests')
      .select('id, depositor_name, depositor_real_name, amount, plan, is_annual, requested_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      if (existing.depositor_real_name !== realName) {
        await adminClient
          .from('bank_transfer_requests')
          .update({ depositor_real_name: realName })
          .eq('id', existing.id);
      }
      return NextResponse.json({ ok: true, request: { ...existing, depositor_real_name: realName } });
    }

    const depositorName = computeDepositorName(user.email);

    const { data: inserted, error } = await adminClient
      .from('bank_transfer_requests')
      .insert({
        user_id:             user.id,
        plan,
        is_annual:           !!isAnnual,
        amount,
        depositor_name:      depositorName,
        depositor_real_name: realName,
      })
      .select('id, depositor_name, depositor_real_name, amount, plan, is_annual, requested_at')
      .single();

    if (error) {
      console.error('[bank-transfer/request] insert 실패:', error);
      return NextResponse.json({ error: '신청 저장 실패' }, { status: 500 });
    }

    console.log(`[bank-transfer/request] 신청 접수 — userId:${user.id} plan:${plan} amount:${amount} depositor:${depositorName} realName:${realName}`);
    return NextResponse.json({ ok: true, request: inserted });
  } catch (e) {
    console.error('[bank-transfer/request] 예외:', e);
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
