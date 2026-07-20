// 관리자용 — 환불 처리
// action='complete': 관리자가 실제로 송금을 마친 뒤 완료 처리 + 유저에게 완료 안내 메일
// action='update_amount': 자동 계산된 금액이 틀렸다고 판단될 때 관리자가 직접 수정
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-auth';
import { buildRefundCompletedEmailHtml } from '@/lib/refund';
import { sendBankTransferEmail } from '@/lib/bank-transfer';
import type { Database } from '@/lib/database.types';

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

type Action = 'complete' | 'update_amount';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json() as { action?: Action; amount?: number };
  const { action } = body;
  if (action !== 'complete' && action !== 'update_amount') {
    return NextResponse.json({ error: '잘못된 action' }, { status: 400 });
  }

  const { data: reqRow, error: fetchError } = await adminClient
    .from('refund_requests')
    .select('id, user_id, refund_amount, refund_status, refund_account_bank')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !reqRow) {
    return NextResponse.json({ error: '환불 신청 내역을 찾을 수 없습니다.' }, { status: 404 });
  }

  if (action === 'update_amount') {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: '올바른 금액을 입력해주세요.' }, { status: 400 });
    }
    const { error } = await adminClient
      .from('refund_requests')
      .update({ refund_amount: Math.round(amount) })
      .eq('id', id);
    if (error) {
      console.error('[admin/refunds] 금액 수정 실패:', error);
      return NextResponse.json({ error: '수정 실패' }, { status: 500 });
    }
    console.log(`[admin/refunds] 금액 수정 — requestId:${id} amount:${amount} by:${user.email}`);
    return NextResponse.json({ ok: true, refundAmount: Math.round(amount) });
  }

  // ── 송금 완료 처리 ────────────────────────────────────────────────────────
  // Dodo 건(refund_account_bank가 없음 — 위 payment_method 판별과 동일 근거)은 카드로
  // 자동환불되는 대상이라 "송금 완료" 수동 처리 자체가 성립하지 않는다. 프론트에서
  // 버튼을 숨기지만 API를 직접 호출해 우회할 수 있으니 서버에서도 막는다 — 이 액션은
  // DB 상태만 completed로 바꿀 뿐 실제 카드 환불을 재시도하지 않으므로, 그대로 통과시키면
  // 고객은 환불을 못 받았는데 처리 완료로 잘못 기록되는 사고로 이어진다.
  if (reqRow.refund_account_bank === null) {
    return NextResponse.json(
      { error: 'Dodo 카드결제 환불 건은 이 액션으로 처리할 수 없습니다. Dodo 쪽에서 직접 재시도가 필요합니다.' },
      { status: 400 },
    );
  }

  if (reqRow.refund_status !== 'requested') {
    return NextResponse.json({ error: `이미 처리된 신청입니다 (상태: ${reqRow.refund_status})` }, { status: 409 });
  }

  const { error: updateError } = await adminClient
    .from('refund_requests')
    .update({ refund_status: 'completed', processed_at: new Date().toISOString(), processed_by: user.email })
    .eq('id', id);
  if (updateError) {
    console.error('[admin/refunds] 완료 처리 실패:', updateError);
    return NextResponse.json({ error: '처리 실패' }, { status: 500 });
  }

  const { data: userRow } = await adminClient.from('users').select('email').eq('id', reqRow.user_id).maybeSingle();
  if (userRow?.email) {
    await sendBankTransferEmail({
      to:      userRow.email,
      subject: '[fpark] 환불이 완료되었습니다',
      html:    buildRefundCompletedEmailHtml(reqRow.refund_amount),
      logTag:  'admin/refunds',
    });
  }

  console.log(`[admin/refunds] 송금완료 — requestId:${id} userId:${reqRow.user_id} amount:${reqRow.refund_amount} by:${user.email}`);
  return NextResponse.json({ ok: true, status: 'completed' });
}
