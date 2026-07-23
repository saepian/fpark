// 계좌이체(무통장입금) 신청 접수 — PG 연동 없이 회사 고정 계좌 + 예금주 실명 매칭 방식.
// depositor_real_name(신청 시 입력받은 예금주 실명)을 users에도 영구 저장해 갱신 신청
// (화면 없이 크론이 자동 생성)에서도 재사용한다. 자동 매칭(cron/bank-transfer-auto-match)이
// 유니크하게 확정하지 못하면 관리자가 /admin/payments에서 수동 승인한다.
//
// GET: Basic→Pro 업그레이드 견적 미리보기(쓰기 없음) — /pricing이 정가 대신 실제
// 청구액을 보여줄 때 사용. 월간 Basic → 월간 Pro만 지원(연간은 정가 소급 재계산
// 모델이 완전히 달라 별도 설계 필요 — 여기서는 isUpgrade:false + blockedReason으로
// 안내만 하고 정가로 폴백).
// POST: 실제 신청 접수 — 업그레이드 대상이면 클라이언트가 보낸 amount를 그대로 믿지
// 않고 서버가 같은 로직으로 재계산한 값과 일치하는지 검증한다(조작 방지).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { PLAN_ALLOWED_AMOUNTS, PLAN_AMOUNTS } from '@/lib/payment-constants';
import { computeDepositorName } from '@/lib/bank-transfer';
import { calculateUpgradeChargeAmount } from '@/lib/upgrade-credit';
import { getLastActualPayment, deriveMonthlyPriceFromPayment } from '@/lib/subscription-pricing';
import { getUsageCycleStart } from '@/lib/plan';
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

type UpgradeQuote =
  | {
      isUpgrade:          true;
      chargeAmount:       number;
      creditAmount:       number;
      remainingDays:      number;
      currentPlanMonthly: number;
      targetPlanMonthly:  number;
      usageCapped:        boolean; // true면 이번 사이클 이용률이 높아 크레딧이 이용률 상한에 걸림
    }
  | {
      isUpgrade:      false;
      chargeAmount:   number;      // 정가(비업그레이드 시 기본 청구액)
      blockedReason:  'annual' | null; // 'annual'이면 화면에 "연간은 별도 문의" 안내
    };

// 월간 Basic → 월간 Pro 업그레이드 견적. 그 외 모든 조합(연간 개입, 다운그레이드,
// 무료/미가입 유저 등)은 isUpgrade:false로 정가 그대로 반환.
async function computeUpgradeQuote(
  userId:     string,
  targetPlan: 'basic' | 'pro',
  targetIsAnnual: boolean,
): Promise<UpgradeQuote> {
  const standardAmount = targetIsAnnual ? PLAN_AMOUNTS[targetPlan].annual : PLAN_AMOUNTS[targetPlan].monthly;

  const { data: userRow } = await adminClient
    .from('users')
    .select('plan, subscription_status, next_billed_at, is_annual, subscription_start_date')
    .eq('id', userId)
    .maybeSingle();

  const isBasicToPro = userRow?.plan === 'basic' && targetPlan === 'pro' && userRow.subscription_status === 'active';
  if (!isBasicToPro) {
    return { isUpgrade: false, chargeAmount: standardAmount, blockedReason: null };
  }

  // Basic→Pro 상황은 맞지만 연간이 하나라도 끼면 이번 스코프 밖 — 정가로 폴백하되
  // "왜 정가만 보이는지" 화면에서 설명할 수 있게 이유를 표시
  if (userRow.is_annual || targetIsAnnual) {
    return { isUpgrade: false, chargeAmount: standardAmount, blockedReason: 'annual' };
  }

  if (!userRow.next_billed_at || !userRow.subscription_start_date) {
    return { isUpgrade: false, chargeAmount: standardAmount, blockedReason: null };
  }

  // 크레딧 이용률 상한(calculateUsageRatio) 계산에 필요한 이용실적 — 원 가입일 이후
  // 평생 누적이 아니라 "이번 결제 사이클" 이용 건수여야 한다(lib/upgrade-credit.ts 주석 참고).
  const { cycleStart } = getUsageCycleStart(userRow.subscription_start_date, new Date());
  const [{ count: diagnosisCount }, { count: portfolioCount }, { count: stockAnalysisCount }, lastPayment] = await Promise.all([
    adminClient
      .from('stock_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', cycleStart.toISOString()),
    adminClient
      .from('portfolio_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', cycleStart.toISOString()),
    adminClient
      .from('stock_analysis_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('usage_date', cycleStart.toISOString().split('T')[0]),
    getLastActualPayment(userId),
  ]);

  // 2026-07-23 가격 인상 대응 — 라이브 PLAN_AMOUNTS.basic.monthly 대신 이 유저가 실제로 내고
  // 있는 Basic 금액을 씀. 그래야 인상 전 가입자가 인상 후 업그레이드해도, 실제로는 옛 가격을
  // 내고 있는데 크레딧이 새(더 비싼) 가격 기준으로 과다 산정되는 걸 막는다(Dodo는 기존 구독을
  // 자동으로 새 가격으로 옮기지 않음). targetPlanMonthly(Pro)는 오늘 새로 가입하는 가격이라
  // 라이브 값이 맞다.
  const currentPlanMonthly = lastPayment
    ? deriveMonthlyPriceFromPayment(lastPayment.amount, lastPayment.isAnnual)
    : PLAN_AMOUNTS.basic.monthly; // 과거 결제기록이 없는 예외 상황(레거시 데이터 등) 폴백

  const { credit, chargeAmount } = calculateUpgradeChargeAmount({
    currentPlanMonthly,
    targetPlanMonthly:  PLAN_AMOUNTS.pro.monthly,
    nextBilledAt:       new Date(userRow.next_billed_at),
    now:                new Date(),
    currentPlan:        'basic',
    diagnosisCount:     diagnosisCount ?? 0,
    portfolioCount:     portfolioCount ?? 0,
    stockAnalysisCount: stockAnalysisCount ?? 0,
  });

  return {
    isUpgrade:          true,
    chargeAmount,
    creditAmount:       credit.creditAmount,
    remainingDays:      credit.remainingDays,
    currentPlanMonthly,
    targetPlanMonthly:  PLAN_AMOUNTS.pro.monthly,
    usageCapped:        credit.cappedByUsage,
  };
}

export async function GET(request: NextRequest) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const plan = searchParams.get('plan');
  const isAnnual = searchParams.get('isAnnual') === 'true';
  if (plan !== 'basic' && plan !== 'pro') {
    return NextResponse.json({ error: '잘못된 plan' }, { status: 400 });
  }

  const quote = await computeUpgradeQuote(user.id, plan, isAnnual);
  return NextResponse.json({ ok: true, ...quote });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = makeSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증 필요' }, { status: 401 });
    }

    const { plan, isAnnual, amount, depositorRealName } = await request.json() as {
      plan?:              'basic' | 'pro';
      isAnnual?:          boolean;
      amount?:            number;
      depositorRealName?: string;
    };

    if (!plan || amount == null) {
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });
    }

    const realName = depositorRealName?.trim();
    if (!realName) {
      return NextResponse.json({ error: '예금주 실명을 입력해주세요.' }, { status: 400 });
    }

    // 업그레이드 여부/차액은 클라이언트가 보낸 값을 신뢰하지 않고 서버가 직접 재계산한다.
    const quote = await computeUpgradeQuote(user.id, plan, !!isAnnual);
    const allowed = PLAN_ALLOWED_AMOUNTS[plan] ?? [];
    const validAmount = allowed.includes(amount) || (quote.isUpgrade && amount === quote.chargeAmount);
    if (!validAmount) {
      return NextResponse.json({
        error: quote.isUpgrade
          ? '가격 정보가 변경되었습니다. 새로고침 후 다시 시도해주세요.'
          : '결제 금액 검증 실패',
      }, { status: 400 });
    }
    const requestType: 'new' | 'upgrade' = quote.isUpgrade ? 'upgrade' : 'new';

    // users.depositor_real_name을 최신값으로 유지 — 갱신 신청은 화면 없이 크론이 자동
    // 생성하므로(bank-transfer-renewal-notice) 여기 저장된 값을 매번 재사용한다.
    await adminClient
      .from('users')
      .update({ depositor_real_name: realName })
      .eq('id', user.id);

    // 이미 대기중인 "같은 plan" 신청이 있으면 새로 만들지 않고, 예금주명·금액을 최신값으로
    // 갱신 후 반환(중복 방지 + 재제출 시 오타/시간 경과에 따른 업그레이드 금액 변동 반영).
    // plan까지 맞춰서 조회하는 이유: 예를 들어 예전에 신청한 Basic pending 건이 남아있는
    // 상태에서 Pro 업그레이드를 시도하면, plan 무시하고 찾을 경우 엉뚱한 Basic 신청을
    // 그대로 반환해버려 Pro 신청 자체가 조용히 무시되는 문제가 있었다.
    const { data: existing } = await adminClient
      .from('bank_transfer_requests')
      .select('id, depositor_name, depositor_real_name, amount, plan, is_annual, requested_at, request_type')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .eq('plan', plan)
      .maybeSingle();

    if (existing) {
      const updates: { depositor_real_name?: string; amount?: number } = {};
      if (existing.depositor_real_name !== realName) updates.depositor_real_name = realName;
      if (quote.isUpgrade && existing.amount !== quote.chargeAmount) updates.amount = quote.chargeAmount;

      if (Object.keys(updates).length > 0) {
        await adminClient.from('bank_transfer_requests').update(updates).eq('id', existing.id);
      }
      return NextResponse.json({ ok: true, request: { ...existing, ...updates } });
    }

    const depositorName = computeDepositorName(user.email);

    const { data: inserted, error } = await adminClient
      .from('bank_transfer_requests')
      .insert({
        user_id:             user.id,
        plan,
        is_annual:           !!isAnnual,
        amount,
        depositor_name:      depositorName,
        depositor_real_name: realName,
        request_type:        requestType,
      })
      .select('id, depositor_name, depositor_real_name, amount, plan, is_annual, requested_at')
      .single();

    if (error) {
      console.error('[bank-transfer/request] insert 실패:', error);
      return NextResponse.json({ error: '신청 저장 실패' }, { status: 500 });
    }

    console.log(
      `[bank-transfer/request] 신청 접수 — userId:${user.id} plan:${plan} amount:${amount} ` +
      `type:${requestType} depositor:${depositorName} realName:${realName}`,
    );
    return NextResponse.json({ ok: true, request: inserted });
  } catch (e) {
    console.error('[bank-transfer/request] 예외:', e);
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
