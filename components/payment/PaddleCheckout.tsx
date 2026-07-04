'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { initializePaddle, type Paddle } from '@paddle/paddle-js';
import { X, CreditCard, Loader2, AlertCircle, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

interface Props {
  plan:      'basic' | 'pro';
  amount:    number;
  isAnnual:  boolean;
  onClose:   () => void;
  onBack:    () => void;
  onSuccess: (plan: 'basic' | 'pro') => void;
}

const PLAN_NAMES: Record<'basic' | 'pro', string> = {
  basic: 'Finance Park Basic',
  pro:   'Finance Park Pro',
};

type Step = 'idle' | 'loading' | 'error';

export default function PaddleCheckout({ plan, amount, isAnnual, onClose, onBack, onSuccess }: Props) {
  const router = useRouter();
  const [step,   setStep]   = useState<Step>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [userId, setUserId] = useState('');
  const [email,  setEmail]  = useState('');
  const paddleRef = useRef<Paddle | undefined>(undefined);

  const planLabel = `${PLAN_NAMES[plan]} ${isAnnual ? '연간' : '월간'} 구독`;

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      setEmail(user.email ?? '');
    });
  }, []); // eslint-disable-line

  async function handlePay() {
    setStep('loading');
    try {
      if (!paddleRef.current) {
        paddleRef.current = await initializePaddle({
          token:       process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
          environment: 'production',
          eventCallback(event) {
            if (event.name === 'checkout.completed') {
              onSuccess(plan);
              router.push(`/payment-success?type=subscription&plan=${plan}&wasLoggedIn=${Boolean(userId)}`);
            }
            if (event.name === 'checkout.closed') {
              setStep('idle');
            }
          },
        });
      }
      if (!paddleRef.current) throw new Error('Paddle 초기화 실패');

      const PRICE_IDS = {
        basic:        process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_BASIC!,
        basicAnnual:  process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_BASIC_ANNUAL!,
        pro:          process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO!,
        proAnnual:    process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_ANNUAL!,
      };
      const priceId = plan === 'basic'
        ? (isAnnual ? PRICE_IDS.basicAnnual : PRICE_IDS.basic)
        : (isAnnual ? PRICE_IDS.proAnnual   : PRICE_IDS.pro);

      await paddleRef.current.Checkout.open({
        items:      [{ priceId, quantity: 1 }],
        customer:   email ? { email } : undefined,
        customData: { ...(userId ? { userId } : {}), plan, isAnnual: String(isAnnual) },
      });

      // Paddle 오버레이가 열림 — checkout.completed 또는 checkout.closed 이벤트로 상태 처리
      setStep('idle');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : '결제 초기화 중 오류가 발생했습니다.');
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
        style={{ background: '#0f1117', border: '1px solid rgba(16,185,129,0.3)' }}
      >
        {step !== 'loading' && (
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        )}

        {step === 'idle' && (
          <>
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2">해외 카드결제</p>
            <h2 className="text-[17px] font-bold text-white mb-1">{planLabel}</h2>
            <p className="text-[22px] font-bold text-white mb-4">
              {amount.toLocaleString()}원
              <span className="text-[13px] text-slate-500 ml-1">{isAnnual ? '/ 1년' : '/ 월'}</span>
            </p>

            <div
              className="flex items-start gap-1.5 mb-5 p-3 rounded-xl"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[12px] text-amber-200 leading-relaxed">
                카드 명세서에는 <strong>PADDLE.COM</strong> 또는 해외 상호로 표시됩니다.
                국내외 카드 모두 결제 가능합니다.
              </p>
            </div>

            <button
              onClick={handlePay}
              className="w-full py-3.5 rounded-xl text-[14px] font-bold text-white transition-all cursor-pointer hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
            >
              <CreditCard className="w-4 h-4" />
              카드로 결제하기
            </button>

            <button
              onClick={onBack}
              className="mt-3 w-full py-2.5 rounded-xl text-[13px] text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              다른 결제 수단 선택
            </button>
          </>
        )}

        {step === 'loading' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
            <p className="text-[14px] text-slate-300">결제창 불러오는 중...</p>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <AlertCircle className="w-10 h-10 text-red-400" />
            <p className="text-[14px] font-semibold text-white">결제 오류</p>
            <p className="text-[12px] text-slate-400 text-center">{errMsg}</p>
            <button
              onClick={() => setStep('idle')}
              className="mt-1 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[13px] font-semibold cursor-pointer transition-colors"
            >
              다시 시도
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
