// PortOne V2 서버 사이드 유틸
// 테스트 모드: 실제 승인 없음. 운영 전환 시 .env만 교체.

const PORTONE_BASE = 'https://api.portone.io';

function authHeader() {
  return { Authorization: `PortOne ${process.env.PORTONE_API_SECRET}` };
}

// ── 결제 단건 조회 ────────────────────────────────────────────────────────────

export interface PortOnePayment {
  id:           string;
  status:       'PAID' | 'FAILED' | 'CANCELLED' | 'PARTIAL_CANCELLED' | 'PAY_PENDING';
  orderName:    string;
  amount:       { total: number; currency: string };
  method?:      { type: string };
  billingKey?:  string;
  customer?:    { id?: string; email?: string };
  paidAt?:      string;
  failedAt?:    string;
  cancelledAt?: string;
}

export async function getPayment(paymentId: string): Promise<PortOnePayment> {
  const res = await fetch(`${PORTONE_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: authHeader(),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PortOne getPayment 실패 (${res.status}): ${text}`);
  }
  return res.json();
}

// ── 빌링키 단건 결제 실행 ─────────────────────────────────────────────────────

export interface BillingKeyPaymentRequest {
  paymentId:  string;
  billingKey: string;
  orderName:  string;
  amount:     number;
  customerId: string;
  customerEmail?: string;
}

export interface BillingKeyPaymentResult {
  paymentId: string;
  status:    string;
  paidAt?:   string;
}

export async function payWithBillingKey(req: BillingKeyPaymentRequest): Promise<BillingKeyPaymentResult> {
  const res = await fetch(
    `${PORTONE_BASE}/payments/${encodeURIComponent(req.paymentId)}/billing-key`,
    {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        billingKey: req.billingKey,
        orderName:  req.orderName,
        amount:     { total: req.amount },
        currency:   'KRW',
        customer: {
          id:    req.customerId,
          email: req.customerEmail,
        },
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PortOne billingKey 결제 실패 (${res.status}): ${text}`);
  }
  const data = await res.json();
  return { paymentId: data.id ?? req.paymentId, status: data.status, paidAt: data.paidAt };
}

// ── 빌링키 조회 ───────────────────────────────────────────────────────────────

export async function getBillingKey(billingKey: string) {
  const res = await fetch(`${PORTONE_BASE}/billing-keys/${encodeURIComponent(billingKey)}`, {
    headers: authHeader(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`PortOne getBillingKey 실패 (${res.status})`);
  return res.json();
}
