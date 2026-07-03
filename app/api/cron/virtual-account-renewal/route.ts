// 계좌이체(가상계좌) 구독자 — 매일 1회 실행
// 1) 갱신일 D-3: 새 입금 계좌를 발급하고 안내 이메일 발송
// 2) 입금 기한 초과: 구독을 'paused'로 전환 (입금 확인되면 webhook이 다시 'active'로 복구)
// 자동 출금이 아니므로 cron/billing(카드 빌링키 전용)과 분리된 별도 크론.

import { NextRequest, NextResponse } from 'next/server';
import { adminClient }                from '@/lib/supabase-admin';
import { Resend }                     from 'resend';
import { issueVirtualAccount, getPayment } from '@/lib/portone';
import { PLAN_AMOUNTS }               from '@/lib/payment-constants';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const RENEWAL_LEAD_DAYS = 3; // 갱신일 D-3에 안내
const VA_DUE_DAYS       = 3; // 발급 시점 + 3일 입금 기한

function bankName(code: string) {
  const names: Record<string, string> = {
    KOOKMIN: '국민은행', SHINHAN: '신한은행', WOORI: '우리은행', HANA: '하나은행',
    NONGHYUP: '농협은행', IBK: 'IBK기업은행', KAKAO: '카카오뱅크', TOSS: '토스뱅크', K_BANK: '케이뱅크',
  };
  return names[code] ?? code;
}

export async function GET(request: NextRequest) {
  const resend    = new Resend(process.env.RESEND_API_KEY!);
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = { issued: 0, issueFailed: 0, paused: 0 };

  // ── 1) 갱신 안내 + 새 계좌 발급 (D-3) ────────────────────────────────────────
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() + RENEWAL_LEAD_DAYS);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 1);

  const { data: dueUsers, error: dueErr } = await adminClient
    .from('users')
    .select('id, email, plan, phone')
    .eq('subscription_status', 'active')
    .eq('payment_method', 'VIRTUAL_ACCOUNT')
    .gte('next_billed_at', windowStart.toISOString())
    .lt('next_billed_at', windowEnd.toISOString());

  if (dueErr) {
    console.error('[cron/va-renewal] users 조회 실패:', dueErr);
  }

  for (const user of dueUsers ?? []) {
    try {
      // 이번 갱신 사이클에 이미 발급된 대기중 계좌가 있으면 중복 발급 방지
      const { data: existingPending } = await adminClient
        .from('payments')
        .select('id')
        .eq('user_id', user.id)
        .eq('payment_method', 'VIRTUAL_ACCOUNT')
        .eq('status', 'pending')
        .gte('created_at', new Date(Date.now() - (RENEWAL_LEAD_DAYS + 1) * 86400000).toISOString())
        .maybeSingle();
      if (existingPending) continue;

      if (!user.phone) {
        console.warn(`[cron/va-renewal] phone 없음, 발급 스킵 — userId:${user.id}`);
        continue;
      }

      // 이전에 사용한 은행 코드를 재사용 (없으면 신한은행 기본값)
      const { data: lastVaPayment } = await adminClient
        .from('payments')
        .select('va_bank, is_annual')
        .eq('user_id', user.id)
        .eq('payment_method', 'VIRTUAL_ACCOUNT')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const bank      = lastVaPayment?.va_bank ?? 'SHINHAN';
      const isAnnual  = Boolean(lastVaPayment?.is_annual);
      const planInfo  = PLAN_AMOUNTS[user.plan as string];
      if (!planInfo) continue;

      const amount    = isAnnual ? planInfo.annual : planInfo.monthly;
      const orderName = `${planInfo.name} ${isAnnual ? '연간' : '월간'} 구독 갱신`;
      const paymentId = crypto.randomUUID();

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + VA_DUE_DAYS);

      await issueVirtualAccount({
        paymentId,
        channelKey: process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY!,
        orderName,
        amount,
        bank,
        dueDate:    dueDate.toISOString(),
        customerId: user.id,
        customerEmail: user.email as string | undefined,
        customerPhone: user.phone as string,
      });

      const payment = await getPayment(paymentId);
      if (!payment.method?.accountNumber) throw new Error('계좌 정보 조회 실패');

      await adminClient.from('payments').insert({
        user_id:           user.id,
        plan:              user.plan,
        amount,
        payment_id:        paymentId,
        status:            'pending',
        payment_method:    'VIRTUAL_ACCOUNT',
        va_bank:           payment.method.bank ?? bank,
        va_account_number: payment.method.accountNumber,
        va_due_at:         payment.method.expiredAt ?? dueDate.toISOString(),
        is_annual:         isAnnual,
      });

      if (user.email) {
        await resend.emails.send({
          from:    'Finance Park <noreply@fpark.com>',
          to:      [user.email as string],
          subject: '[Finance Park] 구독 갱신 안내 — 입금 계좌 발급',
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
              <h2>구독 갱신 안내</h2>
              <p>${planInfo.name} 구독 갱신일이 곧 도래합니다. 아래 계좌로 입금해주시면 구독이 계속 유지됩니다.</p>
              <div style="background:#f5f5f7; border-radius:12px; padding:16px; margin:16px 0;">
                <p style="margin:0 0 4px; color:#666; font-size:13px;">${bankName(payment.method.bank ?? bank)}</p>
                <p style="margin:0 0 8px; font-size:20px; font-weight:700;">${payment.method.accountNumber}</p>
                <p style="margin:0; font-size:14px;">입금 금액: <b>${amount.toLocaleString()}원</b></p>
                <p style="margin:4px 0 0; font-size:14px; color:#c2410c;">입금 기한: ${new Date(payment.method.expiredAt ?? dueDate).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지</p>
              </div>
              <p style="font-size:12px; color:#888;">기한 내 입금이 확인되지 않으면 구독이 일시 정지되며, 입금 확인 시 자동으로 재활성화됩니다.</p>
            </div>
          `,
        });
      }

      results.issued++;
      console.log(`[cron/va-renewal] 갱신 계좌 발급 — userId:${user.id} amount:${amount}`);
    } catch (e) {
      results.issueFailed++;
      console.error(`[cron/va-renewal] 발급 실패 — userId:${user.id}:`, e);
    }
  }

  // ── 2) 입금 기한 초과 → 구독 일시정지 ────────────────────────────────────────
  const now = new Date().toISOString();
  const { data: overduePayments } = await adminClient
    .from('payments')
    .select('id, user_id')
    .eq('payment_method', 'VIRTUAL_ACCOUNT')
    .eq('status', 'pending')
    .lt('va_due_at', now);

  for (const p of overduePayments ?? []) {
    await adminClient.from('payments').update({ status: 'expired' }).eq('id', p.id);
    await adminClient.from('users').update({ subscription_status: 'paused' }).eq('id', p.user_id);
    results.paused++;
    console.log(`[cron/va-renewal] 입금 기한 초과, 구독 일시정지 — userId:${p.user_id}`);
  }

  return NextResponse.json({ ok: true, ...results });
}
