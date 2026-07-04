'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, Mail } from 'lucide-react';
import PageBackground from '@/components/layout/PageBackground';

const PLAN_NAMES: Record<string, string> = {
  basic: 'Finance Park Basic',
  pro:   'Finance Park Pro',
};

const CREDIT_LABELS: Record<string, string> = {
  stock:     '기업 분석 1회권',
  portfolio: '포트폴리오 분석 1회권',
};

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const type        = searchParams.get('type');       // 'subscription' | 'credit'
  const plan        = searchParams.get('plan');        // 'basic' | 'pro'
  const creditType  = searchParams.get('creditType');   // 'stock' | 'portfolio'
  const wasLoggedIn = searchParams.get('wasLoggedIn') === 'true';

  const itemLabel = type === 'credit'
    ? (creditType ? CREDIT_LABELS[creditType] ?? '1회권' : '1회권')
    : (plan ? PLAN_NAMES[plan] ?? '구독' : '구독');

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4">
      <PageBackground />

      <div
        className="relative w-full max-w-md rounded-2xl p-8 text-center shadow-2xl"
        style={{ background: '#0f1117', border: '1px solid rgba(16,185,129,0.3)' }}
      >
        <CheckCircle className="w-14 h-14 text-emerald-400 mx-auto mb-5" />
        <h1 className="text-[19px] font-bold text-white mb-2">결제가 완료되었습니다</h1>
        <p className="text-[13px] text-slate-400 mb-6 leading-relaxed">{itemLabel}</p>

        {wasLoggedIn ? (
          <>
            <p className="text-[13px] text-slate-300 mb-6 leading-relaxed">
              {type === 'credit' ? '충전이 완료되었습니다.' : '구독이 활성화되었습니다.'}<br />
              <span className="text-[12px] text-slate-500">잠시 후 자동으로 반영됩니다.</span>
            </p>
            <Link
              href="/mypage"
              className="inline-block w-full py-3 rounded-xl text-[14px] font-bold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
            >
              대시보드로 이동
            </Link>
          </>
        ) : (
          <>
            <div
              className="flex items-start gap-2 mb-6 p-3.5 rounded-xl text-left"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)' }}
            >
              <Mail className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
              <p className="text-[12.5px] text-indigo-200 leading-relaxed">
                결제 시 입력하신 이메일로 로그인 안내 메일을 보내드렸습니다.
                메일함(스팸함 포함)을 확인해주세요.
              </p>
            </div>
            <Link
              href="/auth/login"
              className="inline-block w-full py-3 rounded-xl text-[14px] font-bold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
            >
              로그인 페이지로 이동
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function PaymentSuccessClient() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <PaymentSuccessContent />
    </Suspense>
  );
}
