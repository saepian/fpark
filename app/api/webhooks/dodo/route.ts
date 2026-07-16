// Dodo Payments 웹훅 수신 — 서명 검증 실패는 401로 즉시 차단(body 파싱 전에 조차 하지
// 않음). 검증 통과 후 내부 처리가 실패하면 200이 아니라 500을 반환해 Dodo가 재시도하도록
// 한다 — idempotency(activateDodoPayment의 pending 상태 체크)가 이미 확보돼 있어 재시도는
// 안전하고, 200으로 삼켜버리면 결제는 됐는데 활성화가 안 된 채 조용히 묻힐 수 있다.

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { verifyWebhookSignature } from '@/lib/dodo';
import { activateDodoPayment } from '@/lib/dodo-payment-approval';
import { buildRefundCompletedEmailHtml } from '@/lib/refund';
import { sendBankTransferEmail } from '@/lib/bank-transfer';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let event: ReturnType<typeof verifyWebhookSignature>;
  try {
    const headers = {
      'webhook-id':        request.headers.get('webhook-id') ?? '',
      'webhook-signature':  request.headers.get('webhook-signature') ?? '',
      'webhook-timestamp':  request.headers.get('webhook-timestamp') ?? '',
    };
    event = verifyWebhookSignature(rawBody, headers);
  } catch (error) {
    console.warn('[webhooks/dodo] 서명 검증 실패:', error);
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  try {
    switch (event.type) {
      case 'payment.succeeded': {
        const payment = event.data;
        if (!payment.checkout_session_id) {
          console.warn('[webhooks/dodo] payment.succeeded — checkout_session_id 없음, skip:', payment.payment_id);
          break;
        }
        const result = await activateDodoPayment({
          sessionId:      payment.checkout_session_id,
          paymentId:      payment.payment_id,
          subscriptionId: payment.subscription_id ?? null,
          totalAmount:    payment.total_amount,
        });
        if (!result.ok) {
          console.error('[webhooks/dodo] 활성화 실패:', result.error);
          return NextResponse.json({ error: 'activation failed' }, { status: 500 });
        }
        break;
      }

      case 'payment.failed': {
        const payment = event.data;
        if (!payment.checkout_session_id) {
          // 갱신 결제 실패로 추정(첫 결제만 checkout_session_id를 남김) — 이번 스코프 밖.
          console.log('[webhooks/dodo] payment.failed — checkout_session_id 없음, skip:', payment.payment_id);
          break;
        }
        const { error } = await adminClient
          .from('payments')
          .update({ status: 'failed' })
          .eq('payment_id', payment.checkout_session_id)
          .eq('status', 'pending');
        if (error) {
          console.error('[webhooks/dodo] payment.failed 처리 실패:', error);
          return NextResponse.json({ error: 'processing failed' }, { status: 500 });
        }
        break;
      }

      case 'subscription.renewed': {
        const subscription = event.data;
        const { data: updated, error } = await adminClient
          .from('users')
          .update({ next_billed_at: subscription.next_billing_date, subscription_status: 'active' })
          .eq('dodo_subscription_id', subscription.subscription_id)
          .select('id');
        if (error) {
          console.error('[webhooks/dodo] subscription.renewed 처리 실패:', error);
          return NextResponse.json({ error: 'processing failed' }, { status: 500 });
        }
        if (!updated || updated.length === 0) {
          console.warn('[webhooks/dodo] subscription.renewed — 매칭되는 유저 없음:', subscription.subscription_id);
        }
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.expired': {
        const subscription = event.data;
        const { data: updated, error } = await adminClient
          .from('users')
          .update({
            plan:                 'free',
            subscription_plan:    'free',
            subscription_status:  'cancelled',
            next_billed_at:       null,
            dodo_subscription_id: null,
          })
          .eq('dodo_subscription_id', subscription.subscription_id)
          .select('id');
        if (error) {
          console.error(`[webhooks/dodo] ${event.type} 처리 실패:`, error);
          return NextResponse.json({ error: 'processing failed' }, { status: 500 });
        }
        if (!updated || updated.length === 0) {
          console.warn(`[webhooks/dodo] ${event.type} — 매칭되는 유저 없음:`, subscription.subscription_id);
        }
        break;
      }

      case 'refund.succeeded':
      case 'refund.failed': {
        // 6단계: subscription/cancel이 refundPayment() 호출 성공 시 refund_requests에
        // dodo_refund_id를 심어뒀다 — 이걸로 역매칭. refund_status='requested'인 것만
        // 갱신해서(이미 처리됨=완료/실패된 건 스킵) idempotent하게 만든다.
        const refund = event.data;
        const newStatus = event.type === 'refund.succeeded' ? 'completed' : 'failed';
        const { data: updated, error } = await adminClient
          .from('refund_requests')
          .update({ refund_status: newStatus, processed_at: new Date().toISOString(), processed_by: 'dodo-webhook' })
          .eq('dodo_refund_id', refund.refund_id)
          .eq('refund_status', 'requested')
          .select('id, user_id, refund_amount');
        if (error) {
          console.error(`[webhooks/dodo] ${event.type} 처리 실패:`, error);
          return NextResponse.json({ error: 'processing failed' }, { status: 500 });
        }
        if (!updated || updated.length === 0) {
          console.warn(`[webhooks/dodo] ${event.type} — 매칭되는 refund_requests 없음(또는 이미 처리됨):`, refund.refund_id);
          break;
        }
        if (event.type === 'refund.succeeded') {
          const row = updated[0];
          const { data: userRow } = await adminClient.from('users').select('email').eq('id', row.user_id).maybeSingle();
          if (userRow?.email) {
            await sendBankTransferEmail({
              to:      userRow.email,
              subject: '[fpark] 환불이 완료되었습니다',
              html:    buildRefundCompletedEmailHtml(row.refund_amount, 'DODO'),
              logTag:  'webhooks/dodo',
            });
          }
        }
        break;
      }

      default:
        // 관심 없는 이벤트(dispute/credit/dunning 등)는 무시
        break;
    }
  } catch (error) {
    console.error('[webhooks/dodo] 처리 중 예외:', error);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
