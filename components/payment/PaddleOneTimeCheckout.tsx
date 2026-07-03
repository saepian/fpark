'use client';

import { useEffect, useRef, useState } from 'react';
import { initializePaddle, type Paddle } from '@paddle/paddle-js';
import { X, CreditCard, Loader2, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

interface Props {
  creditType: 'stock' | 'portfolio';
  amount:     number;
  onClose:    () => void;
  onSuccess:  () => void;
}

const CREDIT_LABELS: Record<'stock' | 'portfolio', string> = {
  stock:     '기업 분석 1회권',
  portfolio: '포트폴리오 분석 1회권',
};

type Step = 'idle' | 'loading' | 'success' | 'error';

export default function PaddleOneTimeCheckout({ creditType, amount, onClose, onSuccess }: Props) {
  const [step,   setStep]   = useState<Step>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [userId, setUserId] = useState('');
  const [email,  setEmail]  = useState('');
  const paddleRef = useRef<Paddle | undefined>(undefined);

  const label = CREDIT_LABELS[creditType];

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
              setStep('success');
              setTimeout(() => onSuccess(), 2000);
            }
            if (event.name === 'checkout.closed') {
              setStep('idle');
            }
          },
        });
      }
      if (!paddleRef.current) throw new Error('Paddle 초기화 실패');

      const priceId = creditType === 'stock'
        ? process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_CREDIT_STOCK!
        : process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_CREDIT_PORTFOLIO!;

      await paddleRef.current.Checkout.open({
        items:      [{ priceId, quantity: 1 }],
        customer:   email ? { email } : undefined,
        customData: { userId, creditType },
      });

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
        style={{ background: '#0f1117', border: '1px solid rgba(99,102,241,0.3)' }}
      >
        {step !== 'loading' && (
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        )}

        {step === 'idle' && (
          <>
            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">1회권 · 해외 카드결제</p>
            <h2 className="text-[17px] font-bold text-white mb-1">{label}</h2>
            <p className="text-[22px] font-bold text-white mb-4">
              {amount.toLocaleString()}원
              <span className="text-[13px] text-slate-500 ml-1">/ 1회</span>
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
              style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
            >
              <CreditCard className="w-4 h-4" />
              카드로 결제하기
            </button>

            <button
              onClick={onClose}
              className="mt-3 w-full py-2.5 rounded-xl text-[13px] text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              취소
            </button>
          </>
        )}

        {step === 'loading' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
            <p className="text-[14px] text-slate-300">결제창 불러오는 중...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle className="w-12 h-12 text-emerald-400" />
            <p className="text-[16px] font-semibold text-white">결제 완료!</p>
            <p className="text-[13px] text-slate-400 text-center">
              {label}이 충전되었습니다.<br />
              <span className="text-[12px] text-slate-500">잠시 후 바로 사용하실 수 있습니다.</span>
            </p>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <AlertCircle className="w-10 h-10 text-red-400" />
            <p className="text-[14px] font-semibold text-white">결제 오류</p>
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
