'use client';

// 소셜 로그인(네이버/구글) 신규 유저 전용 — 최초 로그인 시 약관/개인정보처리방침
// 동의를 받는 중간 페이지. 이미 동의한 유저(기존 가입자 포함)는 여기 들어와도
// 바로 next로 넘어간다.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { sanitizeRedirect } from '@/lib/auth-redirect';
import AuthBackground from '@/components/auth/AuthBackground';

function AgreeTermsForm() {
  const searchParams = useSearchParams();
  const next = sanitizeRedirect(searchParams.get('next'));

  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const agreeAll = agreeTerms && agreePrivacy;

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/auth/login';
        return;
      }
      const res = await fetch('/api/auth/agree-terms');
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.agreed) {
        // 이미 동의한 유저(기존 가입자 포함)는 이 화면을 거칠 필요 없음
        window.location.href = next;
        return;
      }
      setChecking(false);
    })();
  }, [next]);

  const toggleAll = (checked: boolean) => {
    setAgreeTerms(checked);
    setAgreePrivacy(checked);
  };

  const handleSubmit = async () => {
    if (!agreeTerms || !agreePrivacy) {
      setError('필수 약관에 모두 동의해주세요.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/agree-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreeTerms, agreePrivacy }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '처리 중 오류가 발생했습니다.');
      window.location.href = next;
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.');
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="relative min-h-screen flex items-center justify-center px-4">
        <AuthBackground />
        <Spinner className="text-indigo-400 w-6 h-6" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4">
      <AuthBackground />
      <div className="w-full max-w-md">
        <div className="bg-[#1e2130] rounded-2xl p-8">
          <div className="text-center mb-7">
            <p className="text-[10px] font-bold tracking-[0.3em] text-indigo-400 uppercase mb-2">
              Finance Park
            </p>
            <h1 className="text-[22px] font-bold text-white mb-1.5">약관 동의</h1>
            <p className="text-[13px] text-slate-400">서비스 이용을 위해 아래 약관에 동의해주세요</p>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2.5 p-3.5 rounded-lg bg-[#13161f] border border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={agreeAll}
                onChange={(e) => toggleAll(e.target.checked)}
                className="w-4 h-4 accent-indigo-500 cursor-pointer"
              />
              <span className="text-[14px] font-semibold text-white">전체 동의</span>
            </label>

            <div className="flex flex-col gap-2 pl-1">
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                    className="w-4 h-4 accent-indigo-500 cursor-pointer"
                  />
                  <span className="text-[13px] text-slate-300">
                    <span className="text-indigo-400 font-medium">[필수]</span> 이용약관 동의
                  </span>
                </span>
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-[12px] text-slate-500 hover:text-slate-300 underline underline-offset-2 shrink-0">
                  전문보기
                </a>
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={agreePrivacy}
                    onChange={(e) => setAgreePrivacy(e.target.checked)}
                    className="w-4 h-4 accent-indigo-500 cursor-pointer"
                  />
                  <span className="text-[13px] text-slate-300">
                    <span className="text-indigo-400 font-medium">[필수]</span> 개인정보처리방침 동의
                  </span>
                </span>
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[12px] text-slate-500 hover:text-slate-300 underline underline-offset-2 shrink-0">
                  전문보기
                </a>
              </label>
            </div>

            {error && <p className="text-red-400 text-[13px]">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={!agreeTerms || !agreePrivacy || submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
                text-white font-semibold text-[14px] py-3 rounded-lg transition-colors cursor-pointer
                flex items-center justify-center gap-2 mt-2"
            >
              {submitting && <Spinner />}
              동의하고 시작하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Spinner({ className = 'text-white' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export default function AgreeTermsPage() {
  return (
    <Suspense fallback={null}>
      <AgreeTermsForm />
    </Suspense>
  );
}
