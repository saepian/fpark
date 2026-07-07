// 관리자용 — 계좌이체(무통장입금) 신청 승인/거절
// 승인 시 subscription_plan/subscription_status/subscription_start_date를 갱신한다.
// 주의: 어제 만든 크레딧 시스템(stock_credits/portfolio_credits, lib/credits.ts)과는
// 완전히 별개 로직 — 이 라우트는 credits 컬럼을 전혀 건드리지 않는다.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-auth';
import { PLAN_AMOUNTS } from '@/lib/payment-constants';
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

function buildApprovalEmailHtml(planName: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finance Park 결제 확인</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:40px 20px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:800;color:#818cf8">Finance Park</div>
    </div>
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:14px;padding:28px 24px;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">✅</p>
      <p style="margin:0 0 8px;color:#e2e8f0;font-size:16px;font-weight:700">입금 확인이 완료되었습니다</p>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.7">
        ${planName} 구독이 정상적으로 활성화되었습니다.<br />
        지금 바로 fpark.com에서 이용해보세요.
      </p>
      <a href="https://fpark.com" style="display:inline-block;margin-top:20px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#fff;text-decoration:none;padding:11px 26px;border-radius:10px;font-size:13.5px;font-weight:600">
        fpark.com 바로가기 →
      </a>
    </div>
    <p style="text-align:center;color:#334155;font-size:11px;margin-top:24px">Finance Park · saepian2@gmail.com</p>
  </div>
</body>
</html>`;
}

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
  const { action } = await request.json() as { action?: 'approve' | 'reject' };
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: '잘못된 action' }, { status: 400 });
  }

  const { data: reqRow, error: fetchError } = await adminClient
    .from('bank_transfer_requests')
    .select('id, user_id, plan, is_annual, amount, status')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !reqRow) {
    return NextResponse.json({ error: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });
  }
  if (reqRow.status !== 'pending') {
    return NextResponse.json({ error: `이미 처리된 신청입니다 (상태: ${reqRow.status})` }, { status: 409 });
  }

  if (action === 'reject') {
    const { error } = await adminClient
      .from('bank_transfer_requests')
      .update({ status: 'rejected', processed_at: new Date().toISOString(), processed_by: user.email })
      .eq('id', id);
    if (error) {
      console.error('[admin/bank-transfers] 거절 처리 실패:', error);
      return NextResponse.json({ error: '처리 실패' }, { status: 500 });
    }
    console.log(`[admin/bank-transfers] 거절 — requestId:${id} by:${user.email}`);
    return NextResponse.json({ ok: true, status: 'rejected' });
  }

  // ── 승인 ────────────────────────────────────────────────────────────────
  const plan = reqRow.plan as 'basic' | 'pro';
  const nextBilledAt = new Date();
  nextBilledAt.setMonth(nextBilledAt.getMonth() + (reqRow.is_annual ? 12 : 1));

  // subscription_start_date는 최초 구독 시점에만 고정 (app/api/payment/verify와 동일한 가드)
  const { data: existingUserRow } = await adminClient
    .from('users')
    .select('subscription_start_date, email')
    .eq('id', reqRow.user_id)
    .maybeSingle();

  const { error: updateError } = await adminClient.from('users').update({
    plan,
    subscription_plan:   plan,
    subscription_status: 'active',
    next_billed_at:      nextBilledAt.toISOString(),
    ...(existingUserRow?.subscription_start_date ? {} : { subscription_start_date: new Date().toISOString() }),
  }).eq('id', reqRow.user_id);

  if (updateError) {
    console.error('[admin/bank-transfers] users 업데이트 실패:', updateError);
    return NextResponse.json({ error: '구독 활성화 실패' }, { status: 500 });
  }

  const { error: statusError } = await adminClient
    .from('bank_transfer_requests')
    .update({ status: 'approved', processed_at: new Date().toISOString(), processed_by: user.email })
    .eq('id', id);
  if (statusError) {
    console.error('[admin/bank-transfers] 상태 업데이트 실패(구독은 이미 활성화됨):', statusError);
    // 유저 플랜은 이미 활성화됐으므로 에러를 반환하지 않고 로그만 남김
  }

  // 승인 확인 이메일 (실패해도 승인 자체는 유지 — 이메일은 부가 기능)
  const email = existingUserRow?.email;
  if (email && process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from:    'Finance Park <noreply@fpark.com>',
        to:      [email],
        subject: '[fpark] 입금 확인 완료 — 구독이 활성화되었습니다',
        html:    buildApprovalEmailHtml(PLAN_AMOUNTS[plan].name),
      });
      console.log(`[admin/bank-transfers] 승인 이메일 발송 완료: ${email}`);
    } catch (e) {
      console.error('[admin/bank-transfers] 승인 이메일 발송 실패:', e instanceof Error ? e.message : e);
    }
  }

  console.log(`[admin/bank-transfers] 승인 — requestId:${id} userId:${reqRow.user_id} plan:${plan} by:${user.email}`);
  return NextResponse.json({ ok: true, status: 'approved' });
}
