'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { sanitizeRedirect } from '@/lib/auth-redirect';
import AuthBackground from '@/components/auth/AuthBackground';

function LoginForm() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const redirectTo = sanitizeRedirect(searchParams.get('redirect'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | null>(null);
  const [error, setError] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setUnconfirmed(false);
    setResent(false);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.code === 'email_not_confirmed') {
        setUnconfirmed(true);
      } else {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      }
      setLoading(false);
    } else {
      // router.push + router.refresh는 클라이언트 Router Cache에 남아있던
      // 로그인 전 "/" 응답(미들웨어가 비로그인으로 rewrite한 버전)을 재사용해
      // 로그인 직후에도 화면이 안 바뀐 것처럼 보일 수 있다 — 세션 쿠키가 확실히
      // 반영된 상태로 서버에 새로 요청하도록 하드 네비게이션으로 이동한다.
      window.location.href = redirectTo;
    }
  };

  const handleResend = async () => {
    setResending(true);
    setResent(false);
    await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setResending(false);
    setResent(true);
  };

  const signInSocial = async (provider: 'google') => {
    setSocialLoading(provider);
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `https://fpark.com/auth/callback?next=${encodeURIComponent(redirectTo)}`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
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
            <p className="text-[13px] text-slate-400">기업 데이터를 더 스마트하게 활용하세요</p>
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

            {/* 이메일 미확인 안내 */}
            {unconfirmed && (
              <div className="rounded-lg px-3.5 py-3 flex flex-col gap-2" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}>
                <p className="text-[12.5px] text-amber-300 leading-relaxed">
                  이메일 인증이 완료되지 않았습니다.<br />
                  가입 시 받으신 메일의 링크를 확인해주세요.
                </p>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="self-start text-[12px] font-medium text-amber-300 hover:text-amber-200 underline underline-offset-2 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {resending ? '재발송 중…' : resent ? '재발송 완료 ✓' : '인증 메일 재발송'}
                </button>
              </div>
            )}

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
            {/* 네이버 */}
            <button
              onClick={() => { window.location.href = `/api/auth/naver?redirect=${encodeURIComponent(redirectTo)}`; }}
              disabled={socialLoading !== null}
              className="w-12 h-12 rounded-full disabled:opacity-60
                flex items-center justify-center transition-opacity cursor-pointer shadow-sm"
              style={{ backgroundColor: '#03C75A' }}
              aria-label="네이버로 로그인"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/>
              </svg>
            </button>
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  );
}
