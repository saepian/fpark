'use client';

// 결제수단 선택 화면
//
// 현재 노출 옵션: 계좌이체(가상계좌) 단일 옵션.
// 자동 출금이 아니라, 발급된 계좌로 사용자가 매달 직접 입금하는 방식.
//
// 상태 (2026-07-04 기준):
// - CMS 자동이체: 사용자 심리적 거부감(자동 출금에 대한 불편함)을 고려해 미채택.
//   관련 스캐폴딩 코드는 삭제함 — 계좌이체(가상계좌)로 대체.
// - 해외 카드결제(Paddle): 연동 완전 제거함.
// - 기존 이니시스 카드결제(PortoneCheckout)는 삭제하지 않고 보존만 함
//   (특정 카드사가 향후 승인할 가능성 대비). CARD_ENABLED로 재노출 가능.
//
// 자세한 배경은 DEPLOYMENT.md "결제수단" 섹션 참고.

import { useState } from 'react';
import { Landmark, CreditCard } from 'lucide-react';
import VirtualAccountForm from './VirtualAccountForm';
import PortoneCheckout from './PortoneCheckout';

const CARD_ENABLED = false; // 이니시스 카드결제 재노출 시 true

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

type Step = 'method' | 'va' | 'card';

export default function PaymentMethodSelect({ plan, amount, isAnnual, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('method');

  const planLabel = `${PLAN_NAMES[plan]} ${isAnnual ? '연간' : '월간'} 구독`;

  // 카드결제(이니시스)를 그대로 재사용 — 선택 단계를 건너뛰고 기존 모달 위임
  if (step === 'card' && CARD_ENABLED) {
    return (
      <PortoneCheckout
        plan={plan}
        amount={amount}
        isAnnual={isAnnual}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl"
        style={{ background: '#0f1117', border: '1px solid rgba(99,102,241,0.3)' }}
      >
        {step === 'method' && (
          <>
            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">결제 수단 선택</p>
            <h2 className="text-[17px] font-bold text-white mb-1">{planLabel}</h2>
            <p className="text-[22px] font-bold text-white mb-5">
              {amount.toLocaleString()}원
              <span className="text-[13px] text-slate-500 ml-1">{isAnnual ? '/ 1년' : '/ 월'}</span>
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => setStep('va')}
                className="text-left rounded-2xl p-4 cursor-pointer transition-all hover:border-indigo-500/60 active:scale-[0.99]"
                style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
              >
                <div className="flex items-center gap-2.5 mb-1.5">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)' }}>
                    <Landmark className="w-4 h-4 text-indigo-400" />
                  </span>
                  <span className="text-[14.5px] font-semibold text-white">계좌이체</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/[0.06] text-slate-500">국내</span>
                </div>
                <p className="text-[12.5px] leading-relaxed text-slate-400">
                  매달 안내드리는 계좌로 직접 입금하시면 됩니다. 자동 출금이 아니라
                  언제든 본인이 확인 후 결제하는 방식입니다.
                </p>
              </button>

              {CARD_ENABLED && (
                <button
                  onClick={() => setStep('card')}
                  className="text-left rounded-2xl p-4 cursor-pointer transition-all hover:border-indigo-500/60"
                  style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)' }}>
                      <CreditCard className="w-4 h-4 text-indigo-400" />
                    </span>
                    <span className="text-[14.5px] font-semibold text-white">신용·체크카드</span>
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-slate-400">카카오페이·네이버페이 포함</p>
                </button>
              )}
            </div>

            <p className="mt-5 text-[10px] text-slate-600 text-center leading-relaxed">
              매달 입금 안내를 보내드립니다. 언제든지 해지 가능합니다.
            </p>
          </>
        )}

        {step === 'va' && (
          <VirtualAccountForm
            plan={plan}
            amount={amount}
            isAnnual={isAnnual}
            onClose={onClose}
            onBack={() => setStep('method')}
          />
        )}
      </div>
    </div>
  );
}
