'use client';

// 계좌이체(무통장입금) 신청 폼 — PG 가상계좌(VirtualAccountForm)와 달리 PG 연동이 전혀 없다.
// 회사 명의 고정 계좌로 사용자가 직접 입금한다. 여기서 입력받는 예금주 실명(입금 계좌
// 명의)과 CODEF로 조회한 입금 적요(은행이 자동 표시하는 계좌주명)를 대조해 금액+이름이
// 유니크하게 일치하면 자동 승인되고(app/api/cron/bank-transfer-auto-match), 애매하면
// 관리자가 수동 매칭·승인한다(/admin/payments) — 이 화면에서는 "신청 접수"만 하고
// 활성화 여부는 이메일 안내 또는 마이페이지에서 확인하도록 한다.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { Loader2, CheckCircle2, AlertCircle, Copy, Check, Star } from 'lucide-react';
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

// Pro 플랜의 브리핑/리포트 메일은 관심기업 기준으로 발송되므로, Pro 신청 직후
// 관심기업이 비어있으면 등록을 유도한다. 이미 등록돼 있으면 안심시키는 톤으로 전환.
type WatchlistNudge = 'none' | 'empty' | 'has-items';

export default function ManualBankTransferForm({ plan, amount, isAnnual, onClose, onBack }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('confirm');
  const [errMsg, setErrMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [depositorRealName, setDepositorRealName] = useState('');
  const [nudge, setNudge] = useState<WatchlistNudge>('none');
  // 계좌 안내 화면이 완전히 닫힌 뒤에만 true — nudge 콘텐츠가 먼저 준비돼 있어도
  // 이 값이 true가 되기 전에는 절대 렌더링하지 않는다(두 모달 동시 노출 방지).
  const [nudgeVisible, setNudgeVisible] = useState(false);
  // 관심기업 조회는 신청 접수 직후 미리 시작해두되(빠른 응답을 위해), 실제 모달을
  // 띄우는 건 "확인했습니다" 클릭 시점 — 그 사이 조회가 안 끝났으면 클릭 시 대기한다.
  const nudgeCheckRef = useRef<Promise<WatchlistNudge> | null>(null);

  const planLabel = `${PLAN_NAMES[plan]} ${isAnnual ? '연간' : '월간'} 구독`;

  async function submit() {
    if (!depositorRealName.trim()) {
      setErrMsg('예금주 실명을 입력해주세요.');
      return;
    }
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
        body: JSON.stringify({ plan, isAnnual, amount, depositorRealName: depositorRealName.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? '신청에 실패했습니다.');
      }
      setStep('requested');

      if (plan === 'pro') {
        const userId = data.session?.user?.id;
        nudgeCheckRef.current = (async (): Promise<WatchlistNudge> => {
          if (!userId) return 'none';
          const { count } = await supabase
            .from('watchlist')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);
          return (count ?? 0) > 0 ? 'has-items' : 'empty';
        })();
      }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : '신청 중 오류가 발생했습니다.');
      setStep('error');
    }
  }

  // "확인했습니다" 클릭 — 계좌 안내 화면을 먼저 완전히 닫은 뒤에만 관심기업 모달을 띄운다.
  async function handleRequestedConfirm() {
    if (nudgeCheckRef.current) {
      const result = await nudgeCheckRef.current;
      if (result !== 'none') {
        setNudge(result);
        setNudgeVisible(true);
        return;
      }
    }
    onClose();
  }

  function dismissNudge() {
    setNudgeVisible(false);
    onClose();
  }

  function goToWatchlist() {
    setNudgeVisible(false);
    onClose();
    router.push('/');
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
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
                입금하실 계좌의 <b>예금주명</b>으로 자동 확인됩니다 — 은행 앱의 적요(메모)란은 따로 건드리지 않으셔도 됩니다.
              </p>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-[11.5px] text-slate-500 mb-1.5">입금하실 계좌의 예금주명</label>
            <input
              value={depositorRealName}
              onChange={(e) => setDepositorRealName(e.target.value)}
              placeholder="예: 홍길동"
              className="w-full px-3 py-2.5 rounded-lg text-[13px] text-white placeholder-slate-600 outline-none"
              style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
            />
            <p className="mt-1.5 text-[10.5px] text-slate-600 leading-relaxed">
              입금 계좌 명의와 정확히 일치해야 자동으로 확인됩니다. 마이페이지에서 나중에 수정할 수 있습니다.
            </p>
          </div>

          {errMsg && <p className="mb-3 text-[11px] text-red-400">{errMsg}</p>}

          <button
            onClick={submit}
            disabled={!depositorRealName.trim()}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13.5px] font-bold cursor-pointer transition-colors"
          >
            신청하기
          </button>
          <p className="mt-4 text-[10px] text-slate-600 text-center leading-relaxed">
            자동 결제가 아닙니다. 입금 확인 후 구독이 활성화되며, 확인이 지연될 경우 관리자가 직접 처리합니다.
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
            <p className="text-[12px] text-slate-400">아래 계좌로 입금해주세요.</p>
          </div>

          <div className="w-full rounded-2xl p-4" style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[12px] text-slate-500">입금 계좌</span>
              <button
                onClick={() => copy(BANK_TRANSFER_ACCOUNT.accountNumber)}
                className="flex items-center gap-1.5 text-white text-[13px] font-semibold cursor-pointer"
              >
                {BANK_TRANSFER_ACCOUNT.bankName} {BANK_TRANSFER_ACCOUNT.accountNumber}
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
              </button>
            </div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[12px] text-slate-500">입금 금액</span>
              <span className="text-white font-semibold text-[13px]">{amount.toLocaleString()}원</span>
            </div>
            <div className="flex items-center justify-between pt-2.5" style={{ borderTop: '1px solid rgba(51,65,85,0.6)' }}>
              <span className="text-[12px] text-amber-300">입금 계좌 예금주명</span>
              <span className="text-amber-300 text-[15px] font-bold">{depositorRealName}</span>
            </div>
          </div>

          <p className="text-[10.5px] text-slate-600 leading-relaxed">
            입금 계좌의 예금주명이 위와 일치하면 적요(메모)는 따로 입력하지 않아도 됩니다.
            입금 확인 후 <span className="text-slate-400 font-semibold">최대 30분 이내</span> 자동으로 활성화되며,
            확인이 어려운 경우 관리자가 직접 확인 후 처리해드립니다 (영업일 기준 1일 이내).
          </p>

          <button
            onClick={handleRequestedConfirm}
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

      {/* Pro 신청 완료 직후 — 계좌 안내 화면을 "확인했습니다"로 닫은 뒤에만 순차적으로 표시 */}
      {nudgeVisible && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={dismissNudge} />
          <div
            className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl text-center"
            style={{ background: '#0f1117', border: '1px solid rgba(52,211,153,0.3)' }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)' }}
            >
              <Star className="w-5.5 h-5.5 text-amber-400" fill="currentColor" />
            </div>

            {nudge === 'empty' ? (
              <>
                <h3 className="text-[16px] font-bold text-white mb-2.5">관심기업을 등록해주세요</h3>
                <p className="text-[12.5px] text-slate-400 leading-relaxed mb-5">
                  Pro 플랜의 장 시작 전 브리핑과 장 마감 후 리포트는 회원님이 등록한 관심기업을
                  기준으로 발송됩니다. 관심기업을 등록하지 않으면 메일을 받아보실 수 없어요.
                  지금 바로 등록하고 Pro 플랜을 100% 활용해보세요.
                </p>
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={goToWatchlist}
                    className="w-full py-3 rounded-xl text-[13.5px] font-bold text-white cursor-pointer transition-all hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                  >
                    관심기업 등록하러 가기
                  </button>
                  <button
                    onClick={dismissNudge}
                    className="w-full py-2.5 rounded-xl text-[12.5px] font-semibold text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
                  >
                    나중에 하기
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-[16px] font-bold text-white mb-2.5">이미 관심기업을 등록하셨네요</h3>
                <p className="text-[12.5px] text-slate-400 leading-relaxed mb-5">
                  Pro 플랜의 장 시작 전 브리핑과 장 마감 후 리포트가 등록하신 관심기업을 기준으로
                  정상 발송됩니다. 관심기업은 언제든 추가하거나 변경하실 수 있어요.
                </p>
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={goToWatchlist}
                    className="w-full py-3 rounded-xl text-[13.5px] font-bold text-white cursor-pointer transition-all hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                  >
                    관심기업 관리하러 가기
                  </button>
                  <button
                    onClick={dismissNudge}
                    className="w-full py-2.5 rounded-xl text-[12.5px] font-semibold text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
                  >
                    확인
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
