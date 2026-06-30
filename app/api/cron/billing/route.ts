// 정기결제 자동 갱신 Cron — 매월 1일 00:05 KST 실행
// vercel.json cron: "5 15 1 * *" (UTC 기준, KST 00:05 = UTC 15:05 전날)
// CRON_SECRET 헤더로 무단 접근 차단 (fetch-news 등 기존 cron과 동일 패턴)
// 테스트 모드: 실제 카드 승인 없음

import { NextRequest, NextResponse } from 'next/server';
import { createClient }               from '@supabase/supabase-js';
import { payWithBillingKey }          from '@/lib/portone';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60;

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PLAN_AMOUNTS: Record<string, { monthly: number; annual: number; name: string }> = {
  basic: { monthly: 4900,  annual: 47040,  name: 'Finance Park Basic' },
  pro:   { monthly: 19900, annual: 191040, name: 'Finance Park Pro'   },
};

export async function GET(request: NextRequest) {
  // 인증 확인 (fetch-news cron과 동일)
  const secret = request.headers.get('x-cron-secret')
    ?? new URL(request.url).searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 오늘 갱신일인 구독 유저 조회
  const { data: users, error } = await adminClient
    .from('users')
    .select('id, email, plan, billing_key, subscription_status, next_billed_at')
    .in('subscription_status', ['active'])
    .not('billing_key', 'is', null)
    .gte('next_billed_at', today.toISOString())
    .lt('next_billed_at', tomorrow.toISOString());

  if (error) {
    console.error('[cron/billing] users 조회 실패:', error);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }

  console.log(`[cron/billing] 갱신 대상: ${users?.length ?? 0}명`);

  const results = { success: 0, failed: 0 };

  for (const user of users ?? []) {
    const planInfo = PLAN_AMOUNTS[user.plan as string];
    if (!planInfo || !user.billing_key) continue;

    const paymentId  = crypto.randomUUID();
    const orderName  = `${planInfo.name} 월간 구독 갱신`;
    const amount     = planInfo.monthly;

    try {
      const result = await payWithBillingKey({
        paymentId,
        billingKey:    user.billing_key as string,
        orderName,
        amount,
        customerId:    user.id as string,
        customerEmail: user.email as string | undefined,
      });

      if (result.status === 'PAID') {
        const nextBilledAt = new Date();
        nextBilledAt.setMonth(nextBilledAt.getMonth() + 1);

        await adminClient.from('payments').insert({
          user_id:        user.id,
          plan:           user.plan,
          amount,
          payment_id:     paymentId,
          status:         'paid',
          payment_method: 'BILLING_KEY',
          billing_key:    user.billing_key,
          is_annual:      false,
        });

        await adminClient.from('users').update({
          subscription_status: 'active',
          next_billed_at:      nextBilledAt.toISOString(),
        }).eq('id', user.id);

        results.success++;
        console.log(`[cron/billing] 갱신 성공 — userId:${user.id}`);
      } else {
        throw new Error(`결제 상태: ${result.status}`);
      }
    } catch (e) {
      results.failed++;
      console.error(`[cron/billing] 갱신 실패 — userId:${user.id}:`, e);

      await adminClient.from('users').update({
        subscription_status: 'payment_failed',
      }).eq('id', user.id);
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
