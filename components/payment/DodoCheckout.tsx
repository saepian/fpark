'use client';

// Dodo Payments 카드결제 — 체크아웃 세션을 만들어 Dodo 호스티드 결제 페이지로 리다이렉트.
// PortOne과 달리 클라이언트 SDK/팝업이 없어 상태는 idle→loading→error 세 가지뿐(결제
// 성공 시 페이지 자체가 Dodo → /mypage로 이동하므로 success 상태가 필요 없음).
// 인증은 쿠키 기반(app/api/payment/dodo/checkout이 Authorization 헤더를 읽지 않음) —
// 같은 origin 요청이라 fetch 기본 동작으로 쿠키가 자동 전송된다.

import { useState } from 'react';
import { X, CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { PLAN_AMOUNTS } from '@/lib/payment-constants';

interface Props {
  plan:         'basic' | 'pro';
  amount:       number;
  billingCycle: 'monthly' | 'annual';
  onClose:      () => void;
}

type Step = 'idle' | 'loading' | 'error';

export default function DodoCheckout({ plan, amount, billingCycle, onClose }: Props) {
  const [step,   setStep]   = useState<Step>('idle');
  const [errMsg, setErrMsg] = useState('');

  const planLabel = `${PLAN_AMOUNTS[plan].name} ${billingCycle === 'annual' ? '연간' : '월간'} 구독`;

  async function startCheckout() {
    setStep('loading');
    setErrMsg('');
    try {
      const res = await fetch('/api/payment/dodo/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan, billingCycle }),
      });
      const data = await res.json();
      if (!res.ok || !data.checkoutUrl) {
        throw new Error(data.error ?? '결제 세션 생성에 실패했습니다.');
      }
      window.location.href = data.checkoutUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '결제 중 오류가 발생했습니다.';
      setErrMsg(msg);
      setStep('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={step !== 'loading' ? onClose : undefined}
      />

      <div
        className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl"
        style={{ background: '#0f1117', border: '1px solid rgba(99,102,241,0.3)' }}
      >
        {step !== 'loading' && (
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        )}

        {step === 'idle' && (
          <>
            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">신용·체크카드</p>
            <h2 className="text-[17px] font-bold text-white mb-1">{planLabel}</h2>
            <p className="text-[22px] font-bold text-white mb-5">
              {amount.toLocaleString()}원
              <span className="text-[13px] text-slate-500 ml-1">{billingCycle === 'annual' ? '/ 1년' : '/ 월'}</span>
            </p>

            <button
              onClick={startCheckout}
              className="flex items-center justify-center gap-2 w-full px-4 py-3.5 rounded-xl text-[14px] font-semibold text-white cursor-pointer transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
            >
              <CreditCard className="w-4 h-4" />
              결제 진행하기
            </button>

            <p className="mt-5 text-[10px] text-slate-600 text-center leading-relaxed">
              Dodo Payments 결제 페이지로 이동합니다. 구독 시 매 결제 주기마다 자동 결제되며, 언제든지 해지 가능합니다.
            </p>
          </>
        )}

        {step === 'loading' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
            <p className="text-[14px] text-slate-300">결제 페이지로 이동 중...</p>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <AlertCircle className="w-10 h-10 text-red-400" />
            <p className="text-[14px] font-semibold text-white">결제 실패</p>
            <p className="text-[12px] text-slate-400 text-center">{errMsg}</p>
            <button
              onClick={() => setStep('idle')}
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
