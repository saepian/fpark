'use client';

// 챗봇 위젯(components/ChatWidget.tsx) 바로 위에 상시 떠 있는 작은 /welcome 안내 링크.
// 비로그인 방문자, 그리고 큰 배너(components/main/WelcomeBanner.tsx)를 닫았거나
// 가입 7일이 지난 유저에게 노출된다 — lib/useWelcomeExposure.ts로 큰 배너와
// 판단 로직을 공유해 둘이 동시에 뜨지 않는다.
// 완전히 숨겨지지 않는 게 이번 설계의 핵심이라 별도 닫기 버튼은 의도적으로 두지 않았다.

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { useWelcomeExposure } from '@/lib/useWelcomeExposure';

export default function WelcomeLink() {
  const exposure = useWelcomeExposure();
  const pathname = usePathname();

  if (exposure !== 'small' || pathname === '/welcome') return null;

  return (
    <Link
      href="/welcome"
      className="fixed bottom-24 right-4 sm:right-6 z-[9998] flex items-center gap-1.5
        rounded-full pl-2.5 pr-3 py-2 text-[11.5px] font-semibold text-indigo-200
        bg-[#151a2e]/95 border border-indigo-500/30 shadow-lg backdrop-blur-sm
        hover:border-indigo-400/50 hover:text-white transition-colors"
    >
      <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
      fpark 소개 보기
    </Link>
  );
}
