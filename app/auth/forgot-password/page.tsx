'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import AuthBackground from '@/components/auth/AuthBackground';

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback`,
    });

    setLoading(false);

    if (error) {
      setError('오류가 발생했습니다. 다시 시도해주세요.');
    } else {
      setDone(true);
    }
  };

  if (done) {
    return (
      <div className="relative min-h-screen flex items-center justify-center px-4">
        <AuthBackground />
        <div className="w-full max-w-md">
          <div className="bg-[#1e2130] rounded-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-indigo-600/20 flex items-center justify-center mx-auto mb-5">
              <svg className="w-7 h-7 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-[20px] font-bold text-white mb-2">이메일을 확인해주세요</h2>
            <p className="text-[13px] text-slate-400 mb-1">
              <span className="text-slate-300 font-medium">{email}</span>으로
            </p>
            <p className="text-[13px] text-slate-400 mb-6">비밀번호 재설정 링크를 발송했습니다.</p>
            <Link
              href="/auth/login"
              className="inline-block text-[13px] text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              ← 로그인으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4">
      <AuthBackground />
      <div className="w-full max-w-md">
        <div className="bg-[#1e2130] rounded-2xl p-8">

          {/* 헤더 */}
          <div className="text-center mb-7">
            <p className="text-[10px] font-bold tracking-[0.3em] text-indigo-400 uppercase mb-2">
              Finance Park
            </p>
            <h1 className="text-[24px] font-bold text-white mb-1.5">비밀번호 찾기</h1>
            <p className="text-[13px] text-slate-400">
              가입한 이메일로 재설정 링크를 보내드립니다
            </p>
          </div>

          {/* 폼 */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일"
              required
              className="w-full bg-[#13161f] border border-slate-700 rounded-lg px-4 py-3
                text-[14px] text-white placeholder-slate-500
                focus:border-indigo-500 focus:outline-none transition-colors"
            />

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed
                text-white font-semibold text-[14px] py-3 rounded-lg transition-colors cursor-pointer
                flex items-center justify-center gap-2 mt-1"
            >
              {loading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              )}
              재설정 링크 보내기
            </button>
          </form>

          {/* 로그인 링크 */}
          <p className="text-center text-[13px] text-slate-500 mt-5">
            <Link href="/auth/login" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              ← 로그인으로 돌아가기
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
