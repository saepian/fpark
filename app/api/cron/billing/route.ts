// 정기결제 자동 갱신 Cron — 매월 1일 00:05 KST 실행
// vercel.json cron: "5 15 1 * *" (UTC 기준, KST 00:05 = UTC 15:05 전날)
// CRON_SECRET 헤더로 무단 접근 차단 (fetch-news 등 기존 cron과 동일 패턴)
// 테스트 모드: 실제 카드 승인 없음

import { NextRequest, NextResponse } from 'next/server';
import { createClient }               from '@supabase/supabase-js';
import { payWithBillingKey }          from '@/lib/portone';
import { PLAN_AMOUNTS }               from '@/lib/payment-constants';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60;

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/billing] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/billing] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 중복 실행 방지 — billing_executions 테이블에 오늘 날짜 체크
  const todayDateStr = today.toISOString().slice(0, 10);
  try {
    const { data: existingExec } = await adminClient
      .from('billing_executions')
      .select('id')
      .eq('executed_date', todayDateStr)
      .maybeSingle();

    if (existingExec) {
      console.log('[cron/billing] 오늘 이미 실행됨, 스킵:', todayDateStr);
      return NextResponse.json({ ok: true, skipped: 'already_executed' });
    }

    await adminClient.from('billing_executions').insert({ executed_date: todayDateStr });
  } catch (e) {
    console.warn('[cron/billing] 중복 실행 체크 실패 (billing_executions 테이블 확인 필요):', e instanceof Error ? e.message : e);
  }

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

  if (!users?.length) {
    console.log('[cron/billing] 갱신 대상 없음');
    return NextResponse.json({ ok: true, success: 0, failed: 0 });
  }

  const userIds = users.map((u) => u.id as string);
  console.log(`[cron/billing] 갱신 대상: ${userIds.length}명`);

  // 최신 결제에서 is_annual 여부 확인 (연간 구독자 정확한 금액 청구)
  const { data: recentPayments } = await adminClient
    .from('payments')
    .select('user_id, is_annual')
    .in('user_id', userIds)
    .eq('status', 'paid')
    .order('created_at', { ascending: false });

  const isAnnualMap = new Map<string, boolean>();
  for (const p of recentPayments ?? []) {
    if (!isAnnualMap.has(p.user_id as string)) {
      isAnnualMap.set(p.user_id as string, Boolean(p.is_annual));
    }
  }

  const results = { success: 0, failed: 0 };

  for (const user of users) {
    const planInfo = PLAN_AMOUNTS[user.plan as string];
    if (!planInfo || !user.billing_key) continue;

    const isAnnual  = isAnnualMap.get(user.id as string) ?? false;
    const amount    = isAnnual ? planInfo.annual : planInfo.monthly;
    const period    = isAnnual ? '연간' : '월간';
    const paymentId = crypto.randomUUID();
    const orderName = `${planInfo.name} ${period} 구독 갱신`;

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
        nextBilledAt.setMonth(nextBilledAt.getMonth() + (isAnnual ? 12 : 1));

        await adminClient.from('payments').insert({
          user_id:        user.id,
          plan:           user.plan,
          amount,
          payment_id:     paymentId,
          status:         'paid',
          payment_method: 'BILLING_KEY',
          billing_key:    user.billing_key,
          is_annual:      isAnnual,
        });

        await adminClient.from('users').update({
          subscription_status: 'active',
          next_billed_at:      nextBilledAt.toISOString(),
        }).eq('id', user.id);

        results.success++;
        console.log(`[cron/billing] 갱신 성공 — userId:${user.id} plan:${user.plan} isAnnual:${isAnnual} amount:${amount}`);
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
