// Paddle 구독 웹훅 수신 처리
// Paddle 대시보드 → Notifications → Webhook URL: https://fpark.com/api/payment/paddle-webhook
// 구독 생성/취소/갱신 이벤트를 받아 DB 사용자 플랜을 업데이트

import { NextRequest, NextResponse } from 'next/server';
import { createClient }               from '@supabase/supabase-js';
import crypto                         from 'crypto';
import type { Database }              from '@/lib/database.types';

const PLAN_AMOUNTS = {
  basic: { monthly: 9900,  annual: 95040  },
  pro:   { monthly: 19900, annual: 191040 },
};

const CREDIT_AMOUNTS: Record<string, number> = {
  stock:     1000,
  portfolio: 1900,
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
  userId?:     string;
  plan?:       string;
  isAnnual?:   string;
  creditType?: string;
};

type PaddleEvent = {
  event_type:  string;
  occurred_at: string;
  data: {
    id:          string;        // subscription ID or transaction ID
    status:      string;
    customer_id: string;
    customer?:   { email?: string };
    items?: Array<{ price: { id: string } }>;
    custom_data?: PaddleCustomData;
  };
};

// Paddle 웹훅 payload에 customer 엔티티가 포함되어 있지 않으면
// Paddle REST API로 customer_id → email을 직접 조회한다.
async function fetchPaddleCustomerEmail(customerId: string): Promise<string | null> {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey || !customerId) return null;
  try {
    const res = await fetch(`https://api.paddle.com/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.email ?? null;
  } catch (e) {
    console.error('[paddle-webhook] Paddle customer 조회 실패:', e);
    return null;
  }
}

// email 기준으로 기존 Supabase 유저를 찾고, 없으면 신규 생성 후 비밀번호 설정 메일 발송.
// naver/callback, forgot-password 라우트와 동일한 패턴 재사용.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveOrCreateUser(
  adminClient: any,
  email: string,
): Promise<{ userId: string; isNewUser: boolean } | null> {
  const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) {
    console.error('[paddle-webhook] listUsers 실패:', listError);
    return null;
  }

  const existing = (listData?.users ?? []).find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing) return { userId: existing.id, isNewUser: false };

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createError || !created.user) {
    console.error('[paddle-webhook] createUser 실패:', createError);
    return null;
  }

  const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://fpark.com/auth/callback?next=/auth/reset-password',
  });
  if (resetError) {
    console.error('[paddle-webhook] resetPasswordForEmail 실패:', resetError);
  }

  return { userId: created.user.id, isNewUser: true };
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[paddle-webhook] PADDLE_WEBHOOK_SECRET 미설정');
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const PRICE_TO_PLAN: Record<string, 'basic' | 'pro'> = {
      [process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_BASIC        ?? '']: 'basic',
      [process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_BASIC_ANNUAL ?? '']: 'basic',
      [process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO          ?? '']: 'pro',
      [process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_ANNUAL   ?? '']: 'pro',
    };

    const PRICE_TO_CREDIT: Record<string, 'stock' | 'portfolio'> = {
      [process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_CREDIT_STOCK     ?? '']: 'stock',
      [process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_CREDIT_PORTFOLIO ?? '']: 'portfolio',
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

    const priceId  = data.items?.[0]?.price?.id ?? '';
    const planName = (data.custom_data?.plan as 'basic' | 'pro' | undefined)
                  ?? PRICE_TO_PLAN[priceId];
    const isAnnual = data.custom_data?.isAnnual === 'true';

    // 이메일 기준으로 유저를 확정한다 — 게스트 체크아웃(비로그인)은 custom_data.userId가
    // 없으므로, Paddle customer_id → email을 조회해 기존/신규 유저를 매핑한다.
    const email = data.customer?.email
      ?? (data.customer_id ? await fetchPaddleCustomerEmail(data.customer_id) : null);

    let userId: string | undefined = data.custom_data?.userId;
    let isNewUser = false;
    if (email) {
      const resolved = await resolveOrCreateUser(adminClient, email);
      if (resolved) {
        userId = resolved.userId;
        isNewUser = resolved.isNewUser;
      }
    }
    if (!userId) {
      console.warn('[paddle-webhook] 유저 매핑 실패 — email/customData.userId 모두 없음:', data.id);
    }

    if (event_type === 'subscription.created' && userId && planName) {
      const amounts      = PLAN_AMOUNTS[planName];
      const amount       = isAnnual ? amounts.annual : amounts.monthly;
      const nextBilledAt = new Date();
      nextBilledAt.setMonth(nextBilledAt.getMonth() + (isAnnual ? 12 : 1));

      const { data: insertedPayment } = await adminClient.from('payments').upsert(
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
      ).select();

      if (insertedPayment && insertedPayment.length > 0) {
        await adminClient.from('users').update({
          plan:                planName,
          subscription_plan:   planName,
          subscription_status: 'active',
          payment_method:      'PADDLE',
          next_billed_at:      nextBilledAt.toISOString(),
        }).eq('id', userId);

        console.log(`[paddle-webhook] 구독 생성 — userId:${userId} plan:${planName} annual:${isAnnual} newUser:${isNewUser}`);
      } else {
        console.log(`[paddle-webhook] 중복 이벤트 무시 — payment_id:paddle_${data.id}`);
      }
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

    // 1회권 결제 완료 — users.stock_credits / portfolio_credits 증가
    if (event_type === 'transaction.completed' && userId) {
      const creditType = (data.custom_data?.creditType as 'stock' | 'portfolio' | undefined)
                      ?? PRICE_TO_CREDIT[priceId];
      if (creditType === 'stock' || creditType === 'portfolio') {
        const col    = creditType === 'stock' ? 'stock_credits' : 'portfolio_credits';
        const amount = CREDIT_AMOUNTS[creditType];

        // 결제 기록 저장
        const { data: insertedPayment } = await adminClient.from('payments').upsert(
          {
            user_id:        userId,
            plan:           `credit_${creditType}`,
            amount,
            payment_id:     `paddle_${data.id}`,
            status:         'paid',
            payment_method: 'PADDLE',
            is_annual:      false,
          },
          { onConflict: 'payment_id', ignoreDuplicates: true },
        ).select();

        if (insertedPayment && insertedPayment.length > 0) {
          // 크레딧 증가 (RPC 없이 atomic increment: current + 1)
          const { data: userRow } = await adminClient
            .from('users')
            .select(col)
            .eq('id', userId)
            .maybeSingle();
          const current = (userRow as Record<string, number> | null)?.[col] ?? 0;
          await adminClient
            .from('users')
            .update({ [col]: current + 1 })
            .eq('id', userId);

          console.log(`[paddle-webhook] 1회권 충전 — userId:${userId} type:${creditType} col:${col}`);
        } else {
          console.log(`[paddle-webhook] 중복 이벤트 무시 — payment_id:paddle_${data.id}`);
        }
      }
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
