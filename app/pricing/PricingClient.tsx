'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

// ── Types ────────────────────────────────────────────────────────────────────

type PlanType = 'free' | 'basic' | 'pro';
interface Feature { text: string; included: boolean }
interface Plan {
  type: PlanType; name: string;
  monthly: number;
  annual: number;       // 연간 플랜 월 환산 금액
  annualTotal: number;  // 연간 일시불 총액
  annualSaving: number; // 월간 대비 절약 금액
  description: string; features: Feature[]; cta: string;
}

// ── Data ─────────────────────────────────────────────────────────────────────

const PLANS: Plan[] = [
  {
    type: 'free', name: 'FREE', monthly: 0, annual: 0, annualTotal: 0, annualSaving: 0,
    description: '주식 분석을 처음 시작하는 분들을 위한 플랜',
    features: [
      { text: '종목진단 매일 1회', included: true },
      { text: '포트폴리오 진단', included: false },
      { text: '뉴스/시장 데이터 무제한', included: true },
      { text: '워치리스트', included: true },
      { text: 'AI 분석 리포트 저장', included: false },
      { text: '우선순위 분석 처리', included: false },
    ],
    cta: '시작하기',
  },
  {
    type: 'basic', name: 'BASIC', monthly: 4900, annual: 3920, annualTotal: 47040, annualSaving: 11760,
    description: '더 많은 분석이 필요한 투자자를 위한 플랜',
    features: [
      { text: '종목진단 매일 6회', included: true },
      { text: '포트폴리오 진단 월 1회', included: true },
      { text: '뉴스/시장 데이터 무제한', included: true },
      { text: '워치리스트', included: true },
      { text: 'AI 분석 리포트 저장', included: true },
      { text: '우선순위 분석 처리', included: false },
    ],
    cta: '시작하기',
  },
  {
    type: 'pro', name: 'PRO', monthly: 19900, annual: 15920, annualTotal: 191040, annualSaving: 47760,
    description: '전문적인 포트폴리오 관리가 필요한 투자자',
    features: [
      { text: '종목진단 매일 11회', included: true },
      { text: '포트폴리오 진단 월 20회', included: true },
      { text: '뉴스/시장 데이터 무제한', included: true },
      { text: '워치리스트', included: true },
      { text: 'AI 분석 리포트 저장', included: true },
      { text: '우선순위 분석 처리', included: true },
    ],
    cta: '시작하기',
  },
];

const FAQ_ITEMS = [
  {
    q: '언제든지 해지할 수 있나요?',
    a: '네, 언제든지 해지 가능합니다. 해지 후에도 남은 결제 기간 동안 서비스를 계속 이용하실 수 있습니다.',
  },
  {
    q: '결제는 어떻게 이루어지나요?',
    a: '신용카드, 체크카드, 카카오페이 등 다양한 결제 수단을 지원할 예정입니다. 현재 결제 시스템 연동 준비 중입니다.',
  },
  {
    q: '환불 정책은 어떻게 되나요?',
    a: '결제 후 7일 이내에는 전액 환불이 가능합니다. 7일 이후에는 남은 기간에 대한 일할 계산 환불이 적용됩니다.',
  },
  {
    q: '무료 플랜과 유료 플랜의 차이는?',
    a: '무료 플랜은 종목진단을 매일 1회 무료로 제공합니다. 유료 플랜에서는 더 많은 진단 횟수, 포트폴리오 진단, AI 리포트 저장, 우선순위 처리 등 고급 기능을 이용하실 수 있습니다.',
  },
];

// ── CardContent ───────────────────────────────────────────────────────────────

function CardContent({
  plan, annual, userPlan, isLoggedIn, onAction,
}: {
  plan: Plan; annual: boolean;
  userPlan: PlanType | null; isLoggedIn: boolean;
  onAction: (type: PlanType) => void;
}) {
  const isPro   = plan.type === 'pro';
  const isBasic = plan.type === 'basic';
  const isFree  = plan.type === 'free';
  const isCurrent = isLoggedIn && userPlan === plan.type;
  const p = annual ? plan.annual : plan.monthly;

  const checkHex   = isPro ? '#f59e0b' : '#6366f1';
  const checkBgHex = isPro ? 'rgba(245,158,11,0.18)' : 'rgba(99,102,241,0.18)';
  const nameColor  = isPro ? '#fbbf24' : isBasic ? '#818cf8' : '#64748b';
  const ctaBg      = isPro
    ? 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)'
    : isBasic
    ? 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)'
    : undefined;

  return (
    <div className="flex flex-col gap-5 p-6 h-full">
      {/* Plan name + 현재 플랜 배지 */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-bold tracking-[0.18em]" style={{ color: nameColor }}>
            {plan.name}
          </span>
          {isCurrent && (
            <span className="flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
              style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)' }}>
              <svg width="7" height="6" viewBox="0 0 8 7" fill="none">
                <path d="M1 3.5l2 2 4-4" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              현재 플랜
            </span>
          )}
        </div>
        <p className="text-[12px] text-slate-500 leading-snug">{plan.description}</p>
      </div>

      {/* Price */}
      <div>
        <div className="flex items-end gap-1">
          {isFree ? (
            <span className="text-[2.5rem] font-bold text-white leading-none">무료</span>
          ) : (
            <>
              <span className="text-slate-400 text-[13px] mb-[5px]">₩</span>
              <span className="text-[2.5rem] font-bold text-white leading-none">{p.toLocaleString()}</span>
              <span className="text-slate-400 text-sm mb-[5px]">/월</span>
            </>
          )}
          {annual && !isFree && (
            <span className="ml-1.5 mb-[5px] text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              {plan.annualSaving.toLocaleString()}원 절약
            </span>
          )}
        </div>
        {isFree ? (
          <p className="text-[11px] text-slate-600 mt-1">영원히 무료</p>
        ) : annual ? (
          <div className="mt-2.5 pt-2.5 border-t border-slate-700/40">
            <p className="text-[10px] text-slate-500 mb-1">연간 총 결제금액</p>
            <p className="text-[17px] font-bold text-slate-100 leading-none">
              {plan.annualTotal.toLocaleString()}<span className="text-[13px] font-medium text-slate-400 ml-0.5">원</span>
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-slate-600 mt-1">월별 청구</p>
        )}
      </div>

      {/* CTA */}
      {isCurrent ? (
        <button
          disabled
          className="w-full py-3 rounded-xl text-[13px] font-bold cursor-default"
          style={{ background: 'rgba(51,65,85,0.5)', color: '#64748b', border: '1px solid rgba(51,65,85,0.4)' }}
        >
          현재 이용 중
        </button>
      ) : (
        <button
          onClick={() => onAction(plan.type)}
          className={`w-full py-3 rounded-xl text-[13px] font-bold transition-all cursor-pointer ${
            isFree
              ? 'text-slate-300 border border-slate-600 hover:border-slate-500 hover:bg-slate-800/40'
              : isPro
              ? 'text-slate-900 hover:opacity-90'
              : 'text-white hover:opacity-90'
          }`}
          style={ctaBg ? { background: ctaBg } : undefined}
        >
          {annual && !isFree ? '연간 시작하기' : plan.cta}
        </button>
      )}

      {/* Divider */}
      <div className="h-px bg-slate-700/30" />

      {/* Features */}
      <ul className="flex flex-col gap-2.5 flex-1">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-center gap-2.5">
            <span
              className="w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: f.included ? checkBgHex : 'rgba(30,41,59,0.8)' }}
            >
              {f.included ? (
                <svg width="8" height="7" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l3 3 5-6" stroke={checkHex} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="6" height="6" viewBox="0 0 8 8" fill="none">
                  <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <span className={`text-[12.5px] leading-snug ${f.included ? 'text-slate-300' : 'text-slate-600'}`}>
              {f.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── PlanCard ──────────────────────────────────────────────────────────────────

function PlanCard({
  plan, annual, userPlan, isLoggedIn, onAction,
}: {
  plan: Plan; annual: boolean;
  userPlan: PlanType | null; isLoggedIn: boolean;
  onAction: (type: PlanType) => void;
}) {
  const isPro   = plan.type === 'pro';
  const isBasic = plan.type === 'basic';
  const innerBg = isPro ? '#0d0c18' : isBasic ? '#0a0d1f' : '#111827';

  const content = (
    <CardContent
      plan={plan} annual={annual}
      userPlan={userPlan} isLoggedIn={isLoggedIn}
      onAction={onAction}
    />
  );

  if (isPro) return (
    <div className="group cursor-pointer relative pt-7">
      <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none z-10">
        <span
          className="text-[10px] font-bold px-3 py-1.5 rounded-full shadow-lg"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)', color: '#0f1117' }}
        >
          🔥 가장 인기
        </span>
      </div>
      <div
        className="p-px rounded-2xl transition-all duration-300 group-hover:-translate-y-2 group-hover:shadow-[0_0_44px_rgba(245,158,11,0.45)]"
        style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 60%, #ef4444 100%)', boxShadow: '0 0 24px rgba(245,158,11,0.28)' }}
      >
        <div className="rounded-[15px] overflow-hidden h-full" style={{ backgroundColor: innerBg }}>
          {content}
        </div>
      </div>
    </div>
  );

  if (isBasic) return (
    <div className="group cursor-pointer pt-7">
      <div
        className="p-px rounded-2xl transition-all duration-300 group-hover:-translate-y-2 group-hover:shadow-[0_0_32px_rgba(99,102,241,0.38)]"
        style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', boxShadow: '0 0 16px rgba(99,102,241,0.18)' }}
      >
        <div className="rounded-[15px] overflow-hidden h-full" style={{ backgroundColor: innerBg }}>
          {content}
        </div>
      </div>
    </div>
  );

  return (
    <div className="group cursor-pointer pt-7">
      <div
        className="border border-slate-700/60 rounded-2xl transition-all duration-300 group-hover:-translate-y-2 hover:border-slate-600/80"
        style={{ backgroundColor: innerBg }}
      >
        {content}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PricingClient() {
  const router  = useRouter();
  const [annual,     setAnnual]     = useState(false);
  const [openFaq,    setOpenFaq]    = useState<number | null>(null);
  const [toast,      setToast]      = useState(false);
  const [userPlan,   setUserPlan]   = useState<PlanType | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // 현재 로그인 유저 + plan 조회
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setIsLoggedIn(true);
      try {
        const { data: row } = await supabase
          .from('users')
          .select('plan')
          .eq('id', data.user.id)
          .maybeSingle();
        const plan = (row?.plan as PlanType | undefined) ?? 'free';
        setUserPlan(plan);
      } catch {
        setUserPlan('free');
      }
    });
  }, []); // eslint-disable-line

  const showToast = () => {
    setToast(true);
    setTimeout(() => setToast(false), 3000);
  };

  const handleAction = (type: PlanType) => {
    if (!isLoggedIn) { router.push('/auth/login'); return; }
    if (type === 'free') { router.push('/'); return; }
    showToast();
  };

  return (
    <div className="min-h-screen relative" style={{ background: 'linear-gradient(180deg, #0f1117 0%, #0d1033 55%, #0a0d1f 100%)' }}>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-full shadow-2xl shadow-black/40 backdrop-blur-sm"
            style={{ background: '#1e2130', border: '1px solid rgba(100,116,139,0.4)' }}>
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span className="text-[13px] text-slate-200 font-medium whitespace-nowrap">결제 기능 준비 중입니다</span>
          </div>
        </div>
      )}

      {/* ── 헤더 섹션 ── */}
      <section className="relative pt-20 pb-14 text-center overflow-hidden">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[380px] pointer-events-none opacity-[0.13]"
          style={{ background: 'radial-gradient(ellipse, #4f46e5 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, #4f46e5, transparent)' }}
        />

        <div className="relative z-10 max-w-3xl mx-auto px-6">
          <div className="inline-flex items-center gap-2 mb-6 bg-indigo-500/10 border border-indigo-500/30 rounded-full px-4 py-1.5">
            <Zap className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-xs font-semibold text-indigo-300 tracking-wide">요금제</span>
          </div>

          <h1 className="text-3xl md:text-[2.75rem] font-bold text-white mb-4 leading-tight">
            당신의 투자를<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
              한 단계 업그레이드하세요
            </span>
          </h1>
          <p className="text-slate-400 text-sm mb-10">AI가 분석하는 실시간 주식 인사이트</p>

          {/* 월간/연간 토글 */}
          <div className="inline-flex items-center gap-1 rounded-full p-1"
            style={{ background: 'rgba(15,17,23,0.7)', border: '1px solid rgba(51,65,85,0.6)' }}>
            <button
              onClick={() => setAnnual(false)}
              className={`px-5 py-2 rounded-full text-[13px] font-semibold transition-all ${
                !annual ? 'bg-white text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              월간
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`flex items-center gap-2 px-5 py-2 rounded-full text-[13px] font-semibold transition-all ${
                annual ? 'bg-white text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              연간
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white whitespace-nowrap">
                20% 할인 · 일시불
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* ── 플랜 카드 ── */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map(plan => (
            <PlanCard
              key={plan.type}
              plan={plan}
              annual={annual}
              userPlan={userPlan}
              isLoggedIn={isLoggedIn}
              onAction={handleAction}
            />
          ))}
        </div>
      </section>

      {/* ── 1회권 ── */}
      <section className="max-w-3xl mx-auto px-4 pb-20">
        <div className="flex items-center gap-4 mb-10">
          <div className="flex-1 h-px bg-slate-800" />
          <div className="text-center">
            <h2 className="text-lg font-bold text-white">구독 없이 필요할 때만</h2>
            <p className="text-slate-500 text-[12px] mt-1">1회권으로 언제든지 이용하세요</p>
          </div>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="group cursor-pointer" onClick={() => isLoggedIn ? showToast() : router.push('/auth/login')}>
            <div
              className="p-px rounded-2xl transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_0_24px_rgba(99,102,241,0.38)]"
              style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', boxShadow: '0 0 12px rgba(99,102,241,0.18)' }}
            >
              <div className="rounded-[15px] px-5 py-4 flex items-center gap-4" style={{ backgroundColor: '#0a0d1f' }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-xl" style={{ background: 'rgba(99,102,241,0.2)' }}>🔍</div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[13px] font-bold text-white">종목진단 1회권</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">즉시 사용 가능</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[17px] font-bold text-white">1,000<span className="text-[12px] font-medium text-slate-400">원</span></p>
                  <p className="text-[10px] font-semibold" style={{ color: '#818cf8' }}>1회</p>
                </div>
              </div>
            </div>
          </div>

          <div className="group cursor-pointer" onClick={() => isLoggedIn ? showToast() : router.push('/auth/login')}>
            <div
              className="p-px rounded-2xl transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_0_24px_rgba(168,85,247,0.38)]"
              style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)', boxShadow: '0 0 12px rgba(139,92,246,0.18)' }}
            >
              <div className="rounded-[15px] px-5 py-4 flex items-center gap-4" style={{ backgroundColor: '#0a0d1f' }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-xl" style={{ background: 'rgba(139,92,246,0.2)' }}>📊</div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[13px] font-bold text-white">포트폴리오 진단 1회권</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">즉시 사용 가능</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[17px] font-bold text-white">1,900<span className="text-[12px] font-medium text-slate-400">원</span></p>
                  <p className="text-[10px] font-semibold" style={{ color: '#c084fc' }}>1회</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="max-w-2xl mx-auto px-4 pb-28">
        <div className="text-center mb-10">
          <h2 className="text-xl font-bold text-white mb-2">자주 묻는 질문</h2>
          <p className="text-slate-500 text-[12px]">궁금한 점이 있으신가요?</p>
        </div>

        <div className="flex flex-col gap-2">
          {FAQ_ITEMS.map((item, i) => (
            <div
              key={i}
              className="rounded-xl overflow-hidden"
              style={{ background: 'rgba(15,17,23,0.6)', border: '1px solid rgba(51,65,85,0.5)' }}
            >
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer hover:bg-slate-800/30 transition-colors"
              >
                <span className="text-[13.5px] font-medium text-slate-200 pr-4">{item.q}</span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`}
                />
              </button>
              {openFaq === i && (
                <div className="px-5 pb-4">
                  <p className="text-[13px] text-slate-400 leading-relaxed">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
