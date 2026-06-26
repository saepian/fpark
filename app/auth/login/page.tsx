'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import AuthBackground from '@/components/auth/AuthBackground';

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'kakao' | null>(null);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      setLoading(false);
    } else {
      router.push('/');
      router.refresh();
    }
  };

  const signInSocial = async (provider: 'google' | 'kakao') => {
    setSocialLoading(provider);
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: 'https://fpark.com/auth/callback' },
    });
  };

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
            <h1 className="text-[24px] font-bold text-white mb-1.5">로그인</h1>
            <p className="text-[13px] text-slate-400">투자 정보를 더 스마트하게 활용하세요</p>
          </div>

          {/* 폼 */}
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            {/* 이메일 */}
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

            {/* 비밀번호 */}
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호"
                required
                className="w-full bg-[#13161f] border border-slate-700 rounded-lg px-4 py-3 pr-11
                  text-[14px] text-white placeholder-slate-500
                  focus:border-indigo-500 focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                tabIndex={-1}
              >
                {showPw ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>

            {/* 에러 */}
            {error && <p className="text-red-400 text-sm">{error}</p>}

            {/* 로그인 버튼 */}
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
              로그인
            </button>
          </form>

          {/* 비밀번호 찾기 */}
          <div className="text-center mt-3">
            <Link href="/auth/forgot-password" className="text-[12px] text-slate-500 hover:text-slate-300 transition-colors">
              비밀번호를 잊으셨나요?
            </Link>
          </div>

          {/* 구분선 */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-[12px] text-slate-500">또는</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>

          {/* 소셜 로그인 */}
          <div className="flex justify-center gap-4">
            {/* 구글 */}
            <button
              onClick={() => signInSocial('google')}
              disabled={socialLoading !== null}
              className="w-12 h-12 rounded-full bg-white hover:bg-gray-100 disabled:opacity-60
                flex items-center justify-center transition-colors cursor-pointer shadow-sm"
              aria-label="Google로 로그인"
            >
              {socialLoading === 'google' ? (
                <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
              )}
            </button>

            {/* 카카오 */}
            <button
              onClick={() => signInSocial('kakao')}
              disabled={socialLoading !== null}
              className="w-12 h-12 rounded-full disabled:opacity-60
                flex items-center justify-center transition-opacity cursor-pointer shadow-sm"
              style={{ backgroundColor: '#FEE500' }}
              aria-label="카카오로 로그인"
            >
              {socialLoading === 'kakao' ? (
                <svg className="w-4 h-4 animate-spin text-[#3C1E1E]" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#3C1E1E">
                  <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.698 5.076 4.27 6.542L5.19 21l4.773-2.57A11.63 11.63 0 0 0 12 18.6c5.523 0 10-3.477 10-7.8S17.523 3 12 3z"/>
                </svg>
              )}
            </button>
          </div>

          {/* 회원가입 링크 */}
          <p className="text-center text-[13px] text-slate-500 mt-6">
            아직 계정이 없으신가요?{' '}
            <Link href="/auth/signup" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
              회원가입
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
