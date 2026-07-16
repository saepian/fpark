// Dodo Payments 서버 사이드 API 래퍼 (카드결제) — 공식 SDK(dodopayments) 사용.
// 테스트 모드: DODO_PAYMENTS_ENVIRONMENT가 'live_mode'가 아니면 항상 test_mode로 폴백
// (오타로 실수로 라이브 결제가 나가는 사고 방지 — 명시적으로 'live_mode'를 써야만 전환됨).

import DodoPayments from 'dodopayments';

let _client: DodoPayments | null = null;

function client(): DodoPayments {
  if (!_client) {
    _client = new DodoPayments({
      bearerToken: process.env.DODO_PAYMENTS_API_KEY,
      webhookKey:  process.env.DODO_PAYMENTS_WEBHOOK_KEY,
      environment: process.env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode' ? 'live_mode' : 'test_mode',
    });
  }
  return _client;
}

function wrapError(action: string, error: unknown): never {
  if (error instanceof DodoPayments.APIError) {
    throw new Error(`Dodo ${action} 실패 (${error.status}): ${error.message}`);
  }
  throw new Error(`Dodo ${action} 실패: ${error instanceof Error ? error.message : String(error)}`);
}

// ── product_id 매핑 ───────────────────────────────────────────────────────────
// Dodo는 PortOne(빌링키+임의금액)과 달리 상품 카탈로그 기반 — 가격 자체는 Dodo
// 대시보드에 등록된 상품 설정이 진실源이고, 여기서는 그 상품을 가리키는 product_id만
// 결정한다. 반드시 lib/payment-constants.ts의 PLAN_AMOUNTS와 동일한 금액으로
// 대시보드에 등록되어 있어야 함(1단계 참고).

export type DodoPlan = 'basic' | 'pro';
export type BillingCycle = 'monthly' | 'annual';

const PRODUCT_ID_ENV_KEYS: Record<DodoPlan, Record<BillingCycle, string>> = {
  basic: { monthly: 'DODO_PRODUCT_ID_BASIC_MONTHLY', annual: 'DODO_PRODUCT_ID_BASIC_ANNUAL' },
  pro:   { monthly: 'DODO_PRODUCT_ID_PRO_MONTHLY',   annual: 'DODO_PRODUCT_ID_PRO_ANNUAL' },
};

export function mapPlanToProductId(plan: DodoPlan, billingCycle: BillingCycle): string {
  const envKey = PRODUCT_ID_ENV_KEYS[plan][billingCycle];
  const productId = process.env[envKey];
  if (!productId) {
    throw new Error(`Dodo product_id 미설정 — ${envKey} 환경변수를 확인하세요.`);
  }
  return productId;
}

// ── 체크아웃 세션 생성 ─────────────────────────────────────────────────────────
// 클라이언트는 금액을 보내지 않는다(보내도 무시) — plan/billingCycle로 서버가
// product_id를 자체 결정하는 것 자체가 금액 검증이다. metadata에 user_id를 실어
// 두지만(웹훅에 그대로 돌아온다는 보장이 문서상 불명확), 실제 유저 매칭은 3/4단계에서
// session_id 기반 pending 레코드 역매칭으로 처리 — 여기선 이중 안전망 차원.

export interface CreateCheckoutSessionParams {
  plan:         DodoPlan;
  billingCycle: BillingCycle;
  userId:       string;
  userEmail?:   string;
  returnUrl?:   string;
}

export interface CheckoutSessionResult {
  sessionId:   string;
  checkoutUrl: string;
}

export async function createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
  const { plan, billingCycle, userId, userEmail, returnUrl } = params;
  const productId = mapPlanToProductId(plan, billingCycle);

  try {
    const response = await client().checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer:     userEmail ? { email: userEmail } : undefined,
      metadata:     { user_id: userId, plan, billing_cycle: billingCycle },
      return_url:   returnUrl,
    });

    if (!response.checkout_url) {
      throw new Error(`checkout_url 없음 (session_id: ${response.session_id})`);
    }
    return { sessionId: response.session_id, checkoutUrl: response.checkout_url };
  } catch (error) {
    wrapError('체크아웃 세션 생성', error);
  }
}

// ── 구독/결제 조회 ─────────────────────────────────────────────────────────────
// 웹훅 바디를 그대로 신뢰하지 않고 재조회한다 — lib/portone.ts의 getPayment()와
// 동일한 컨벤션(4단계에서 사용).

export async function getSubscription(subscriptionId: string) {
  try {
    return await client().subscriptions.retrieve(subscriptionId);
  } catch (error) {
    wrapError('구독 조회', error);
  }
}

export async function getPayment(paymentId: string) {
  try {
    return await client().payments.retrieve(paymentId);
  } catch (error) {
    wrapError('결제 조회', error);
  }
}

// ── 구독 취소 ─────────────────────────────────────────────────────────────────
// immediate: 즉시취소(환불대상 — subscription/cancel의 refundEligible=true 케이스)
// next_billing_date: 현재 결제 주기 끝까지는 유지, 다음 결제일에 취소(해지예약 케이스)

export type CancelMode = 'immediate' | 'next_billing_date';

export async function cancelSubscription(subscriptionId: string, mode: CancelMode) {
  try {
    const body = mode === 'immediate'
      ? { status: 'cancelled' as const }
      : { cancel_at_next_billing_date: true };
    return await client().subscriptions.update(subscriptionId, body);
  } catch (error) {
    wrapError('구독 취소', error);
  }
}

// ── 환불 ─────────────────────────────────────────────────────────────────────
// Dodo refunds.create()에는 top-level amount 파라미터가 없다 — 전액환불은 items를
// 생략, 부분환불은 items:[{item_id, amount}] 품목 단위로만 가능하다. item_id는
// retrieveLineItems()로 별도 조회해야 함(우리 체크아웃은 상품 1개뿐이라 첫 라인아이템을
// 그대로 씀). 환불은 비동기일 수 있어(Refund.status: pending/review/succeeded/failed)
// 이 함수의 성공 == 환불 완료가 아니다 — 실제 완료는 refund.succeeded 웹훅으로 확인한다.

export async function refundPayment(paymentId: string, amount?: number, reason?: string) {
  try {
    if (amount == null) {
      return await client().refunds.create({ payment_id: paymentId, reason });
    }

    const lineItems = await client().payments.retrieveLineItems(paymentId);
    const item = lineItems.items[0];
    if (!item) {
      throw new Error(`환불 대상 라인아이템 없음 (paymentId: ${paymentId})`);
    }
    return await client().refunds.create({
      payment_id: paymentId,
      items:      [{ item_id: item.items_id, amount }],
      reason,
    });
  } catch (error) {
    wrapError('환불 처리', error);
  }
}

// ── 웹훅 서명 검증 ─────────────────────────────────────────────────────────────
// client.webhooks.unwrap()이 서명 검증(HMAC-SHA256, webhook-id/webhook-signature/
// webhook-timestamp 헤더)과 이벤트 파싱을 함께 처리 — 실패 시 throw.

export function verifyWebhookSignature(body: string, headers: Record<string, string>) {
  return client().webhooks.unwrap(body, { headers });
}
