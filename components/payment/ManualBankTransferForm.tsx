'use client';

// 계좌이체(무통장입금) 신청 폼 — PG 가상계좌(VirtualAccountForm)와 달리 PG 연동이 전혀 없다.
// 회사 명의 고정 계좌로 사용자가 직접 입금하고, 입금자명으로 관리자가 수동 매칭·승인한다
// (/admin/payments). 입금 확인 후 활성화까지는 관리자 승인이 필요하므로 이 화면에서는
// "신청 접수"만 하고 활성화 여부는 이메일 안내 또는 마이페이지에서 확인하도록 한다.

import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { Loader2, CheckCircle2, AlertCircle, Copy, Check } from 'lucide-react';
import { BANK_TRANSFER_ACCOUNT } from '@/lib/payment-constants';

interface Props {
  plan:      'basic' | 'pro';
  amount:    number;
  isAnnual:  boolean;
  onClose:   () => void;
  onBack:    () => void;
}

const PLAN_NAMES: Record<'basic' | 'pro', string> = {
  basic: 'Finance Park Basic',
  pro:   'Finance Park Pro',
};

type Step = 'confirm' | 'processing' | 'requested' | 'error';

export default function ManualBankTransferForm({ plan, amount, isAnnual, onClose, onBack }: Props) {
  const [step, setStep] = useState<Step>('confirm');
  const [errMsg, setErrMsg] = useState('');
  const [copied, setCopied] = useState<'account' | 'name' | null>(null);
  const [depositorName, setDepositorName] = useState('');

  const planLabel = `${PLAN_NAMES[plan]} ${isAnnual ? '연간' : '월간'} 구독`;

  async function submit() {
    setStep('processing');
    setErrMsg('');

    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/payment/bank-transfer/request', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ plan, isAnnual, amount }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? '신청에 실패했습니다.');
      }
      setDepositorName(json.request.depositor_name);
      setStep('requested');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : '신청 중 오류가 발생했습니다.');
      setStep('error');
    }
  }

  function copy(text: string, which: 'account' | 'name') {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <>
      {step !== 'processing' && step !== 'requested' && (
        <button
          onClick={onBack}
          className="text-[12px] text-slate-500 hover:text-slate-300 mb-3 cursor-pointer transition-colors"
        >
          ← 뒤로
        </button>
      )}

      {step === 'confirm' && (
        <>
          <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">계좌이체 안내</p>
          <h2 className="text-[17px] font-bold text-white mb-1">{planLabel}</h2>
          <p className="text-[22px] font-bold text-white mb-5">
            {amount.toLocaleString()}원
            <span className="text-[13px] text-slate-500 ml-1">{isAnnual ? '/ 1년' : '/ 월'}</span>
          </p>

          <div className="rounded-2xl p-4 mb-4" style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}>
            <p className="text-[11px] text-slate-500 mb-1">입금 계좌</p>
            <p className="text-[16px] font-bold text-white mb-3">
              {BANK_TRANSFER_ACCOUNT.bankName} {BANK_TRANSFER_ACCOUNT.accountNumber}
            </p>
            <p className="text-[11px] text-slate-500 mb-1">예금주</p>
            <p className="text-[14px] text-white mb-3">{BANK_TRANSFER_ACCOUNT.accountHolder}</p>
            <div className="pt-3" style={{ borderTop: '1px solid rgba(51,65,85,0.6)' }}>
              <p className="text-[11px] text-amber-300/90 leading-relaxed">
                신청 후 안내되는 <b>입금자명</b>으로 정확히 입금해주셔야 확인이 가능합니다.
              </p>
            </div>
          </div>

          {errMsg && <p className="mb-3 text-[11px] text-red-400">{errMsg}</p>}

          <button
            onClick={submit}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[13.5px] font-bold cursor-pointer transition-colors"
          >
            신청하고 입금자명 안내받기
          </button>
          <p className="mt-4 text-[10px] text-slate-600 text-center leading-relaxed">
            자동 결제가 아닙니다. 입금 확인 후 관리자가 직접 구독을 활성화하며, 영업일 기준 1일 이내 처리됩니다.
          </p>
        </>
      )}

      {step === 'processing' && (
        <div className="flex flex-col items-center gap-4 py-6">
          <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
          <p className="text-[14px] text-slate-300">신청 처리 중...</p>
        </div>
      )}

      {step === 'requested' && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <CheckCircle2 className="w-11 h-11 text-emerald-400" />
          <div>
            <p className="text-[15px] font-semibold text-white mb-1">신청이 접수되었습니다</p>
            <p className="text-[12px] text-slate-400">아래 정보로 입금해주세요.</p>
          </div>

          <div className="w-full rounded-2xl p-4" style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[12px] text-slate-500">입금 계좌</span>
              <button
                onClick={() => copy(BANK_TRANSFER_ACCOUNT.accountNumber, 'account')}
                className="flex items-center gap-1.5 text-white text-[13px] font-semibold cursor-pointer"
              >
                {BANK_TRANSFER_ACCOUNT.bankName} {BANK_TRANSFER_ACCOUNT.accountNumber}
                {copied === 'account' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
              </button>
            </div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[12px] text-slate-500">입금 금액</span>
              <span className="text-white font-semibold text-[13px]">{amount.toLocaleString()}원</span>
            </div>
            <div className="flex items-center justify-between pt-2.5" style={{ borderTop: '1px solid rgba(51,65,85,0.6)' }}>
              <span className="text-[12px] text-amber-300">입금자명 (필수)</span>
              <button
                onClick={() => copy(depositorName, 'name')}
                className="flex items-center gap-1.5 text-amber-300 text-[15px] font-bold cursor-pointer"
              >
                {depositorName}
                {copied === 'name' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <p className="text-[10.5px] text-slate-600 leading-relaxed">
            반드시 위 입금자명으로 입금해주세요. 확인되는 대로 이메일로 안내드립니다.
          </p>

          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[13.5px] font-bold cursor-pointer transition-colors"
          >
            확인했습니다
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <p className="text-[14px] font-semibold text-white">신청 실패</p>
          <p className="text-[12px] text-slate-400 text-center">{errMsg}</p>
          <button
            onClick={() => setStep('confirm')}
            className="mt-1 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold cursor-pointer transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}
    </>
  );
}
