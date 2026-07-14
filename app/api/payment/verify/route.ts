// 결제 검증 API — 클라이언트 완료 콜백 후 서버에서 금액 재검증
// 테스트 모드: PortOne 콘솔에서 테스트 결제만 가능, 실 승인 없음

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient }        from '@supabase/ssr';
import { adminClient }                from '@/lib/supabase-admin';
import { cookies }                   from 'next/headers';
import { getPayment }                from '@/lib/portone';
import type { Database }             from '@/lib/database.types';

// 플랜별 허용 금액 (원). 연간은 일시불 총액.
const PLAN_AMOUNTS: Record<string, number[]> = {
  basic: [9900, 95040],
  pro:   [19900, 191040],
};

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
    const { paymentId, plan, amount } = await request.json() as {
      paymentId: string;
      plan:      'basic' | 'pro';
      amount:    number;
    };

    if (!paymentId || !plan || amount == null) {
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });
    }

    // 1. 쿠키 기반 로그인 유저 확인
    const supabase = makeSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증 필요' }, { status: 401 });
    }

    // 2. PortOne 결제 단건 조회
    const payment = await getPayment(paymentId);

    // 3. 결제 상태 확인
    if (payment.status !== 'PAID') {
      console.error('[payment/verify] 결제 미완료:', payment.status, paymentId);
      return NextResponse.json({ error: `결제 상태 이상: ${payment.status}` }, { status: 400 });
    }

    // 4. 금액 변조 방지 — 서버에서 재검증
    const allowed = PLAN_AMOUNTS[plan] ?? [];
    if (!allowed.includes(payment.amount.total) || payment.amount.total !== amount) {
      console.error('[payment/verify] 금액 불일치:', {
        allowed, actual: payment.amount.total, client: amount, paymentId,
      });
      return NextResponse.json({ error: '결제 금액 검증 실패' }, { status: 400 });
    }

    // 5. 중복 paymentId 방어 — 멱등 응답
    const { data: dupCheck } = await adminClient
      .from('payments')
      .select('id')
      .eq('payment_id', paymentId)
      .maybeSingle();
    if (dupCheck) {
      console.warn('[payment/verify] 중복 paymentId 요청, 멱등 응답 반환:', paymentId);
      return NextResponse.json({ ok: true, plan });
    }

    // 6. payments 테이블에 저장
    const isAnnual = [95040, 191040].includes(amount);
    const { error: insertError } = await adminClient.from('payments').insert({
      user_id:        user.id,
      plan,
      amount,
      payment_id:     paymentId,
      status:         'paid',
      payment_method: payment.method?.type ?? 'CARD',
      is_annual:      isAnnual,
    });
    if (insertError) {
      console.error('[payment/verify] payments insert 실패:', insertError);
      return NextResponse.json({ error: '결제 기록 저장 실패' }, { status: 500 });
    }

    // 7. 사용자 플랜 업데이트 — 실패 시 payments 레코드 롤백(보상 트랜잭션)
    const nextBilledAt = new Date();
    nextBilledAt.setMonth(nextBilledAt.getMonth() + (isAnnual ? 12 : 1));

    // subscription_start_date는 최초 구독 시작일에만 고정 — 월간 사용량 한도 계산의
    // 청구 주기 기준일이므로(lib/plan.ts의 getUsageCycleStart), 갱신·플랜 변경 시 매번
    // 갱신되면 기준일이 흔들려 한도 계산이 부정확해진다. 이미 값이 있으면 건드리지 않는다.
    const { data: existingRow } = await adminClient
      .from('users')
      .select('subscription_start_date')
      .eq('id', user.id)
      .maybeSingle();

    const { error: updateError } = await adminClient.from('users').update({
      plan,
      subscription_status: 'active',
      subscription_plan:   plan,
      next_billed_at:      nextBilledAt.toISOString(),
      ...(existingRow?.subscription_start_date ? {} : { subscription_start_date: new Date().toISOString() }),
    }).eq('id', user.id);

    if (updateError) {
      console.error('[payment/verify] users.update 실패, payments 롤백:', updateError);
      await adminClient.from('payments').delete().eq('payment_id', paymentId);
      return NextResponse.json({ error: '플랜 업데이트 실패' }, { status: 500 });
    }

    console.log(`[payment/verify] 검증 완료 — userId:${user.id} plan:${plan} amount:${amount}`);
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    console.error('[payment/verify] 오류:', e);
    return NextResponse.json({ error: '결제 검증 실패' }, { status: 500 });
  }
}
