// 계좌이체(가상계좌) 발급 — KG이니시스(PortOne V2)가 이미 지원하는 결제수단이라
// 신규 PG 계약 없이 기존 PORTONE_* 환경변수만으로 동작.
// 자동 출금이 아니라 사용자가 발급된 계좌로 직접 입금하는 방식.
// 입금 완료(구독 활성화)는 /api/payment/webhook 이 PortOne 웹훅을 받아 처리한다.

import { NextRequest, NextResponse } from 'next/server';
import { adminClient }                from '@/lib/supabase-admin';
import { createServerClient }         from '@supabase/ssr';
import { cookies }                    from 'next/headers';
import { issueVirtualAccount, getPayment } from '@/lib/portone';
import { PLAN_AMOUNTS }               from '@/lib/payment-constants';
import type { Database }              from '@/lib/database.types';

// 실제 PortOne 테스트 채널로 확인된, 이 가맹점 계약에서 가상계좌 발급이 되는 은행만 노출.
// KOOKMIN/KAKAO/TOSS는 이 채널에서 "가맹점 서비스 불가 은행"(PG 오류 504652)으로 거부됨 —
// 운영 전환 시 실제 계약 은행 목록으로 재검증 필요 (DEPLOYMENT.md 체크리스트 참고).
const ALLOWED_BANKS = new Set([
  'SHINHAN', 'WOORI', 'HANA', 'NONGHYUP', 'IBK', 'K_BANK',
]);

const VA_DUE_DAYS = 3; // 입금 기한 — 발급 시점 + 3일

export async function POST(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.then((s) => s.getAll()),
          setAll: (pairs) => cookieStore.then((s) => {
            pairs.forEach(({ name, value, options }) => s.set(name, value, options));
          }),
        },
      },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

    const userId    = user.id;
    const userEmail = user.email;

    const { plan, isAnnual, bank, buyerName, buyerPhone } = await request.json() as {
      plan:       'basic' | 'pro';
      isAnnual:   boolean;
      bank:       string;
      buyerName:  string;
      buyerPhone: string;
    };

    // PortOne 실 API 검증 결과 customer.phoneNumber는 REQUIRED (문서상 optional 표기와 다름)
    if (!plan || !bank || !buyerName?.trim() || !buyerPhone?.trim()) {
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });
    }
    if (!ALLOWED_BANKS.has(bank)) {
      return NextResponse.json({ error: '지원하지 않는 은행입니다' }, { status: 400 });
    }

    const planInfo = PLAN_AMOUNTS[plan];
    if (!planInfo) {
      return NextResponse.json({ error: '유효하지 않은 플랜' }, { status: 400 });
    }

    const amount    = isAnnual ? planInfo.annual : planInfo.monthly;
    const period    = isAnnual ? '연간' : '월간';
    const orderName = `${planInfo.name} ${period} 구독`;
    const paymentId = crypto.randomUUID();

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + VA_DUE_DAYS);

    const channelKey = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY!;

    await issueVirtualAccount({
      paymentId,
      channelKey,
      orderName,
      amount,
      bank,
      dueDate:       dueDate.toISOString(),
      customerId:    userId,
      customerName:  buyerName.trim(),
      customerEmail: userEmail,
      customerPhone: buyerPhone,
    });

    // 발급 응답엔 계좌 정보가 없어 재조회 필요
    const payment = await getPayment(paymentId);
    if (!payment.method?.accountNumber) {
      console.error('[payment/virtual-account/issue] 계좌 정보 조회 실패:', payment);
      return NextResponse.json({ error: '가상계좌 발급 확인 실패' }, { status: 502 });
    }

    await adminClient.from('payments').insert({
      user_id:          userId,
      plan,
      amount,
      payment_id:       paymentId,
      status:           'pending',
      payment_method:   'VIRTUAL_ACCOUNT',
      va_bank:          payment.method.bank ?? bank,
      va_account_number: payment.method.accountNumber,
      va_due_at:        payment.method.expiredAt ?? dueDate.toISOString(),
      is_annual:        isAnnual,
    });

    await adminClient.from('users').update({
      payment_method:       'VIRTUAL_ACCOUNT',
      subscription_status:  'awaiting_deposit',
      phone:                buyerPhone.trim(), // 갱신 발급(cron) 시 재사용
    }).eq('id', userId);

    console.log(`[payment/virtual-account/issue] 발급 완료 — userId:${userId} plan:${plan} amount:${amount}`);
    return NextResponse.json({
      ok:            true,
      paymentId,
      bank:          payment.method.bank ?? bank,
      accountNumber: payment.method.accountNumber,
      remitteeName:  payment.method.remitteeName,
      dueAt:         payment.method.expiredAt ?? dueDate.toISOString(),
      amount,
    });
  } catch (e) {
    console.error('[payment/virtual-account/issue] 오류:', e);
    return NextResponse.json({ error: '가상계좌 발급 중 오류가 발생했습니다' }, { status: 500 });
  }
}
