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
import { cancelSubscription as cancelDodoSubscription, refundPayment as refundDodoPayment } from '@/lib/dodo';
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
    .select('email, plan, subscription_status, subscription_start_date, next_billed_at, is_annual, payment_method, dodo_subscription_id')
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
  const isDodo = userRow.payment_method === 'DODO';

  const [{ count: stockCount }, { count: portfolioCount }, { count: stockAnalysisCount }, { data: lastApproved }, { data: lastDodoPayment }] = await Promise.all([
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
      .from('stock_analysis_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('usage_date', userRow.subscription_start_date.split('T')[0]),
    adminClient
      .from('bank_transfer_requests')
      .select('amount, is_annual')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .order('processed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Dodo 유저는 bank_transfer_requests에 행이 없어(계좌이체를 아예 안 씀) 아래 lastApproved가
    // 항상 null이다 — payments에서 실제 결제 건을 따로 조회한다. 계좌이체 유저는 isDodo가
    // false라 이 조회 결과 자체를 안 쓰므로 기존 동작에 영향 없음.
    adminClient
      .from('payments')
      .select('amount, is_annual, payment_id')
      .eq('user_id', userId)
      .eq('payment_method', 'DODO')
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // 결제 주기는 실제 승인/완료된 결제 건 기준이 우선 — amount와 같은 행에서 나와야
  // 프로레이션 계산이 서로 어긋나지 않는다. 해당 행이 없는 예외 상황(레거시 데이터
  // 등)에서만 users.is_annual로 폴백.
  const paidAmount = isDodo
    ? (lastDodoPayment?.amount ?? PLAN_AMOUNTS[plan][userRow.is_annual ? 'annual' : 'monthly'])
    : (lastApproved?.amount ?? PLAN_AMOUNTS[plan].monthly);
  const isAnnual = isDodo
    ? (lastDodoPayment?.is_annual ?? userRow.is_annual ?? false)
    : (lastApproved?.is_annual ?? userRow.is_annual ?? false);
  const subscriptionStartDate = new Date(userRow.subscription_start_date);

  const calcParams = {
    paidAmount,
    subscriptionStartDate,
    cancelAt: new Date(),
    plan,
    diagnosisCount: stockCount ?? 0,
    portfolioCount: portfolioCount ?? 0,
    stockAnalysisCount: stockAnalysisCount ?? 0,
  };
  const calc = isAnnual ? calculateAnnualRefund(calcParams) : calculateRefund(calcParams);

  return {
    userRow, plan, paidAmount, isAnnual, subscriptionStartDate, calc,
    isDodo,
    dodoPaymentId:      lastDodoPayment?.payment_id ?? null,
    dodoSubscriptionId: userRow.dodo_subscription_id ?? null,
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

  // calc는 월간/연간 계산 결과 유니온 — 'monthsUsed' 존재 여부로 좁혀서(tagged union이 아니라서
  // isAnnual 변수만으로는 TS가 못 좁힘) 계산 과정 화면에 필요한 세부 필드를 그대로 실어 보낸다.
  // reasonText 문자열 파싱 대신 프론트가 이 구조화된 값으로 직접 문장을 조립한다.
  const breakdown = 'monthsUsed' in calc
    ? {
        isAnnual:            true as const,
        monthsUsed:          calc.monthsUsed,
        monthlyFullPrice:    calc.monthlyFullPrice,
        retroactiveCost:     calc.retroactiveCost,
        fullRefundException: calc.fullRefundException,
        diagnosisCount:      calc.diagnosisCount,
        portfolioCount:      calc.portfolioCount,
        stockAnalysisCount:  calc.stockAnalysisCount,
      }
    : {
        isAnnual:           false as const,
        elapsedRatio:       calc.elapsedRatio,
        diagnosisCount:     calc.diagnosisCount,
        diagnosisLimit:     calc.diagnosisLimit,
        diagnosisRatio:     calc.diagnosisRatio,
        portfolioCount:     calc.portfolioCount,
        portfolioLimit:     calc.portfolioLimit,
        portfolioRatio:     calc.portfolioRatio,
        stockAnalysisCount: calc.stockAnalysisCount,
        stockAnalysisLimit: calc.stockAnalysisLimit,
        stockAnalysisRatio: calc.stockAnalysisRatio,
        usageRatio:         calc.usageRatio,
        finalRatio:         calc.finalRatio,
        decidingFactor:     calc.decidingFactor,
        deductionAmount:    calc.deductionAmount,
      };

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
    ...breakdown,
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
  const { plan, paidAmount, isAnnual, calc, subscriptionStartDate, userRow, isDodo, dodoPaymentId, dodoSubscriptionId } = result;

  const body = await request.json().catch(() => ({})) as {
    refundAccountBank?: string; refundAccountNumber?: string; refundAccountHolder?: string;
  };

  // Dodo는 결제한 카드로 자동 환불되므로 계좌 정보가 필요 없음 — 계좌이체만 필수 검증.
  if (!isDodo && calc.refundAmount > 0) {
    const { refundAccountBank, refundAccountNumber, refundAccountHolder } = body;
    if (!refundAccountBank || !refundAccountNumber || !refundAccountHolder) {
      return NextResponse.json({ error: '환불받을 계좌 정보를 모두 입력해주세요.' }, { status: 400 });
    }
  }

  // Dodo: 우리 DB를 쓰기 전에 Dodo 쪽 구독부터 먼저 멈춘다 — 실패하면 여기서 즉시 중단하고
  // DB는 아무 것도 바꾸지 않는다. 안 그러면 "취소됐다"고 화면에 보여주는데 실제로는 다음
  // 결제일에도 카드가 청구되는 사고가 날 수 있다.
  let dodoRefundId: string | null = null;
  let refundApiFailed = false;
  if (isDodo) {
    if (!dodoSubscriptionId) {
      console.error('[subscription/cancel] dodo_subscription_id 없음 — userId:', user.id);
      return NextResponse.json({ error: '구독 정보를 찾을 수 없습니다. 관리자에게 문의해주세요.' }, { status: 500 });
    }
    try {
      await cancelDodoSubscription(dodoSubscriptionId, calc.refundEligible ? 'immediate' : 'next_billing_date');
    } catch (error) {
      console.error('[subscription/cancel] Dodo 구독 취소 실패:', error);
      return NextResponse.json({ error: '구독 취소 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
    }

    // 구독 취소는 이미 확정됐으므로, 환불 API가 실패해도 요청 전체를 실패시키지 않는다 —
    // refundApiFailed로 표시해 응답 문구를 성공과 구분하고, 관리자 수동 처리(기존
    // admin/refunds 완료 처리 라우트)로 폴백한다.
    if (calc.refundAmount > 0) {
      if (!dodoPaymentId) {
        console.error('[subscription/cancel] dodo payment_id 없음(구독은 취소됨) — userId:', user.id);
        refundApiFailed = true;
      } else {
        try {
          const refund = await refundDodoPayment(dodoPaymentId, calc.refundAmount, calc.reasonText);
          dodoRefundId = refund?.refund_id ?? null;
        } catch (error) {
          console.error('[subscription/cancel] Dodo 환불 API 실패(구독은 이미 취소됨):', error);
          refundApiFailed = true;
        }
      }
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
    stock_analysis_count:     calc.stockAnalysisCount,
    usage_ratio:              ratioFields.usage_ratio,
    elapsed_ratio:            ratioFields.elapsed_ratio,
    final_ratio:              ratioFields.final_ratio,
    elapsed_days:             calc.elapsedDays,
    refund_amount:            calc.refundAmount,
    refund_reason:            calc.reasonText,
    refund_status:            calc.refundAmount > 0 ? 'requested' : 'none',
    refund_account_bank:      (!isDodo && calc.refundAmount > 0) ? body.refundAccountBank   : null,
    refund_account_number:    (!isDodo && calc.refundAmount > 0) ? body.refundAccountNumber : null,
    refund_account_holder:    (!isDodo && calc.refundAmount > 0) ? body.refundAccountHolder : null,
    dodo_refund_id:           dodoRefundId,
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

  // Dodo는 관리자가 수동으로 송금할 일이 없어(카드로 자동 환불) 이 알림을 스킵.
  if (!isDodo && calc.refundAmount > 0 && process.env.ADMIN_EMAIL) {
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
        html:    buildCancelRefundRequestedEmailHtml(calc.refundAmount, isDodo ? 'DODO' : 'BANK_TRANSFER'),
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
    `diagnosisCount:${calc.diagnosisCount} portfolioCount:${calc.portfolioCount} stockAnalysisCount:${calc.stockAnalysisCount} ` +
    `finalRatio:${ratioFields.final_ratio} refundAmount:${calc.refundAmount} eligible:${calc.refundEligible} ` +
    `isDodo:${isDodo} refundApiFailed:${refundApiFailed}`,
  );

  // refundApiFailed는 isDodo && refundEligible && refundAmount>0일 때만 true가 될 수 있어
  // baseMessage의 다른 분기와 겹치지 않는다 — 성공 문구를 그대로 쓰면 유저가 환불이 이미
  // 처리된 것으로 오해할 수 있어 별도 문구로 분기.
  const baseMessage = calc.refundEligible
    ? (calc.refundAmount > 0 ? '환불 신청이 접수되었습니다.' : '구독이 취소되었습니다.')
    : '구독 취소가 접수되었습니다. 현재 결제 기간까지는 계속 이용하실 수 있습니다.';
  const message = refundApiFailed
    ? '구독은 취소되었으나 환불 처리 확인이 필요합니다. 곧 안내드리겠습니다.'
    : baseMessage;

  return NextResponse.json({
    ok: true,
    refundEligible: calc.refundEligible,
    refundAmount:   calc.refundAmount,
    reasonText:     calc.reasonText,
    refundApiFailed,
    message,
  });
}
