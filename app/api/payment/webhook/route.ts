// PortOne 결제 웹훅 수신 처리
// PortOne 콘솔 → 결제알림(Webhook) URL: https://fpark.com/api/payment/webhook
// 결제 상태 변경(취소·환불·실패)을 실시간으로 DB에 반영

import { NextRequest, NextResponse } from 'next/server';
import { createClient }               from '@supabase/supabase-js';
import { getPayment }                 from '@/lib/portone';

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type WebhookPayload = {
  type:      string;  // 'Transaction.Paid' | 'Transaction.Cancelled' | 'Transaction.Failed' 등
  timestamp: string;
  data: {
    paymentId:  string;
    transactionId?: string;
  };
};

export async function POST(request: NextRequest) {
  try {
    // PortOne V2 웹훅 서명 검증
    // PortOne 콘솔에서 설정한 API Secret 과 Authorization 헤더를 비교
    const apiSecret = process.env.PORTONE_API_SECRET;
    if (!apiSecret) {
      console.error('[webhook] PORTONE_API_SECRET 미설정');
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    const authHeader = request.headers.get('authorization') ?? '';
    if (authHeader !== `PortOne ${apiSecret}`) {
      console.warn('[webhook] 서명 검증 실패 — 무단 요청 차단');
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await request.json() as WebhookPayload;
    console.log('[webhook] 수신:', body.type, body.data?.paymentId);

    const { paymentId } = body.data ?? {};
    if (!paymentId) {
      return NextResponse.json({ ok: true }); // 알 수 없는 이벤트 무시
    }

    // PortOne에서 최신 결제 상태 재조회 (웹훅 바디를 그대로 신뢰하지 않음)
    const payment = await getPayment(paymentId);

    const statusMap: Record<string, string> = {
      PAID:                    'paid',
      FAILED:                  'failed',
      CANCELLED:               'cancelled',
      PARTIAL_CANCELLED:       'partial_cancelled',
      PAY_PENDING:             'pending',
      VIRTUAL_ACCOUNT_ISSUED:  'pending',
    };
    const dbStatus = statusMap[payment.status] ?? payment.status.toLowerCase();

    // payments 테이블 상태 업데이트
    const { data: existing } = await adminClient
      .from('payments')
      .select('id, user_id, plan, payment_method, is_annual, status')
      .eq('payment_id', paymentId)
      .maybeSingle();

    if (!existing) {
      // 알려지지 않은 paymentId — 무시
      return NextResponse.json({ ok: true });
    }

    await adminClient
      .from('payments')
      .update({ status: dbStatus })
      .eq('payment_id', paymentId);

    // 계좌이체(가상계좌) 입금 완료 — 카드 빌링키와 달리 발급 시점엔 구독이
    // 활성화되지 않으므로(자동 출금이 아님), 입금 확인 웹훅에서 최초 활성화 처리
    if (payment.status === 'PAID' && existing.payment_method === 'VIRTUAL_ACCOUNT' && existing.status !== 'paid') {
      const nextBilledAt = new Date();
      nextBilledAt.setMonth(nextBilledAt.getMonth() + (existing.is_annual ? 12 : 1));

      await adminClient.from('users').update({
        plan:                 existing.plan,
        subscription_plan:    existing.plan,
        subscription_status:  'active',
        payment_method:       'VIRTUAL_ACCOUNT',
        next_billed_at:       nextBilledAt.toISOString(),
      }).eq('id', existing.user_id);

      console.log(`[webhook] 계좌이체 입금 확인, 구독 활성화 — userId:${existing.user_id} plan:${existing.plan}`);
    }

    // 취소·실패 시 사용자 플랜 다운그레이드
    if (payment.status === 'CANCELLED' || payment.status === 'FAILED') {
      await adminClient.from('users').update({
        plan:                'free',
        subscription_plan:   'free',
        subscription_status: payment.status === 'CANCELLED' ? 'cancelled' : 'failed',
      }).eq('id', existing.user_id);

      console.log(`[webhook] 플랜 다운그레이드 — userId:${existing.user_id} status:${dbStatus}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[webhook] 오류:', e);
    // 웹훅 재시도 방지용 200 반환
    return NextResponse.json({ ok: true });
  }
}
