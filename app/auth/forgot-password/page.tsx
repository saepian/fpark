'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthBackground from '@/components/auth/AuthBackground';

type PageState = 'form' | 'sent' | 'oauth';

const PROVIDER_LABEL: Record<string, { name: string; color: string }> = {
  google: { name: 'Google',  color: '#4285F4' },
  naver:  { name: '네이버', color: '#03C75A' },
};

export default function ForgotPasswordPage() {
  const [email, setEmail]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [page, setPage]           = useState<PageState>('form');
  const [oauthProvider, setOauthProvider] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Server error');
      }

      if (data.status === 'oauth') {
        setOauthProvider(data.provider ?? '');
        setPage('oauth');
      } else {
        setPage('sent');
      }
    } catch (err) {
      console.error('[forgot-password] error:', err);
      setError('오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  /* ── 이메일 발송 완료 ── */
  if (page === 'sent') {
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
            <Link href="/auth/login" className="inline-block text-[13px] text-indigo-400 hover:text-indigo-300 transition-colors">
              ← 로그인으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ── OAuth 계정 안내 ── */
  if (page === 'oauth') {
    const provider = PROVIDER_LABEL[oauthProvider] ?? { name: '소셜', color: '#6366f1' };
    return (
      <div className="relative min-h-screen flex items-center justify-center px-4">
        <AuthBackground />
        <div className="w-full max-w-md">
          <div className="bg-[#1e2130] rounded-2xl p-8 text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{ backgroundColor: `${provider.color}20`, border: `1px solid ${provider.color}50` }}
            >
              {oauthProvider === 'google' ? (
                <svg width="26" height="26" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill={provider.color}>
                  <path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/>
                </svg>
              )}
            </div>
            <h2 className="text-[20px] font-bold text-white mb-3">
              {provider.name} 계정으로 가입됨
            </h2>
            <p className="text-[13px] text-slate-400 mb-1">
              <span className="text-slate-300 font-medium">{email}</span>은
            </p>
            <p className="text-[13px] text-slate-400 mb-6">
              {provider.name} 로그인으로 가입된 계정입니다.
              <br />비밀번호 없이 {provider.name} 버튼으로 로그인해주세요.
            </p>
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-all"
              style={{ backgroundColor: provider.color }}
            >
              {provider.name}로 로그인하기
            </Link>
            <button
              onClick={() => { setPage('form'); setOauthProvider(''); setError(''); }}
              className="mt-3 text-[12px] text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              다른 이메일로 시도하기
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── 입력 폼 ── */
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4">
      <AuthBackground />
      <div className="w-full max-w-md">
        <div className="bg-[#1e2130] rounded-2xl p-8">

          <div className="text-center mb-7">
            <p className="text-[10px] font-bold tracking-[0.3em] text-indigo-400 uppercase mb-2">
              Finance Park
            </p>
            <h1 className="text-[24px] font-bold text-white mb-1.5">비밀번호 찾기</h1>
            <p className="text-[13px] text-slate-400">
              가입한 이메일로 재설정 링크를 보내드립니다
            </p>
          </div>

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
