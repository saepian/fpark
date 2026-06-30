'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import PageBackground from '@/components/layout/PageBackground';

type PlanType = 'free' | 'basic' | 'pro';

interface MyPageData {
  email: string;
  name: string | null;
  avatarUrl: string | null;
  plan: PlanType;
  createdAt: string;
  usage: { diagnosisToday: number; portfolioMonth: number; nextResetDate: string };
  payments: { id: string; created_at: string; plan: string; amount: number; status: string }[];
}

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
    price: 0,
    priceText: '무료',
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
    price: 4900,
    priceText: '4,900원',
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
    price: 19900,
    priceText: '19,900원',
  },
};

const PLAN_LIMITS = {
  free:  { diagnosis: 1,  portfolio: 0  },
  basic: { diagnosis: 6,  portfolio: 1  },
  pro:   { diagnosis: 11, portfolio: 20 },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  completed: { label: '완료', color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  failed:    { label: '실패', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  cancelled: { label: '취소', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
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

  useEffect(() => {
    fetch('/api/mypage')
      .then(async r => {
        if (r.status === 401) { router.push('/auth/login'); return; }
        setData(await r.json());
      })
      .catch(() => router.push('/auth/login'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const handleWithdraw = async () => {
    setWithdrawing(true);
    const res = await fetch('/api/mypage/delete', { method: 'DELETE' });
    if (res.ok) {
      window.location.href = '/';
    } else {
      setWithdrawing(false);
      alert('탈퇴 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
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
  const limits     = PLAN_LIMITS[data.plan];
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
                    {meta.price.toLocaleString()}
                  </span>
                  <span className="text-slate-500 text-[13px] mb-0.5">/월</span>
                </div>
              )}
            </div>
          </div>

          {/* 다음 결제일 */}
          {data.plan !== 'free' && (
            <div
              className="flex items-center justify-between px-4 py-3 rounded-xl mb-5"
              style={{ background: 'rgba(30,37,55,0.6)', border: '1px solid rgba(51,65,85,0.4)' }}
            >
              <div className="flex items-center gap-2.5">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" />
                  <line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" />
                  <line x1="3" y1="10" x2="21" y2="10" strokeLinecap="round" />
                </svg>
                <p className="text-[12.5px] text-slate-400">다음 결제일</p>
              </div>
              <p className="text-[12.5px] font-medium text-slate-300">—</p>
            </div>
          )}

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
              <button className="text-[11px] text-slate-600 hover:text-slate-400 transition-colors cursor-pointer underline underline-offset-2">
                구독 취소
              </button>
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
                  <p className="text-[14px] font-semibold text-slate-200">종목진단</p>
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
                  <p className="text-[14px] font-semibold text-slate-200">포트폴리오 진단</p>
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
                const statusMeta = STATUS_META[p.status] ?? STATUS_META.completed;
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

        {/* ── 5. 계정 관리 ─────────────────────────────────────────────────── */}
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
                탈퇴 시 진단 내역, 관심종목 등<br />
                모든 데이터가 영구 삭제됩니다.
              </p>
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
