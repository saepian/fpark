// 빌링키 기반 정기결제 실행 API
// 1) 최초 구독 시 클라이언트에서 발급된 빌링키로 즉시 첫 결제
// 2) 이후 월/연간 자동 갱신은 /api/cron/billing 에서 호출
// 테스트 모드: 실제 카드 승인 없음

import { NextRequest, NextResponse } from 'next/server';
import { createClient }               from '@supabase/supabase-js';
import { payWithBillingKey }          from '@/lib/portone';

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PLAN_AMOUNTS: Record<string, { monthly: number; annual: number; name: string }> = {
  basic: { monthly: 4900,  annual: 47040,  name: 'Finance Park Basic' },
  pro:   { monthly: 19900, annual: 191040, name: 'Finance Park Pro'   },
};

export async function POST(request: NextRequest) {
  try {
    const { billingKey, plan, isAnnual, userId, userEmail } = await request.json() as {
      billingKey: string;
      plan:       'basic' | 'pro';
      isAnnual:   boolean;
      userId:     string;
      userEmail?: string;
    };

    if (!billingKey || !plan || !userId) {
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });
    }

    const planInfo = PLAN_AMOUNTS[plan];
    if (!planInfo) {
      return NextResponse.json({ error: '유효하지 않은 플랜' }, { status: 400 });
    }

    const amount    = isAnnual ? planInfo.annual : planInfo.monthly;
    const period    = isAnnual ? '연간' : '월간';
    const orderName = `${planInfo.name} ${period} 구독`;
    const paymentId = crypto.randomUUID();

    // PortOne 빌링키 결제 실행
    const result = await payWithBillingKey({
      paymentId,
      billingKey,
      orderName,
      amount,
      customerId:    userId,
      customerEmail: userEmail,
    });

    if (result.status !== 'PAID') {
      console.error('[payment/billing] 결제 실패:', result);
      return NextResponse.json({ error: '결제 실패' }, { status: 400 });
    }

    // 다음 청구일 계산
    const nextBilledAt = new Date();
    nextBilledAt.setMonth(nextBilledAt.getMonth() + (isAnnual ? 12 : 1));

    // payments 테이블 저장
    await adminClient.from('payments').insert({
      user_id:        userId,
      plan,
      amount,
      payment_id:     paymentId,
      status:         'paid',
      payment_method: 'BILLING_KEY',
      billing_key:    billingKey,
      is_annual:      isAnnual,
    });

    // 사용자 플랜 + 빌링키 업데이트
    await adminClient.from('users').update({
      plan,
      subscription_plan:   plan,
      subscription_status: 'active',
      billing_key:         billingKey,
      next_billed_at:      nextBilledAt.toISOString(),
    }).eq('id', userId);

    console.log(`[payment/billing] 완료 — userId:${userId} plan:${plan} amount:${amount}`);
    return NextResponse.json({ ok: true, plan, paymentId });
  } catch (e) {
    console.error('[payment/billing] 오류:', e);
    return NextResponse.json({ error: '결제 처리 중 오류 발생' }, { status: 500 });
  }
}
