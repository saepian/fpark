'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import AuthBackground from '@/components/auth/AuthBackground';

interface FieldErrors {
  email?: string;
  password?: string;
  confirm?: string;
  name?: string;
  phone?: string;
}

export default function SignupPage() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const agreeAll = agreeTerms && agreePrivacy;

  const toggleAllAgree = (checked: boolean) => {
    setAgreeTerms(checked);
    setAgreePrivacy(checked);
  };

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  };

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = '올바른 이메일 형식이 아닙니다.';
    if (password.length < 8) e.password = '비밀번호는 8자 이상이어야 합니다.';
    if (password !== confirm) e.confirm = '비밀번호가 일치하지 않습니다.';
    if (name.trim().length < 2) e.name = '이름은 2자 이상이어야 합니다.';
    if (phone && !/^010-\d{4}-\d{4}$/.test(phone)) e.phone = '010으로 시작하는 11자리 번호를 입력해주세요.';
    return e;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    const fieldErrors = validate();
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      setSubmitError('필수 약관에 모두 동의해주세요.');
      return;
    }
    setErrors({});
    setLoading(true);

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: name.trim(), phone: phone || null }),
    });
    const result = await res.json().catch(() => ({ error: 'signup_failed' }));

    setLoading(false);
    if (!res.ok) {
      setSubmitError(
        result.error === 'duplicate_email'
          ? '이미 가입된 이메일입니다.'
          : '회원가입 중 오류가 발생했습니다.',
      );
    } else {
      setDone(true);
    }
  };

  const signInSocial = async (provider: 'google') => {
    setSocialLoading(provider);
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
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

  if (done) {
    return (
      <div className="relative min-h-screen flex items-center justify-center px-4">
        <AuthBackground />
        <div className="w-full max-w-md">
          <div className="bg-[#1e2130] rounded-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-indigo-600/20 flex items-center justify-center mx-auto mb-5">
              <svg className="w-7 h-7 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="text-[20px] font-bold text-white mb-2">가입을 환영합니다!</h2>
            <p className="text-[13px] text-slate-400 mb-1">
              <span className="text-slate-300 font-medium">{email}</span>으로
            </p>
            <p className="text-[13px] text-slate-400 mb-1">인증 링크를 발송했습니다. 이메일을 확인해주세요.</p>
            <p className="text-[11.5px] text-slate-500 mb-6">메일 도착까지 최대 1분 정도 걸릴 수 있어요. 안 보이면 스팸함도 확인해주세요.</p>

            <button
              onClick={handleResend}
              disabled={resending}
              className="w-full mb-4 py-2.5 rounded-lg text-[12.5px] font-medium text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: 'rgba(30,37,55,0.8)', border: '1px solid rgba(51,65,85,0.5)' }}
            >
              {resending ? '재발송 중…' : resent ? '재발송 완료 ✓' : '인증 메일 재발송'}
            </button>

            <Link href="/auth/login" className="inline-block text-[13px] text-indigo-400 hover:text-indigo-300 transition-colors">
              로그인으로 이동 →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-10">
      <AuthBackground />
      <div className="w-full max-w-md">
        <div className="bg-[#1e2130] rounded-2xl p-8">

          {/* 헤더 */}
          <div className="text-center mb-7">
            <p className="text-[10px] font-bold tracking-[0.3em] text-indigo-400 uppercase mb-2">
              Finance Park
            </p>
            <h1 className="text-[24px] font-bold text-white mb-1.5">회원가입</h1>
            <p className="text-[13px] text-slate-400">계정을 만들고 시작하세요</p>
          </div>

          {/* 폼 */}
          <form onSubmit={handleSignup} noValidate className="flex flex-col gap-4">

            {/* 이메일 */}
            <div>
              <Label text="이메일" required />
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: undefined })); }}
                placeholder="example@email.com"
                className={inputCls(!!errors.email)}
              />
              {errors.email && <FieldError msg={errors.email} />}
            </div>

            {/* 비밀번호 */}
            <div>
              <Label text="비밀번호" required />
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: undefined })); }}
                  placeholder="8자 이상"
                  className={inputCls(!!errors.password) + ' pr-11'}
                />
                <EyeToggle show={showPw} onToggle={() => setShowPw((v) => !v)} />
              </div>
              {errors.password && <FieldError msg={errors.password} />}
            </div>

            {/* 비밀번호 확인 */}
            <div>
              <Label text="비밀번호 확인" required />
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setErrors((p) => ({ ...p, confirm: undefined })); }}
                  placeholder="비밀번호를 다시 입력"
                  className={inputCls(!!errors.confirm) + ' pr-11'}
                />
                <EyeToggle show={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />
              </div>
              {errors.confirm && <FieldError msg={errors.confirm} />}
            </div>

            {/* 이름 */}
            <div>
              <Label text="이름" required />
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })); }}
                placeholder="실명을 입력해주세요"
                className={inputCls(!!errors.name)}
              />
              {errors.name && <FieldError msg={errors.name} />}
            </div>

            {/* 전화번호 */}
            <div>
              <Label text="전화번호" optional />
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(formatPhone(e.target.value));
                  setErrors((p) => ({ ...p, phone: undefined }));
                }}
                placeholder="010-0000-0000"
                className={inputCls(!!errors.phone)}
              />
              {errors.phone && <FieldError msg={errors.phone} />}
            </div>

            {/* 약관 동의 */}
            <div className="flex flex-col gap-2.5 py-1">
              <label className="flex items-center gap-2.5 p-3 rounded-lg bg-[#13161f] border border-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreeAll}
                  onChange={(e) => toggleAllAgree(e.target.checked)}
                  className="w-4 h-4 accent-indigo-500 cursor-pointer"
                />
                <span className="text-[13.5px] font-semibold text-white">전체 동의</span>
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
                    <span className="text-[12.5px] text-slate-300">
                      <span className="text-indigo-400 font-medium">[필수]</span> 이용약관 동의
                    </span>
                  </span>
                  <Link href="/terms" target="_blank" className="text-[11.5px] text-slate-500 hover:text-slate-300 underline underline-offset-2 shrink-0">
                    전문보기
                  </Link>
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={agreePrivacy}
                      onChange={(e) => setAgreePrivacy(e.target.checked)}
                      className="w-4 h-4 accent-indigo-500 cursor-pointer"
                    />
                    <span className="text-[12.5px] text-slate-300">
                      <span className="text-indigo-400 font-medium">[필수]</span> 개인정보처리방침 동의
                    </span>
                  </span>
                  <Link href="/privacy" target="_blank" className="text-[11.5px] text-slate-500 hover:text-slate-300 underline underline-offset-2 shrink-0">
                    전문보기
                  </Link>
                </label>
              </div>
            </div>

            {/* 전체 에러 */}
            {submitError && <p className="text-red-400 text-sm">{submitError}</p>}

            {/* 가입 버튼 */}
            <button
              type="submit"
              disabled={loading || !agreeTerms || !agreePrivacy}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed
                text-white font-semibold text-[14px] py-3 rounded-lg transition-colors cursor-pointer
                flex items-center justify-center gap-2 mt-1"
            >
              {loading && <Spinner />}
              회원가입
            </button>
          </form>

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
              onClick={() => { window.location.href = '/api/auth/naver'; }}
              disabled={socialLoading !== null}
              className="w-12 h-12 rounded-full disabled:opacity-60
                flex items-center justify-center transition-opacity cursor-pointer shadow-sm"
              style={{ backgroundColor: '#03C75A' }}
              aria-label="네이버로 시작하기"
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
              aria-label="Google로 시작하기"
            >
              {socialLoading === 'google' ? (
                <Spinner className="text-gray-400" />
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

          {/* 로그인 링크 */}
          <p className="text-center text-[13px] text-slate-500 mt-5">
            이미 계정이 있으신가요?{' '}
            <Link href="/auth/login" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
              로그인
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── 헬퍼 컴포넌트 ─── */

function Label({ text, required, optional }: { text: string; required?: boolean; optional?: boolean }) {
  return (
    <label className="block text-[12px] font-medium text-slate-400 mb-1.5">
      {text}
      {required && <span className="text-red-400 ml-0.5">*</span>}
      {optional && <span className="text-slate-500 ml-1">(선택)</span>}
    </label>
  );
}

function FieldError({ msg }: { msg: string }) {
  return <p className="text-red-400 text-[12px] mt-1">{msg}</p>;
}

function inputCls(hasError: boolean) {
  return [
    'w-full bg-[#13161f] border rounded-lg px-4 py-3',
    'text-[14px] text-white placeholder-slate-500',
    'focus:outline-none transition-colors',
    hasError ? 'border-red-500 focus:border-red-400' : 'border-slate-700 focus:border-indigo-500',
  ].join(' ');
}

function EyeToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
      tabIndex={-1}
    >
      {show ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
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
