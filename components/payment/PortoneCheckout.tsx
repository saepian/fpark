'use client';

// PortOne V2 결제 모달
// 빌링키 발급 → 서버에서 즉시 결제 → 플랜 업데이트
// 테스트 모드: 실제 카드 승인 없음 (PortOne 테스트 환경)
// 이니시스 V2: customer.phoneNumber 필수 (하이픈 없는 숫자 11자리)

import { useState } from 'react';
import * as PortOne from '@portone/browser-sdk/v2';
import { createClient } from '@/lib/supabase-browser';
import { X, CreditCard, Loader2, CheckCircle, AlertCircle, Phone } from 'lucide-react';

interface Props {
  plan:      'basic' | 'pro';
  amount:    number;
  isAnnual:  boolean;
  onClose:   () => void;
  onSuccess: (plan: 'basic' | 'pro') => void;
}

const PLAN_NAMES: Record<'basic' | 'pro', string> = {
  basic: 'Finance Park Basic',
  pro:   'Finance Park Pro',
};

const KAKAO_PROVIDER = 'KAKAOPAY';
const NAVER_PROVIDER = 'NAVERPAY';

type Step = 'select' | 'processing' | 'success' | 'error';

// 숫자만 추출 (하이픈 등 제거) — 이니시스 V2 요구 형식
function toRawPhone(value: string) {
  return value.replace(/\D/g, '');
}

// 입력 중 자동 하이픈 포매팅 (표시용)
function formatPhone(value: string) {
  const digits = toRawPhone(value).slice(0, 11);
  if (digits.length < 4)  return digits;
  if (digits.length < 8)  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function isValidPhone(raw: string) {
  return /^01[016789]\d{7,8}$/.test(raw);
}

export default function PortoneCheckout({ plan, amount, isAnnual, onClose, onSuccess }: Props) {
  const [step,     setStep]     = useState<Step>('select');
  const [errMsg,   setErrMsg]   = useState('');
  const [phone,    setPhone]    = useState('');
  const [phoneErr, setPhoneErr] = useState('');

  const planLabel = `${PLAN_NAMES[plan]} ${isAnnual ? '연간' : '월간'} 구독`;

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPhone(formatPhone(e.target.value));
    setPhoneErr('');
  }

  async function startPayment(method: 'CARD' | typeof KAKAO_PROVIDER | typeof NAVER_PROVIDER) {
    // 휴대폰 번호 검증
    const rawPhone = toRawPhone(phone);
    if (!isValidPhone(rawPhone)) {
      setPhoneErr('올바른 휴대폰 번호를 입력해주세요. (예: 010-1234-5678)');
      return;
    }

    setStep('processing');
    setErrMsg('');

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setErrMsg('로그인이 필요합니다.'); setStep('error'); return; }

      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token ?? '';

      const storeId    = process.env.NEXT_PUBLIC_PORTONE_STORE_ID!;
      const channelKey = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY!;
      const issueId    = crypto.randomUUID();

      const customer = {
        customerId:  user.id,
        email:       user.email,
        phoneNumber: rawPhone,  // 이니시스 V2 필수: 하이픈 없는 숫자 (e.g. "01012345678")
      };

      // 빌링키 발급 — 카드/카카오/네이버 분기
      let billingKeyResp: PortOne.IssueBillingKeyResponse | null = null;

      if (method === 'CARD') {
        billingKeyResp = await PortOne.requestIssueBillingKey({
          storeId,
          channelKey,
          billingKeyMethod: 'CARD',
          issueId,
          issueName: planLabel,
          customer,
        });
      } else {
        billingKeyResp = await PortOne.requestIssueBillingKey({
          storeId,
          channelKey,
          billingKeyMethod: 'EASY_PAY',
          issueId,
          issueName: planLabel,
          customer,
          easyPay: { easyPayProvider: method },
        });
      }

      if (!billingKeyResp || billingKeyResp.code) {
        const msg = (billingKeyResp as { message?: string })?.message ?? '빌링키 발급 실패';
        throw new Error(msg);
      }

      const billingKey = billingKeyResp.billingKey;

      // 서버에서 첫 결제 실행
      const res = await fetch('/api/payment/billing', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          billingKey,
          plan,
          isAnnual,
          userId:    user.id,
          userEmail: user.email,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? '결제 실패');
      }

      setStep('success');
      setTimeout(() => onSuccess(plan), 1800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '결제 중 오류가 발생했습니다.';
      if (msg.includes('USER_CANCEL') || msg.includes('사용자')) {
        setStep('select');
        return;
      }
      setErrMsg(msg);
      setStep('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={step !== 'processing' ? onClose : undefined} />

      <div
        className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl"
        style={{ background: '#0f1117', border: '1px solid rgba(99,102,241,0.3)' }}
      >
        {/* 닫기 */}
        {step !== 'processing' && (
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        )}

        {/* 선택 단계 */}
        {step === 'select' && (
          <>
            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">결제 수단 선택</p>
            <h2 className="text-[17px] font-bold text-white mb-1">{planLabel}</h2>
            <p className="text-[22px] font-bold text-white mb-5">
              {amount.toLocaleString()}원
              <span className="text-[13px] text-slate-500 ml-1">{isAnnual ? '/ 1년' : '/ 월'}</span>
            </p>

            {/* 휴대폰 번호 입력 */}
            <div className="mb-4">
              <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
                휴대폰 번호 <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="010-0000-0000"
                  value={phone}
                  onChange={handlePhoneChange}
                  maxLength={13}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[13px] text-white placeholder-slate-600 outline-none transition-colors"
                  style={{
                    background:  '#1a1f2e',
                    border:      phoneErr ? '1px solid rgba(239,68,68,0.6)' : '1px solid rgba(51,65,85,0.6)',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = phoneErr ? 'rgba(239,68,68,0.8)' : 'rgba(99,102,241,0.6)')}
                  onBlur={e  => (e.currentTarget.style.borderColor = phoneErr ? 'rgba(239,68,68,0.6)' : 'rgba(51,65,85,0.6)')}
                />
              </div>
              {phoneErr && (
                <p className="mt-1.5 text-[11px] text-red-400">{phoneErr}</p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <PayMethodButton
                label="신용·체크카드"
                icon={<CreditCard className="w-4 h-4" />}
                onClick={() => startPayment('CARD')}
              />
              <PayMethodButton
                label="카카오페이"
                icon={<KakaoIcon />}
                onClick={() => startPayment(KAKAO_PROVIDER)}
              />
              <PayMethodButton
                label="네이버페이"
                icon={<NaverIcon />}
                onClick={() => startPayment(NAVER_PROVIDER)}
              />
            </div>

            <p className="mt-5 text-[10px] text-slate-600 text-center leading-relaxed">
              구독 시 매월 자동 결제됩니다. 언제든지 해지 가능합니다.
            </p>
          </>
        )}

        {/* 처리 중 */}
        {step === 'processing' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
            <p className="text-[14px] text-slate-300">결제 처리 중...</p>
          </div>
        )}

        {/* 성공 */}
        {step === 'success' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle className="w-12 h-12 text-emerald-400" />
            <p className="text-[16px] font-semibold text-white">결제 완료!</p>
            <p className="text-[13px] text-slate-400 text-center">
              {PLAN_NAMES[plan]} 플랜이 활성화되었습니다.
            </p>
          </div>
        )}

        {/* 오류 */}
        {step === 'error' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <AlertCircle className="w-10 h-10 text-red-400" />
            <p className="text-[14px] font-semibold text-white">결제 실패</p>
            <p className="text-[12px] text-slate-400 text-center">{errMsg}</p>
            <button
              onClick={() => setStep('select')}
              className="mt-1 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold cursor-pointer transition-colors"
            >
              다시 시도
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PayMethodButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl text-left transition-all cursor-pointer
        hover:border-indigo-500/60 active:scale-[0.98]"
      style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
    >
      <span className="text-slate-400">{icon}</span>
      <span className="text-[14px] font-medium text-slate-200">{label}</span>
    </button>
  );
}

function KakaoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#FEE500">
      <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.717 1.636 5.1 4.1 6.577l-.937 3.5 4.077-2.677c.89.15 1.81.228 2.76.228 5.523 0 10-3.477 10-7.8S17.523 3 12 3z" />
    </svg>
  );
}

function NaverIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#03C75A">
      <path d="M13.76 12.27L10.2 6.5H6.5v11h3.74v-5.77l3.56 5.77H17.5V6.5h-3.74z" />
    </svg>
  );
}
