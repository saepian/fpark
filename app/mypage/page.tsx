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
  usage: { diagnosisToday: number; portfolioMonth: number };
  payments: { id: string; created_at: string; plan: string; amount: number; status: string }[];
}

const PLAN_META = {
  free:  { label: 'FREE',  color: '#64748b', bg: 'rgba(100,116,139,0.15)', border: 'rgba(100,116,139,0.3)',  price: 0 },
  basic: { label: 'BASIC', color: '#818cf8', bg: 'rgba(129,140,248,0.15)', border: 'rgba(129,140,248,0.3)', price: 4900 },
  pro:   { label: 'PRO',   color: '#fbbf24', bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.3)',  price: 19900 },
};

const PLAN_LIMITS = {
  free:  { diagnosis: 1,  portfolio: 0  },
  basic: { diagnosis: 6,  portfolio: 1  },
  pro:   { diagnosis: 11, portfolio: 20 },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  completed: { label: '완료',  color: '#34d399', bg: 'rgba(52,211,153,0.15)' },
  failed:    { label: '실패',  color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
  cancelled: { label: '취소',  color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
};

function ProgressBar({ value, max, gradient }: { value: number; max: number; gradient: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: gradient }}
      />
    </div>
  );
}

function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-slate-700/50 bg-[#1e2130] p-6 animate-pulse space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3.5 rounded bg-slate-700/50 ${i === 0 ? 'w-1/3' : i % 2 === 0 ? 'w-4/5' : 'w-2/3'}`} />
      ))}
    </div>
  );
}

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
        const json = await r.json();
        setData(json);
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

  if (loading) {
    return (
      <div className="min-h-screen relative">
        <PageBackground />
        <div className="max-w-2xl mx-auto px-4 pt-10 pb-20 space-y-4">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const planMeta   = PLAN_META[data.plan];
  const planLimits = PLAN_LIMITS[data.plan];
  const initials   = (data.name ?? data.email).slice(0, 2).toUpperCase();
  const joinedDate = new Date(data.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-screen relative">
      <PageBackground />

      <div className="max-w-2xl mx-auto px-4 pt-10 pb-24 space-y-4">

        {/* 페이지 타이틀 */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">마이페이지</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">계정 정보 및 사용 현황을 확인하세요</p>
        </div>

        {/* ── 1. 프로필 섹션 ─────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-700/50 bg-[#1e2130] p-6">
          <div className="flex items-center gap-4">
            {/* 아바타 */}
            {data.avatarUrl ? (
              <img
                src={data.avatarUrl}
                alt="프로필"
                className="w-14 h-14 rounded-full object-cover ring-2 ring-slate-700"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-white text-lg font-bold ring-2 ring-slate-700 shrink-0">
                {initials}
              </div>
            )}

            {/* 정보 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[15px] font-bold text-white truncate">
                  {data.name ?? data.email.split('@')[0]}
                </p>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ color: planMeta.color, background: planMeta.bg, border: `1px solid ${planMeta.border}` }}
                >
                  {planMeta.label}
                </span>
              </div>
              <p className="text-[12px] text-slate-400 mt-0.5 truncate">{data.email}</p>
              <p className="text-[11px] text-slate-600 mt-1">가입일 {joinedDate}</p>
            </div>
          </div>
        </section>

        {/* ── 2. 구독 현황 ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-700/50 bg-[#1e2130] p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-4">구독 현황</h2>

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[13px] text-slate-400">현재 플랜</p>
              <p className="text-[18px] font-bold mt-0.5" style={{ color: planMeta.color }}>{planMeta.label}</p>
            </div>
            <div className="text-right">
              {data.plan === 'free' ? (
                <p className="text-[18px] font-bold text-white">무료</p>
              ) : (
                <>
                  <p className="text-[18px] font-bold text-white">{planMeta.price.toLocaleString()}원</p>
                  <p className="text-[11px] text-slate-500">/ 월</p>
                </>
              )}
            </div>
          </div>

          {data.plan !== 'free' && (
            <div className="mb-4 p-3 rounded-xl bg-slate-800/50 border border-slate-700/40">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-slate-400">다음 결제일</p>
                <p className="text-[12px] text-slate-300 font-medium">—</p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {data.plan !== 'free' && (
              <button className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors cursor-pointer">
                구독 취소
              </button>
            )}
            <Link
              href="/pricing"
              className="block w-full py-2.5 rounded-xl text-[13px] font-semibold text-center text-white transition-all cursor-pointer hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
            >
              {data.plan === 'free' ? '플랜 업그레이드' : '플랜 변경'}
            </Link>
          </div>
        </section>

        {/* ── 3. 사용량 섹션 ───────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-700/50 bg-[#1e2130] p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-4">이번 달 사용량</h2>

          <div className="space-y-5">
            {/* 종목진단 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">🔍</span>
                  <p className="text-[13px] font-medium text-slate-200">종목진단</p>
                </div>
                <p className="text-[13px] font-bold text-white font-mono">
                  {data.usage.diagnosisToday}
                  <span className="text-slate-500 font-normal">/{planLimits.diagnosis}회</span>
                </p>
              </div>
              <ProgressBar
                value={data.usage.diagnosisToday}
                max={planLimits.diagnosis}
                gradient="linear-gradient(90deg, #6366f1, #a855f7)"
              />
              <p className="text-[10px] text-slate-600 mt-1.5">매일 자정(KST) 초기화</p>
            </div>

            {/* 포트폴리오 진단 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">📊</span>
                  <p className="text-[13px] font-medium text-slate-200">포트폴리오 진단</p>
                </div>
                <p className="text-[13px] font-bold text-white font-mono">
                  {data.usage.portfolioMonth}
                  <span className="text-slate-500 font-normal">/{planLimits.portfolio}회</span>
                </p>
              </div>
              {planLimits.portfolio > 0 ? (
                <>
                  <ProgressBar
                    value={data.usage.portfolioMonth}
                    max={planLimits.portfolio}
                    gradient="linear-gradient(90deg, #f59e0b, #f97316)"
                  />
                  <p className="text-[10px] text-slate-600 mt-1.5">매월 1일 초기화</p>
                </>
              ) : (
                <div className="h-2 rounded-full bg-slate-800" />
              )}
              {planLimits.portfolio === 0 && (
                <p className="text-[10px] text-slate-600 mt-1.5">
                  BASIC 이상 플랜에서 이용 가능 ·{' '}
                  <Link href="/pricing" className="text-indigo-400 hover:text-indigo-300 underline">플랜 보기</Link>
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── 4. 결제 내역 ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-700/50 bg-[#1e2130] p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-4">결제 내역</h2>

          {data.payments.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-3xl mb-2">💳</p>
              <p className="text-[13px] text-slate-500">결제 내역이 없습니다</p>
            </div>
          ) : (
            <div className="space-y-0 divide-y divide-slate-700/40">
              {data.payments.map(p => {
                const statusMeta = STATUS_META[p.status] ?? STATUS_META.completed;
                const date = new Date(p.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
                return (
                  <div key={p.id} className="flex items-center justify-between py-3.5">
                    <div>
                      <p className="text-[13px] font-medium text-slate-200">{p.plan?.toUpperCase() ?? '—'} 플랜</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{date}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-[13px] font-bold text-white font-mono">{(p.amount ?? 0).toLocaleString()}원</p>
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
        </section>

        {/* ── 5. 계정 관리 ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-700/50 bg-[#1e2130] p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-4">계정 관리</h2>

          <div className="space-y-2.5">
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-[13px] font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors border border-slate-700/40 cursor-pointer disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {signingOut ? '로그아웃 중…' : '로그아웃'}
            </button>

            <button
              onClick={() => setShowWithdrawModal(true)}
              className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-[13px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors border border-red-500/20 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              회원탈퇴
            </button>
          </div>
        </section>
      </div>

      {/* ── 회원탈퇴 확인 모달 ────────────────────────────────────────── */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !withdrawing && setShowWithdrawModal(false)}
          />
          <div className="relative w-full max-w-sm bg-[#1e2130] border border-slate-700/60 rounded-2xl p-6 shadow-2xl">
            <div className="text-center mb-5">
              <p className="text-3xl mb-3">⚠️</p>
              <h3 className="text-[16px] font-bold text-white mb-2">정말 탈퇴하시겠어요?</h3>
              <p className="text-[12.5px] text-slate-400 leading-relaxed">
                탈퇴 시 모든 데이터(진단 내역, 관심종목 등)가<br />
                영구적으로 삭제되며 복구할 수 없습니다.
              </p>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowWithdrawModal(false)}
                disabled={withdrawing}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-slate-300 border border-slate-700 hover:bg-slate-800/50 transition-colors cursor-pointer disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleWithdraw}
                disabled={withdrawing}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-red-500/80 hover:bg-red-500 transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {withdrawing && (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                )}
                {withdrawing ? '처리 중…' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
