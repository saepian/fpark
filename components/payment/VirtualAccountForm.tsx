'use client';

// 계좌이체(가상계좌) 발급 폼
// 자동 출금이 아니라, 발급된 계좌로 사용자가 직접 입금하는 방식.
// 입금 확인(구독 활성화)은 /api/payment/webhook 이 PortOne 웹훅을 받아 비동기로 처리 —
// 이 화면에서는 발급된 계좌 정보만 보여주고, 활성화 여부는 마이페이지에서 확인하도록 안내.

import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { Loader2, CheckCircle2, AlertCircle, Copy, Check } from 'lucide-react';

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

// 실제 PortOne 테스트 채널로 확인된, 이 가맹점 계약에서 발급 가능한 은행만 노출
// (국민/카카오/토스는 이 채널에서 거부됨 — 운영 전환 시 재검증 필요)
const BANKS = [
  { code: 'SHINHAN',  name: '신한은행' },
  { code: 'WOORI',    name: '우리은행' },
  { code: 'HANA',     name: '하나은행' },
  { code: 'NONGHYUP', name: '농협은행' },
  { code: 'IBK',      name: 'IBK기업은행' },
  { code: 'K_BANK',   name: '케이뱅크' },
];

const BANK_NAME_BY_CODE = Object.fromEntries(BANKS.map((b) => [b.code, b.name]));

type Step = 'input' | 'processing' | 'issued' | 'error';

function formatAccountNumber(raw: string) {
  return raw.replace(/(\d{3,6})(?=\d)/g, '$1-').replace(/-$/, '');
}

export default function VirtualAccountForm({ plan, amount, isAnnual, onClose, onBack }: Props) {
  const [step, setStep] = useState<Step>('input');
  const [errMsg, setErrMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const [bank, setBank]           = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');

  const [issued, setIssued] = useState<{
    bank: string; accountNumber: string; remitteeName?: string; dueAt: string;
  } | null>(null);

  const planLabel = `${PLAN_NAMES[plan]} ${isAnnual ? '연간' : '월간'} 구독`;

  async function submit() {
    if (!bank) {
      setErrMsg('입금받으실 은행을 선택해주세요.');
      return;
    }
    if (!buyerName.trim()) {
      setErrMsg('이름을 입력해주세요.');
      return;
    }
    if (!buyerPhone.trim()) {
      setErrMsg('휴대폰 번호를 입력해주세요.');
      return;
    }
    setStep('processing');
    setErrMsg('');

    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/payment/virtual-account/issue', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ plan, isAnnual, bank, buyerName: buyerName.trim(), buyerPhone }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? '가상계좌 발급에 실패했습니다.');
      }
      setIssued({
        bank:          json.bank,
        accountNumber: json.accountNumber,
        remitteeName:  json.remitteeName,
        dueAt:         json.dueAt,
      });
      setStep('issued');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : '가상계좌 발급 중 오류가 발생했습니다.');
      setStep('error');
    }
  }

  function copyAccount() {
    if (!issued) return;
    navigator.clipboard.writeText(issued.accountNumber.replace(/-/g, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <>
      {step !== 'processing' && step !== 'issued' && (
        <button
          onClick={onBack}
          className="text-[12px] text-slate-500 hover:text-slate-300 mb-3 cursor-pointer transition-colors"
        >
          ← 뒤로
        </button>
      )}

      {step === 'input' && (
        <>
          <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">계좌이체 — 입금 계좌 발급</p>
          <h2 className="text-[17px] font-bold text-white mb-1">{planLabel}</h2>
          <p className="text-[22px] font-bold text-white mb-5">
            {amount.toLocaleString()}원
            <span className="text-[13px] text-slate-500 ml-1">{isAnnual ? '/ 1년' : '/ 월'}</span>
          </p>

          <div className="flex flex-col gap-3 mb-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">입금받으실 은행</label>
              <select
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-[13px] text-white outline-none"
                style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
              >
                <option value="">은행을 선택하세요</option>
                {BANKS.map((b) => (
                  <option key={b.code} value={b.code}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">이름</label>
              <input
                type="text"
                placeholder="홍길동"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-[13px] text-white placeholder-slate-600 outline-none"
                style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">휴대폰 번호</label>
              <input
                type="tel"
                placeholder="010-0000-0000"
                value={buyerPhone}
                onChange={(e) => setBuyerPhone(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-[13px] text-white placeholder-slate-600 outline-none"
                style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
              />
            </div>
          </div>

          {errMsg && <p className="mb-3 text-[11px] text-red-400">{errMsg}</p>}

          <button
            onClick={submit}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[13.5px] font-bold cursor-pointer transition-colors"
          >
            입금 계좌 발급받기
          </button>
          <p className="mt-4 text-[10px] text-slate-600 text-center leading-relaxed">
            자동 출금이 아닙니다. 발급된 계좌로 직접 입금하시면 확인 후 구독이 활성화됩니다.<br />
            매달 갱신 시점에는 새 입금 안내를 이메일로 보내드립니다.
          </p>
        </>
      )}

      {step === 'processing' && (
        <div className="flex flex-col items-center gap-4 py-6">
          <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
          <p className="text-[14px] text-slate-300">계좌 발급 중...</p>
        </div>
      )}

      {step === 'issued' && issued && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <CheckCircle2 className="w-11 h-11 text-emerald-400" />
          <div>
            <p className="text-[15px] font-semibold text-white mb-1">입금 계좌가 발급되었습니다</p>
            <p className="text-[12px] text-slate-400">아래 계좌로 기한 내 입금해주세요.</p>
          </div>

          <div className="w-full rounded-2xl p-4" style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}>
            <p className="text-[11px] text-slate-500 mb-1">{BANK_NAME_BY_CODE[issued.bank] ?? issued.bank}</p>
            <div className="flex items-center justify-center gap-2 mb-2">
              <p className="text-[19px] font-bold text-white tabular-nums">{formatAccountNumber(issued.accountNumber)}</p>
              <button onClick={copyAccount} className="text-slate-400 hover:text-white cursor-pointer transition-colors" aria-label="계좌번호 복사">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            {issued.remitteeName && (
              <p className="text-[12px] text-slate-400">예금주: {issued.remitteeName}</p>
            )}
            <div className="mt-3 pt-3 flex items-center justify-between text-[12px]" style={{ borderTop: '1px solid rgba(51,65,85,0.6)' }}>
              <span className="text-slate-500">입금 금액</span>
              <span className="text-white font-semibold">{amount.toLocaleString()}원</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[12px]">
              <span className="text-slate-500">입금 기한</span>
              <span className="text-amber-300 font-semibold">
                {new Date(issued.dueAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}까지
              </span>
            </div>
          </div>

          <p className="text-[10.5px] text-slate-600 leading-relaxed">
            입금 확인까지 시간이 조금 걸릴 수 있습니다. 활성화 여부는 마이페이지에서 확인 가능합니다.
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
          <p className="text-[14px] font-semibold text-white">계좌 발급 실패</p>
          <p className="text-[12px] text-slate-400 text-center">{errMsg}</p>
          <button
            onClick={() => setStep('input')}
            className="mt-1 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold cursor-pointer transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}
    </>
  );
}
