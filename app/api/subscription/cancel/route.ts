// 구독 취소/환불 — 계좌이체 특성상 자동 송금이 불가능해 "계산까지만" 자동화.
// GET: mypage 확인 모달에 보여줄 예상 환불액 미리보기(쓰기 없음).
// POST: 실제 취소 접수 — refund_requests에 기록하고, 7일 이내면 즉시 해지(cancelled),
//   7일 초과면 해지예약(pending_cancellation, 다음 결제일에 cron/bank-transfer-expire가 free로 전환).
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import {
  calculateRefund, calculateAnnualRefund, buildRefundRequestAdminEmailHtml,
  buildCancelRefundRequestedEmailHtml, buildCancelReservedEmailHtml,
} from '@/lib/refund';
import { sendBankTransferEmail } from '@/lib/bank-transfer';
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

async function loadCancellableUser(userId: string) {
  const { data: userRow } = await adminClient
    .from('users')
    .select('email, plan, subscription_status, subscription_start_date, next_billed_at, is_annual')
    .eq('id', userId)
    .maybeSingle();

  if (!userRow || userRow.plan === 'free') {
    return { error: '구독 중인 플랜이 없습니다.' as const };
  }
  if (userRow.subscription_status === 'pending_cancellation') {
    return { error: '이미 해지 예약된 상태입니다.' as const };
  }
  if (!userRow.subscription_start_date) {
    return { error: '구독 시작일 정보를 찾을 수 없어 처리할 수 없습니다.' as const };
  }

  const plan = userRow.plan as 'basic' | 'pro';

  const [{ count: stockCount }, { count: portfolioCount }, { data: lastApproved }] = await Promise.all([
    adminClient
      .from('stock_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', userRow.subscription_start_date),
    adminClient
      .from('portfolio_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', userRow.subscription_start_date),
    adminClient
      .from('bank_transfer_requests')
      .select('amount, is_annual')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .order('processed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const paidAmount = lastApproved?.amount ?? PLAN_AMOUNTS[plan].monthly;
  // 결제 주기는 실제 승인된 신청 건(bank_transfer_requests) 기준이 우선 —
  // amount와 같은 행에서 나와야 프로레이션 계산이 서로 어긋나지 않는다.
  // 해당 행이 없는 예외 상황(레거시 데이터 등)에서만 users.is_annual로 폴백.
  const isAnnual = lastApproved?.is_annual ?? userRow.is_annual ?? false;
  const subscriptionStartDate = new Date(userRow.subscription_start_date);

  const calcParams = {
    paidAmount,
    subscriptionStartDate,
    cancelAt: new Date(),
    plan,
    diagnosisCount: stockCount ?? 0,
    portfolioCount: portfolioCount ?? 0,
  };
  const calc = isAnnual ? calculateAnnualRefund(calcParams) : calculateRefund(calcParams);

  return {
    userRow, plan, paidAmount, isAnnual, subscriptionStartDate, calc,
  };
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await loadCancellableUser(user.id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { plan, paidAmount, calc, userRow } = result;
  return NextResponse.json({
    ok: true,
    plan,
    paidAmount,
    usageDetected:  calc.usageDetected,
    elapsedDays:    calc.elapsedDays,
    refundEligible: calc.refundEligible,
    refundAmount:   calc.refundAmount,
    reasonText:     calc.reasonText,
    nextBilledAt:   userRow.next_billed_at,
  });
}

export async function POST(request: NextRequest) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await loadCancellableUser(user.id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const { plan, paidAmount, isAnnual, calc, subscriptionStartDate, userRow } = result;

  const body = await request.json().catch(() => ({})) as {
    refundAccountBank?: string; refundAccountNumber?: string; refundAccountHolder?: string;
  };

  if (calc.refundAmount > 0) {
    const { refundAccountBank, refundAccountNumber, refundAccountHolder } = body;
    if (!refundAccountBank || !refundAccountNumber || !refundAccountHolder) {
      return NextResponse.json({ error: '환불받을 계좌 정보를 모두 입력해주세요.' }, { status: 400 });
    }
  }

  // 월간(비율 기반)과 연간(정가 개월수 기반)은 계산 방식이 달라 elapsed_ratio/usage_ratio/final_ratio
  // 의미가 다르다 — 연간은 해당 개념이 없어 elapsed_ratio/usage_ratio는 0, final_ratio만
  // "전체 결제액 대비 소급 차감액 비율"로 환산해 감사 목적으로 남긴다.
  const ratioFields = 'monthsUsed' in calc
    ? { usage_ratio: 0, elapsed_ratio: 0, final_ratio: paidAmount > 0 ? Math.min(1, calc.retroactiveCost / paidAmount) : 0 }
    : { usage_ratio: calc.usageRatio, elapsed_ratio: calc.elapsedRatio, final_ratio: calc.finalRatio };

  const { error: insertError } = await adminClient.from('refund_requests').insert({
    user_id:                  user.id,
    plan,
    paid_amount:              paidAmount,
    subscription_start_date:  subscriptionStartDate.toISOString(),
    usage_detected:           calc.usageDetected,
    diagnosis_count:          calc.diagnosisCount,
    portfolio_count:          calc.portfolioCount,
    usage_ratio:              ratioFields.usage_ratio,
    elapsed_ratio:            ratioFields.elapsed_ratio,
    final_ratio:              ratioFields.final_ratio,
    elapsed_days:             calc.elapsedDays,
    refund_amount:            calc.refundAmount,
    refund_reason:            calc.reasonText,
    refund_status:            calc.refundAmount > 0 ? 'requested' : 'none',
    refund_account_bank:      calc.refundAmount > 0 ? body.refundAccountBank   : null,
    refund_account_number:    calc.refundAmount > 0 ? body.refundAccountNumber : null,
    refund_account_holder:    calc.refundAmount > 0 ? body.refundAccountHolder : null,
  });

  if (insertError) {
    console.error('[subscription/cancel] refund_requests insert 실패:', insertError);
    return NextResponse.json({ error: '취소 신청 저장 실패' }, { status: 500 });
  }

  const userUpdate = calc.refundEligible
    ? {
        plan:                     'free',
        subscription_plan:        'free',
        subscription_status:      'cancelled',
        next_billed_at:           null,
        subscription_start_date:  null,
        is_annual:                false,
      }
    : {
        subscription_status: 'pending_cancellation',
      };

  const { error: updateError } = await adminClient.from('users').update(userUpdate).eq('id', user.id);
  if (updateError) {
    console.error('[subscription/cancel] users 업데이트 실패:', updateError);
    return NextResponse.json({ error: '구독 상태 변경 실패' }, { status: 500 });
  }

  if (calc.refundAmount > 0 && process.env.ADMIN_EMAIL) {
    await sendBankTransferEmail({
      to:      process.env.ADMIN_EMAIL,
      subject: `[fpark] 환불 요청 접수 — ${userRow.email ?? user.email} (${calc.refundAmount.toLocaleString()}원)`,
      html:    buildRefundRequestAdminEmailHtml({
        userEmail:     userRow.email ?? user.email ?? '',
        refundAmount:  calc.refundAmount,
        reasonText:    calc.reasonText,
        bank:          body.refundAccountBank!,
        accountNumber: body.refundAccountNumber!,
        accountHolder: body.refundAccountHolder!,
      }),
      logTag: 'subscription/cancel',
    });
  }

  // 관리자 알림과 별도로, 취소를 신청한 유저 본인에게도 확인 메일 발송
  const userEmail = userRow.email ?? user.email;
  if (userEmail) {
    if (calc.refundEligible) {
      await sendBankTransferEmail({
        to:      userEmail,
        subject: '[fpark] 구독이 취소되었습니다',
        html:    buildCancelRefundRequestedEmailHtml(calc.refundAmount),
        logTag:  'subscription/cancel',
      });
    } else {
      const nextBilledAtStr = userRow.next_billed_at
        ? new Date(userRow.next_billed_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' })
        : '현재 결제 기간 종료일';
      await sendBankTransferEmail({
        to:      userEmail,
        subject: '[fpark] 구독 취소가 접수되었습니다',
        html:    buildCancelReservedEmailHtml(nextBilledAtStr),
        logTag:  'subscription/cancel',
      });
    }
  }

  console.log(
    `[subscription/cancel] userId:${user.id} plan:${plan} isAnnual:${isAnnual} elapsedDays:${calc.elapsedDays} ` +
    `diagnosisCount:${calc.diagnosisCount} portfolioCount:${calc.portfolioCount} ` +
    `finalRatio:${ratioFields.final_ratio} refundAmount:${calc.refundAmount} eligible:${calc.refundEligible}`,
  );

  return NextResponse.json({
    ok: true,
    refundEligible: calc.refundEligible,
    refundAmount:   calc.refundAmount,
    reasonText:     calc.reasonText,
  });
}
