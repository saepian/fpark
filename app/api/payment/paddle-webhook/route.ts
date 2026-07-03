// Paddle 구독 웹훅 수신 처리
// Paddle 대시보드 → Notifications → Webhook URL: https://fpark.com/api/payment/paddle-webhook
// 구독 생성/취소/갱신 이벤트를 받아 DB 사용자 플랜을 업데이트

import { NextRequest, NextResponse } from 'next/server';
import { createClient }               from '@supabase/supabase-js';
import crypto                         from 'crypto';

const PLAN_AMOUNTS = {
  basic: { monthly: 9900,  annual: 95040  },
  pro:   { monthly: 19900, annual: 191040 },
};

function verifySignature(secret: string, signature: string, rawBody: string): boolean {
  const ts = signature.match(/ts=(\d+)/)?.[1];
  const h1 = signature.match(/h1=([a-f0-9]+)/)?.[1];
  if (!ts || !h1) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}:${rawBody}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(h1, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

type PaddleCustomData = {
  userId?:   string;
  plan?:     string;
  isAnnual?: string;
};

type PaddleEvent = {
  event_type:  string;
  occurred_at: string;
  data: {
    id:          string;        // subscription ID
    status:      string;
    customer_id: string;
    items?: Array<{ price: { id: string } }>;
    custom_data?: PaddleCustomData;
  };
};

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[paddle-webhook] PADDLE_WEBHOOK_SECRET 미설정');
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const PRICE_TO_PLAN: Record<string, 'basic' | 'pro'> = {
      [process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_BASIC ?? '']: 'basic',
      [process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO   ?? '']: 'pro',
    };

    const signature = request.headers.get('paddle-signature') ?? '';
    const rawBody   = await request.text();

    if (!verifySignature(secret, signature, rawBody)) {
      console.warn('[paddle-webhook] 서명 검증 실패 — 무단 요청 차단');
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const event     = JSON.parse(rawBody) as PaddleEvent;
    const { event_type, data } = event;
    console.log('[paddle-webhook] 수신:', event_type, data.id);

    const userId   = data.custom_data?.userId;
    const priceId  = data.items?.[0]?.price?.id ?? '';
    const planName = (data.custom_data?.plan as 'basic' | 'pro' | undefined)
                  ?? PRICE_TO_PLAN[priceId];
    const isAnnual = data.custom_data?.isAnnual === 'true';

    if (event_type === 'subscription.created' && userId && planName) {
      const amounts      = PLAN_AMOUNTS[planName];
      const amount       = isAnnual ? amounts.annual : amounts.monthly;
      const nextBilledAt = new Date();
      nextBilledAt.setMonth(nextBilledAt.getMonth() + (isAnnual ? 12 : 1));

      await adminClient.from('payments').upsert(
        {
          user_id:        userId,
          plan:           planName,
          amount,
          payment_id:     `paddle_${data.id}`,
          status:         'paid',
          payment_method: 'PADDLE',
          is_annual:      isAnnual,
        },
        { onConflict: 'payment_id', ignoreDuplicates: true },
      );

      await adminClient.from('users').update({
        plan:                planName,
        subscription_plan:   planName,
        subscription_status: 'active',
        payment_method:      'PADDLE',
        next_billed_at:      nextBilledAt.toISOString(),
      }).eq('id', userId);

      console.log(`[paddle-webhook] 구독 생성 — userId:${userId} plan:${planName} annual:${isAnnual}`);
    }

    if (event_type === 'subscription.cancelled' && userId) {
      await adminClient.from('payments')
        .update({ status: 'cancelled' })
        .eq('payment_id', `paddle_${data.id}`);

      await adminClient.from('users').update({
        plan:                'free',
        subscription_plan:   'free',
        subscription_status: 'cancelled',
        payment_method:      null,
        next_billed_at:      null,
      }).eq('id', userId);

      console.log(`[paddle-webhook] 구독 취소 — userId:${userId}`);
    }

    if (event_type === 'subscription.updated' && userId && planName) {
      const isActive = data.status === 'active';
      await adminClient.from('users').update({
        plan:                isActive ? planName : 'free',
        subscription_plan:   planName,
        subscription_status: isActive ? 'active' : data.status,
      }).eq('id', userId);

      console.log(`[paddle-webhook] 구독 업데이트 — userId:${userId} status:${data.status}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[paddle-webhook] 오류:', e);
    return NextResponse.json({ ok: true }); // 재시도 방지용 200
  }
}
