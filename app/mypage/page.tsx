'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import PageBackground from '@/components/layout/PageBackground';
import { BANK_TRANSFER_ACCOUNT, PLAN_USAGE_LIMITS, PLAN_AMOUNTS } from '@/lib/payment-constants';

type PlanType = 'free' | 'basic' | 'pro';

interface MyPageData {
  email: string;
  name: string | null;
  avatarUrl: string | null;
  plan: PlanType;
  createdAt: string;
  emailAlertEnabled: boolean;
  morningBriefingEnabled: boolean;
  depositorRealName: string | null;
  usage: { diagnosisToday: number; portfolioMonth: number; nextResetDate: string };
  payments: { id: string; created_at: string; plan: string; amount: number; status: string }[];
  subscription: {
    status:        string;
    paymentMethod: string | null;
    nextBilledAt:  string | null;
    pendingBankTransfer: {
      depositorRealName: string | null; amount: number; plan: string; isAnnual: boolean; requestedAt: string;
    } | null;
  };
}

interface CancelPreview {
  plan:           string;
  paidAmount:     number;
  usageDetected:  boolean;
  elapsedDays:    number;
  refundEligible: boolean;
  refundAmount:   number;
  reasonText:     string;
  nextBilledAt:   string | null;
}

const SUBSCRIPTION_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:            { label: '정상',       color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  awaiting_deposit:  { label: '입금 대기',  color: '#fbbf24', bg: 'rgba(245,158,11,0.12)' },
  paused:            { label: '일시 정지',  color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  payment_failed:    { label: '결제 실패',  color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  cancelled:         { label: '해지됨',     color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
  inactive:          { label: '무료 플랜',  color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
  pending_renewal:      { label: '갱신 대기',   color: '#fbbf24', bg: 'rgba(245,158,11,0.12)' },
  expired:              { label: '만료됨',      color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  pending_cancellation: { label: '해지 예약됨', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
};

const PLAN_META = {
  free: {
    label: 'FREE',
    color: '#64748b',
    textGradient: undefined as string | undefined,
    badgeBg: 'rgba(100,116,139,0.15)',
    badgeBorder: 'rgba(100,116,139,0.35)',
    cardGradient: undefined as string | undefined,
    cardInnerBg: '#0f1117',
    avatarRing: '#334155',
  },
  basic: {
    label: 'BASIC',
    color: '#818cf8',
    textGradient: 'linear-gradient(135deg, #818cf8 0%, #c084fc 100%)',
    badgeBg: 'rgba(129,140,248,0.18)',
    badgeBorder: 'rgba(129,140,248,0.4)',
    cardGradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
    cardInnerBg: '#0a0d1f',
    avatarRing: '#4f46e5',
  },
  pro: {
    label: 'PRO',
    color: '#fbbf24',
    textGradient: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
    badgeBg: 'rgba(245,158,11,0.18)',
    badgeBorder: 'rgba(245,158,11,0.4)',
    cardGradient: 'linear-gradient(135deg, #f59e0b 0%, #f97316 60%, #ef4444 100%)',
    cardInnerBg: '#0d0c18',
    avatarRing: '#f59e0b',
  },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  approved: { label: '완료',   color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  pending:  { label: '대기중', color: '#fbbf24', bg: 'rgba(245,158,11,0.12)' },
  rejected: { label: '거절됨', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  expired:  { label: '만료됨', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
};

// ── 그라데이션 테두리 카드 래퍼 ────────────────────────────────────────────────
function GradientCard({
  gradient,
  innerBg,
  className = '',
  children,
}: {
  gradient?: string;
  innerBg: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (gradient) {
    return (
      <div className={`p-px rounded-2xl ${className}`} style={{ background: gradient }}>
        <div className="rounded-[15px] p-6 md:p-7" style={{ backgroundColor: innerBg }}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`rounded-2xl border border-slate-800/70 p-6 md:p-7 ${className}`}
      style={{ backgroundColor: innerBg }}
    >
      {children}
    </div>
  );
}

// ── 섹션 레이블 ────────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500 mb-5">
      {children}
    </p>
  );
}

// ── 프로그레스 바 ───────────────────────────────────────────────────────────────
function ProgressBar({
  value,
  max,
  gradient,
  glowColor,
}: {
  value: number;
  max: number;
  gradient: string;
  glowColor?: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(30,37,55,0.8)' }}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{
          width: `${pct}%`,
          background: gradient,
          boxShadow: glowColor ? `0 0 10px ${glowColor}` : undefined,
        }}
      />
    </div>
  );
}

// ── 스켈레톤 ───────────────────────────────────────────────────────────────────
function SkeletonCard({ height = 140 }: { height?: number }) {
  return (
    <div
      className="rounded-2xl border border-slate-800/60 animate-pulse"
      style={{ height, backgroundColor: '#0d1117' }}
    />
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

export default function MyPage() {
  const router = useRouter();
  const [data, setData] = useState<MyPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [emailAlertEnabled, setEmailAlertEnabled] = useState(true);
  const [togglingEmail, setTogglingEmail] = useState(false);
  const [morningBriefingEnabled, setMorningBriefingEnabled] = useState(true);
  const [togglingMorning, setTogglingMorning] = useState(false);
  const [depositorRealName, setDepositorRealName] = useState('');
  const [savingDepositorName, setSavingDepositorName] = useState(false);
  const [depositorNameSaved, setDepositorNameSaved] = useState(false);
  const [depositorNameError, setDepositorNameError] = useState('');

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);
  const [cancelPreviewLoading, setCancelPreviewLoading] = useState(false);
  const [cancelPreviewError, setCancelPreviewError] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [refundBank, setRefundBank] = useState('');
  const [refundAccountNumber, setRefundAccountNumber] = useState('');
  const [refundAccountHolder, setRefundAccountHolder] = useState('');

  const loadMypage = () => {
    return fetch('/api/mypage')
      .then(async r => {
        if (r.status === 401) { router.push(loginUrlWithRedirect(window.location.pathname + window.location.search)); return; }
        const json = await r.json();
        setData(json);
        setEmailAlertEnabled(json.emailAlertEnabled ?? true);
        setMorningBriefingEnabled(json.morningBriefingEnabled ?? true);
        setDepositorRealName(json.depositorRealName ?? '');
      })
      .catch(() => router.push(loginUrlWithRedirect(window.location.pathname + window.location.search)));
  };

  useEffect(() => {
    loadMypage().finally(() => setLoading(false));
  }, []); // eslint-disable-line

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const handleToggleEmail = async () => {
    setTogglingEmail(true);
    const next = !emailAlertEnabled;
    setEmailAlertEnabled(next);
    await fetch('/api/mypage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_alert_enabled: next }),
    });
    setTogglingEmail(false);
  };

  const handleToggleMorning = async () => {
    setTogglingMorning(true);
    const next = !morningBriefingEnabled;
    setMorningBriefingEnabled(next);
    await fetch('/api/mypage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ morning_briefing_enabled: next }),
    });
    setTogglingMorning(false);
  };

  const handleSaveDepositorName = async () => {
    const trimmed = depositorRealName.trim();
    if (!trimmed) {
      setDepositorNameError('예금주 실명을 입력해주세요.');
      return;
    }
    setSavingDepositorName(true);
    setDepositorNameError('');
    setDepositorNameSaved(false);
    try {
      const res = await fetch('/api/mypage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositor_real_name: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '저장에 실패했습니다.');
      setDepositorRealName(trimmed);
      setDepositorNameSaved(true);
      setTimeout(() => setDepositorNameSaved(false), 2400);
    } catch (e) {
      setDepositorNameError(e instanceof Error ? e.message : '저장에 실패했습니다.');
    } finally {
      setSavingDepositorName(false);
    }
  };

  const handleWithdraw = async () => {
    setWithdrawing(true);
    const res = await fetch('/api/mypage/delete', { method: 'DELETE' });
    if (res.ok) {
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = '/';
    } else {
      setWithdrawing(false);
      alert('탈퇴 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const handleOpenCancelModal = async () => {
    setShowCancelModal(true);
    setCancelPreview(null);
    setCancelPreviewError('');
    setRefundBank('');
    setRefundAccountNumber('');
    setRefundAccountHolder('');
    setCancelPreviewLoading(true);
    try {
      const res = await fetch('/api/subscription/cancel');
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '예상 환불액을 계산하지 못했습니다.');
      setCancelPreview(json);
    } catch (e) {
      setCancelPreviewError(e instanceof Error ? e.message : '예상 환불액을 계산하지 못했습니다.');
    } finally {
      setCancelPreviewLoading(false);
    }
  };

  const handleSubmitCancel = async () => {
    if (!cancelPreview) return;
    if (cancelPreview.refundAmount > 0 && (!refundBank || !refundAccountNumber || !refundAccountHolder)) {
      alert('환불받을 계좌 정보를 모두 입력해주세요.');
      return;
    }
    setCancelSubmitting(true);
    try {
      const res = await fetch('/api/subscription/cancel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refundAccountBank:   refundBank,
          refundAccountNumber,
          refundAccountHolder: refundAccountHolder,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '취소 처리 중 오류가 발생했습니다.');
      setShowCancelModal(false);
      await loadMypage();
      alert(
        json.refundEligible
          ? `구독이 해지되었습니다.${json.refundAmount > 0 ? ` 환불 예정액 ${json.refundAmount.toLocaleString()}원은 확인 후 입력하신 계좌로 송금됩니다.` : ''}`
          : '해지가 예약되었습니다. 다음 결제일까지는 계속 이용하실 수 있습니다.',
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : '취소 처리 중 오류가 발생했습니다.');
    } finally {
      setCancelSubmitting(false);
    }
  };

  // ── 로딩 ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen relative">
        <PageBackground />
        <div className="max-w-2xl mx-auto px-4 pt-14 pb-24 space-y-4">
          <SkeletonCard height={160} />
          <SkeletonCard height={180} />
          <SkeletonCard height={200} />
          <SkeletonCard height={120} />
          <SkeletonCard height={100} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const meta       = PLAN_META[data.plan];
  const limits     = PLAN_USAGE_LIMITS[data.plan];
  const initials   = (data.name ?? data.email).slice(0, 2).toUpperCase();
  const joinedDate = new Date(data.createdAt).toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const nextReset  = new Date(data.usage.nextResetDate);
  const nextResetLabel = nextReset.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + ' 초기화';

  return (
    <div className="min-h-screen relative">
      <PageBackground />

      {/* 상단 그라데이션 글로우 */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] pointer-events-none opacity-[0.07]"
        style={{ background: 'radial-gradient(ellipse, #4f46e5 0%, transparent 70%)' }}
      />

      <div className="relative max-w-2xl mx-auto px-4 pt-12 pb-24 space-y-4">

        {/* ── 페이지 헤더 ─────────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-1">
            <svg className="w-5 h-5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h1 className="text-[26px] font-bold text-white leading-tight">마이페이지</h1>
          </div>
          <p className="text-[13px] text-slate-500 mt-1 pl-[30px]">계정 정보 및 사용 현황을 확인하세요</p>
        </div>

        {/* ── 1. 프로필 ───────────────────────────────────────────────────── */}
        <GradientCard
          gradient={meta.cardGradient}
          innerBg={meta.cardInnerBg}
        >
          <div className="flex items-center gap-5">
            {/* 아바타 */}
            <div className="relative shrink-0">
              {data.avatarUrl ? (
                <img
                  src={data.avatarUrl}
                  alt="프로필"
                  className="w-[72px] h-[72px] rounded-full object-cover"
                  style={{ boxShadow: `0 0 0 3px ${meta.avatarRing}, 0 0 0 5px ${meta.cardInnerBg}` }}
                />
              ) : (
                <div
                  className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-white text-2xl font-bold"
                  style={{
                    background: meta.textGradient ?? 'linear-gradient(135deg, #334155 0%, #475569 100%)',
                    boxShadow: `0 0 0 3px ${meta.avatarRing}, 0 0 0 5px ${meta.cardInnerBg}`,
                  }}
                >
                  {initials}
                </div>
              )}
            </div>

            {/* 정보 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[18px] font-bold text-white leading-snug truncate">
                  {data.name ?? data.email.split('@')[0]}
                </p>
                {/* 플랜 배지 */}
                {data.plan === 'pro' ? (
                  <span
                    className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full text-slate-900"
                    style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}
                  >
                    🔥 {meta.label}
                  </span>
                ) : (
                  <span
                    className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full"
                    style={{ color: meta.color, background: meta.badgeBg, border: `1px solid ${meta.badgeBorder}` }}
                  >
                    {meta.label}
                  </span>
                )}
              </div>
              <p className="text-[12.5px] text-slate-400 mt-0.5 truncate">{data.email}</p>
              <p className="text-[11px] text-slate-600 mt-2">가입일 · {joinedDate}</p>
            </div>
          </div>
        </GradientCard>

        {/* ── 2. 구독 현황 ─────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-800/70 p-6 md:p-7" style={{ backgroundColor: '#0d1117' }}>
          <SectionLabel>구독 현황</SectionLabel>

          <div className="flex items-end justify-between mb-6">
            <div>
              <p className="text-[11px] text-slate-500 mb-1.5">현재 플랜</p>
              {meta.textGradient ? (
                <p
                  className="text-[32px] font-bold leading-none tracking-[0.08em]"
                  style={{
                    background: meta.textGradient,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  {meta.label}
                </p>
              ) : (
                <p className="text-[32px] font-bold leading-none tracking-[0.08em] text-slate-400">
                  {meta.label}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-500 mb-1.5">월 결제금액</p>
              {data.plan === 'free' ? (
                <p className="text-[28px] font-bold text-slate-300 leading-none">무료</p>
              ) : (
                <div className="flex items-end gap-0.5">
                  <span className="text-slate-500 text-[15px] mb-0.5">₩</span>
                  <span className="text-[28px] font-bold text-white leading-none font-mono">
                    {PLAN_AMOUNTS[data.plan as 'basic' | 'pro'].monthly.toLocaleString()}
                  </span>
                  <span className="text-slate-500 text-[13px] mb-0.5">/월</span>
                </div>
              )}
            </div>
          </div>

          {/* 구독 상태 */}
          {data.plan !== 'free' && (() => {
            const statusMeta = SUBSCRIPTION_STATUS_META[data.subscription.status] ?? SUBSCRIPTION_STATUS_META.inactive;
            // 이미 승인되어 active 상태인 구독에는 계좌이체 안내를 보여주지 않는다 —
            // 잔여 pending 레코드가 있더라도(예: 관리자 승인 처리 지연 중 재조회) 혼란 방지
            const deposit = data.subscription.status !== 'active' ? data.subscription.pendingBankTransfer : null;
            return (
              <div className="mb-5">
                <div
                  className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: 'rgba(30,37,55,0.6)', border: '1px solid rgba(51,65,85,0.4)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" />
                      <line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" />
                      <line x1="3" y1="10" x2="21" y2="10" strokeLinecap="round" />
                    </svg>
                    <p className="text-[12.5px] text-slate-400">구독 상태</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                      style={{ color: statusMeta.color, background: statusMeta.bg }}
                    >
                      {statusMeta.label}
                    </span>
                    <p className="text-[12.5px] font-medium text-slate-300">
                      {data.subscription.nextBilledAt
                        ? new Date(data.subscription.nextBilledAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' })
                        : '—'}
                    </p>
                  </div>
                </div>

                {deposit && (
                  <div
                    className="mt-2 px-4 py-3 rounded-xl"
                    style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}
                  >
                    <p className="text-[11px] text-amber-300 mb-1.5">아래 계좌로 입금하시면 확인 후 구독이 활성화됩니다</p>
                    <div className="flex items-center justify-between">
                      <p className="text-[13px] font-semibold text-white">
                        {BANK_TRANSFER_ACCOUNT.bankName} {BANK_TRANSFER_ACCOUNT.accountNumber}
                      </p>
                      <p className="text-[13px] font-bold text-white">{deposit.amount.toLocaleString()}원</p>
                    </div>
                    {deposit.depositorRealName ? (
                      <p className="text-[10.5px] text-amber-400/80 mt-1">
                        예금주명 <span className="font-bold text-amber-300">{deposit.depositorRealName}</span>과 일치하면 자동 확인됩니다
                      </p>
                    ) : (
                      <p className="text-[10.5px] text-amber-400/80 mt-1">
                        예금주명이 등록되어 있지 않아 관리자가 직접 확인합니다 — 아래에서 등록하시면 다음부터 자동 처리돼요
                      </p>
                    )}
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      입금 확인 후 최대 30분 이내 자동 승인 · 확인이 어려운 경우 관리자가 직접 처리(영업일 기준 1일 이내)
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* CTA 버튼 */}
          <Link
            href="/pricing"
            className="block w-full py-3 rounded-xl text-[13.5px] font-bold text-center text-white transition-all hover:opacity-90 cursor-pointer"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          >
            {data.plan === 'free' ? '플랜 업그레이드 →' : '플랜 변경 →'}
          </Link>

          {/* 구독 취소 (유료 플랜만, 눈에 덜 띄게) */}
          {data.plan !== 'free' && (
            <div className="text-center mt-3">
              {data.subscription.status === 'pending_cancellation' ? (
                <p className="text-[11px] text-slate-600">
                  해지 예약됨 · {data.subscription.nextBilledAt ? new Date(data.subscription.nextBilledAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }) : ''}까지 이용 가능
                </p>
              ) : (
                <button
                  onClick={handleOpenCancelModal}
                  className="text-[11px] text-slate-600 hover:text-slate-400 transition-colors cursor-pointer underline underline-offset-2"
                >
                  구독 취소
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── 3. 이번 달 사용량 ────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-800/70 p-6 md:p-7" style={{ backgroundColor: '#0d1117' }}>
          <SectionLabel>이번 달 사용량</SectionLabel>

          <div className="space-y-3.5">
            {/* 종목진단 */}
            <div
              className="p-5 rounded-xl"
              style={{ background: 'rgba(20,24,38,0.7)', border: '1px solid rgba(51,65,85,0.35)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0"
                    style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)' }}
                  >
                    🔍
                  </div>
                  <p className="text-[14px] font-semibold text-slate-200">기업 분석</p>
                </div>
                <div className="text-right">
                  <p className="text-[24px] font-bold text-white leading-none font-mono">
                    {data.usage.diagnosisToday}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">/ {limits.diagnosis}회</p>
                </div>
              </div>
              <ProgressBar
                value={data.usage.diagnosisToday}
                max={limits.diagnosis}
                gradient="linear-gradient(90deg, #6366f1, #a855f7)"
                glowColor="rgba(99,102,241,0.5)"
              />
              <p className="text-[10px] text-slate-600 mt-2.5">매일 자정(KST) 초기화</p>
            </div>

            {/* 포트폴리오 진단 */}
            <div
              className="p-5 rounded-xl"
              style={{ background: 'rgba(20,24,38,0.7)', border: '1px solid rgba(51,65,85,0.35)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0"
                    style={{ background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.25)' }}
                  >
                    📊
                  </div>
                  <p className="text-[14px] font-semibold text-slate-200">포트폴리오 분석</p>
                </div>
                <div className="text-right">
                  <p className="text-[24px] font-bold text-white leading-none font-mono">
                    {data.usage.portfolioMonth}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">/ {limits.portfolio}회</p>
                </div>
              </div>
              {limits.portfolio > 0 ? (
                <>
                  <ProgressBar
                    value={data.usage.portfolioMonth}
                    max={limits.portfolio}
                    gradient="linear-gradient(90deg, #f59e0b, #f97316)"
                    glowColor="rgba(245,158,11,0.4)"
                  />
                  <p className="text-[10px] text-slate-600 mt-2.5">결제일 기준 매월 초기화 · {nextResetLabel}</p>
                </>
              ) : (
                <>
                  <div className="h-2.5 rounded-full" style={{ backgroundColor: 'rgba(30,37,55,0.8)' }} />
                  <p className="text-[10px] text-slate-600 mt-2.5">
                    BASIC 이상 플랜에서 이용 가능 ·{' '}
                    <Link href="/pricing" className="text-indigo-400 hover:text-indigo-300 underline transition-colors">
                      플랜 보기
                    </Link>
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── 4. 결제 내역 ─────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-800/70 p-6 md:p-7" style={{ backgroundColor: '#0d1117' }}>
          <SectionLabel>결제 내역</SectionLabel>

          {data.payments.length === 0 ? (
            <div
              className="flex flex-col items-center gap-3 py-10 rounded-xl"
              style={{ border: '1px dashed rgba(51,65,85,0.6)' }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(30,37,55,0.8)' }}
              >
                <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-[13px] font-medium text-slate-500">결제 내역이 없습니다</p>
                <p className="text-[11px] text-slate-700 mt-1">구독 시 결제 내역이 여기에 표시됩니다</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {data.payments.map(p => {
                const statusMeta = STATUS_META[p.status] ?? { label: p.status, color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' };
                const date = new Date(p.created_at).toLocaleDateString('ko-KR', {
                  year: 'numeric', month: '2-digit', day: '2-digit',
                });
                return (
                  <div key={p.id} className="flex items-center justify-between py-4">
                    <div>
                      <p className="text-[13.5px] font-semibold text-slate-200">
                        {p.plan?.toUpperCase() ?? '—'} 플랜
                      </p>
                      <p className="text-[11px] text-slate-600 mt-0.5">{date}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-[14px] font-bold text-white font-mono">
                        {(p.amount ?? 0).toLocaleString()}원
                      </p>
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ color: statusMeta.color, background: statusMeta.bg }}
                      >
                        {statusMeta.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 5. 알림 설정 (Pro 전용) ──────────────────────────────────────── */}
        {data.plan === 'pro' && (
          <div className="rounded-2xl border border-slate-800/70 p-6 md:p-7" style={{ backgroundColor: '#0d1117' }}>
            <SectionLabel>알림 설정</SectionLabel>

            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13.5px] font-semibold text-slate-200">장 시작 전 뉴스 브리핑</p>
                  <p className="text-[11.5px] text-slate-500 mt-0.5">
                    새로운 뉴스가 있는 관심기업을 AI가 분석해 아침에 발송
                  </p>
                </div>
                <button
                  onClick={handleToggleMorning}
                  disabled={togglingMorning}
                  className="relative shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer disabled:opacity-50"
                  style={{
                    background: morningBriefingEnabled
                      ? 'linear-gradient(135deg, #4f46e5, #7c3aed)'
                      : 'rgba(30,37,55,0.8)',
                    border: morningBriefingEnabled ? 'none' : '1px solid rgba(51,65,85,0.5)',
                  }}
                >
                  <span
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
                    style={{ left: morningBriefingEnabled ? '26px' : '2px' }}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13.5px] font-semibold text-slate-200">장 마감 후 분석 리포트</p>
                  <p className="text-[11.5px] text-slate-500 mt-0.5">
                    관심기업 등락 현황과 AI 분석을 저녁에 발송
                  </p>
                </div>
                <button
                  onClick={handleToggleEmail}
                  disabled={togglingEmail}
                  className="relative shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer disabled:opacity-50"
                  style={{
                    background: emailAlertEnabled
                      ? 'linear-gradient(135deg, #4f46e5, #7c3aed)'
                      : 'rgba(30,37,55,0.8)',
                    border: emailAlertEnabled ? 'none' : '1px solid rgba(51,65,85,0.5)',
                  }}
                >
                  <span
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
                    style={{ left: emailAlertEnabled ? '26px' : '2px' }}
                  />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 5.5. 결제 정보 ────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-800/70 p-6 md:p-7" style={{ backgroundColor: '#0d1117' }}>
          <SectionLabel>결제 정보</SectionLabel>

          <p className="text-[13.5px] font-semibold text-slate-200 mb-1">예금주명 (계좌이체 결제용)</p>
          <p className="text-[11.5px] text-slate-500 mb-3 leading-relaxed">
            계좌이체로 결제하실 때 입금 계좌의 예금주명과 대조해 자동으로 확인합니다.
            오타가 있거나 입금 계좌를 바꾸신 경우 여기서 수정해주세요.
          </p>
          <div className="flex gap-2">
            <input
              value={depositorRealName}
              onChange={(e) => setDepositorRealName(e.target.value)}
              placeholder="예: 홍길동"
              className="flex-1 px-3 py-2.5 rounded-lg text-[13px] text-white placeholder-slate-600 outline-none"
              style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
            />
            <button
              onClick={handleSaveDepositorName}
              disabled={savingDepositorName}
              className="shrink-0 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-white cursor-pointer transition-colors disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
            >
              {savingDepositorName ? <Spinner /> : '저장'}
            </button>
          </div>
          {depositorNameError && <p className="mt-2 text-[11px] text-red-400">{depositorNameError}</p>}
          {depositorNameSaved && <p className="mt-2 text-[11px] text-emerald-400">저장되었습니다.</p>}
        </div>

        {/* ── 6. 계정 관리 ─────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-800/70 p-6 md:p-7" style={{ backgroundColor: '#0d1117' }}>
          <SectionLabel>계정 관리</SectionLabel>

          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center justify-center gap-2.5 w-full px-4 py-3 rounded-xl text-[13.5px] font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            style={{ background: 'rgba(30,37,55,0.6)', border: '1px solid rgba(51,65,85,0.5)' }}
          >
            {signingOut ? <Spinner /> : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {signingOut ? '로그아웃 중…' : '로그아웃'}
          </button>

          <div className="text-center mt-4">
            <button
              onClick={() => setShowWithdrawModal(true)}
              className="text-[11.5px] text-slate-700 hover:text-red-400 transition-colors cursor-pointer"
            >
              회원탈퇴
            </button>
          </div>
        </div>
      </div>

      {/* ── 구독 취소 확인 모달 ──────────────────────────────────────────── */}
      {showCancelModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => !cancelSubmitting && setShowCancelModal(false)}
          />
          <div
            className="relative w-full max-w-sm rounded-2xl p-7 shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: '#111827', border: '1px solid rgba(51,65,85,0.6)' }}
          >
            <h3 className="text-[17px] font-bold text-white mb-1 text-center">구독을 취소하시겠어요?</h3>
            <p className="text-[11.5px] text-slate-500 leading-relaxed text-center mb-5">
              결제일로부터 7일 이내 미사용 시 전액환불, 사용한 경우 일할계산하여 환불됩니다.
              7일이 지났다면 환불 없이 다음 결제일부터 이용이 중단됩니다.
            </p>

            {cancelPreviewLoading ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <Spinner />
                <p className="text-[12.5px] text-slate-500">예상 환불액을 계산하는 중…</p>
              </div>
            ) : cancelPreviewError ? (
              <div className="mb-5">
                <p className="text-[12.5px] text-red-400 text-center">{cancelPreviewError}</p>
              </div>
            ) : cancelPreview && (
              <div className="mb-5">
                <div
                  className="rounded-xl p-4 mb-4"
                  style={{ background: 'rgba(30,37,55,0.6)', border: '1px solid rgba(51,65,85,0.4)' }}
                >
                  <div className="flex items-center justify-between text-[12px] py-1">
                    <span className="text-slate-500">사용 여부</span>
                    <span className="text-slate-300 font-medium">{cancelPreview.usageDetected ? '사용함' : '미사용'}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px] py-1">
                    <span className="text-slate-500">결제일로부터 경과</span>
                    <span className="text-slate-300 font-medium">{cancelPreview.elapsedDays}일</span>
                  </div>
                  <div className="flex items-center justify-between text-[13px] py-1.5 mt-1 border-t border-slate-700/50">
                    <span className="text-slate-400 font-semibold">
                      {cancelPreview.refundEligible ? '예상 환불액' : '환불 대상 여부'}
                    </span>
                    <span className={`font-bold ${cancelPreview.refundEligible ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {cancelPreview.refundEligible ? `${cancelPreview.refundAmount.toLocaleString()}원` : '환불 대상 아님'}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-600 mb-4 leading-relaxed">
                  환불액은 경과일수와 실제 이용 실적 중 더 큰 비율로 계산됩니다.{' '}
                  <Link href="/pricing#faq-refund-calc" target="_blank" className="text-indigo-400 hover:underline">자세히 보기</Link>
                </p>

                {cancelPreview.refundEligible ? (
                  cancelPreview.refundAmount > 0 && (
                    <div className="flex flex-col gap-2 mb-1">
                      <p className="text-[11.5px] text-slate-500 mb-0.5">환불받을 계좌 정보를 입력해주세요</p>
                      <input
                        value={refundBank}
                        onChange={(e) => setRefundBank(e.target.value)}
                        placeholder="은행명 (예: KB국민은행)"
                        className="px-3 py-2.5 rounded-lg text-[13px] text-white placeholder-slate-600 outline-none"
                        style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
                      />
                      <input
                        value={refundAccountNumber}
                        onChange={(e) => setRefundAccountNumber(e.target.value)}
                        placeholder="계좌번호"
                        className="px-3 py-2.5 rounded-lg text-[13px] text-white placeholder-slate-600 outline-none"
                        style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
                      />
                      <input
                        value={refundAccountHolder}
                        onChange={(e) => setRefundAccountHolder(e.target.value)}
                        placeholder="예금주명"
                        className="px-3 py-2.5 rounded-lg text-[13px] text-white placeholder-slate-600 outline-none"
                        style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
                      />
                    </div>
                  )
                ) : (
                  <p className="text-[11.5px] text-slate-500 text-center">
                    {cancelPreview.nextBilledAt
                      ? `${new Date(cancelPreview.nextBilledAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' })}까지는 계속 이용하실 수 있습니다.`
                      : '다음 결제일부터 이용이 중단됩니다.'}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2.5">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelSubmitting}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                style={{ background: 'rgba(30,37,55,0.8)', border: '1px solid rgba(51,65,85,0.5)' }}
              >
                돌아가기
              </button>
              {cancelPreview && !cancelPreviewError && (
                <button
                  onClick={handleSubmitCancel}
                  disabled={cancelSubmitting}
                  className="flex-1 py-3 rounded-xl text-[13px] font-semibold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 cursor-pointer disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}
                >
                  {cancelSubmitting && <Spinner />}
                  {cancelSubmitting ? '처리 중…' : cancelPreview.refundEligible ? '취소 신청하기' : '해지 예약하기'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 회원탈퇴 확인 모달 ────────────────────────────────────────────── */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => !withdrawing && setShowWithdrawModal(false)}
          />
          <div
            className="relative w-full max-w-sm rounded-2xl p-7 shadow-2xl"
            style={{ backgroundColor: '#111827', border: '1px solid rgba(51,65,85,0.6)' }}
          >
            {/* 아이콘 */}
            <div className="flex justify-center mb-5">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
              >
                <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                  <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            <div className="text-center mb-6">
              <h3 className="text-[17px] font-bold text-white mb-2">정말 탈퇴하시겠어요?</h3>
              <p className="text-[12.5px] text-slate-400 leading-relaxed">
                탈퇴 시 분석 내역, 관심기업 등<br />
                모든 데이터가 영구 삭제됩니다.
              </p>
              {data.plan !== 'free' && (
                <p className="mt-3 text-[11.5px] text-amber-300 leading-relaxed rounded-lg px-3 py-2.5" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                  현재 이용 중인 유료 구독은 탈퇴와 함께 해지되며,{' '}
                  <Link href="/refund" target="_blank" className="underline underline-offset-2 hover:text-amber-200">환불 정책</Link>
                  에 따라 환불이 진행될 수 있습니다.
                </p>
              )}
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => setShowWithdrawModal(false)}
                disabled={withdrawing}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                style={{ background: 'rgba(30,37,55,0.8)', border: '1px solid rgba(51,65,85,0.5)' }}
              >
                취소
              </button>
              <button
                onClick={handleWithdraw}
                disabled={withdrawing}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 cursor-pointer disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}
              >
                {withdrawing && <Spinner />}
                {withdrawing ? '처리 중…' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
