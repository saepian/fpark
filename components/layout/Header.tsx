'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import SearchBar from '../search/SearchBar';
import MarketTicker from './MarketTicker';
import AlertButton from './AlertButton';
import PersonalButton from './PersonalButton';
import Logo from './Logo';

interface HeaderProps {
  onSelectStock?: (ticker: string) => void;
  onGoHome?: () => void;
}

const NAV_ITEMS = [
  { label: '홈',     href: '/' },
  { label: '국내증시', href: '/market/domestic' },
  { label: '해외증시', href: '/market/global' },
  { label: '뉴스',   href: '/news' },
] as const;

export default function Header({ onSelectStock, onGoHome }: HeaderProps) {
  const pathname = usePathname();
  const router   = useRouter();

  const handleLogoClick = () => {
    if (onGoHome) onGoHome();
    else router.push('/');
  };

  const handleSelectStock = (ticker: string) => {
    if (onSelectStock) onSelectStock(ticker);
    else router.push(`/stock/${ticker}`);
  };

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-50 w-full bg-[#0f1117] border-b border-[#2d313e]">
      {/* 단일 행: relative 컨테이너로 검색창 absolute 중앙 고정 */}
      <div className="relative flex items-center h-14 px-6">

        {/* 좌측: 로고 */}
        <div className="flex-shrink-0 z-10">
          <Link href="/" onClick={onGoHome} className="flex items-center cursor-pointer">
            <Logo />
          </Link>
        </div>

        {/* 중앙: 검색창 — absolute로 헤더 정중앙 고정 */}
        <div className="absolute left-1/2 -translate-x-1/2 w-full max-w-[500px] px-4">
          <SearchBar onSelectStock={handleSelectStock} />
        </div>

        {/* 우측: 네비 + 구분선 + 알림 + 개인화 */}
        <div className="flex-shrink-0 ml-auto flex items-center gap-3 z-10">
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV_ITEMS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                onClick={href === '/' && onGoHome ? (e) => { e.preventDefault(); onGoHome(); } : undefined}
                className={[
                  'text-[12px] font-medium px-3 py-1.5 rounded-lg transition-all whitespace-nowrap',
                  isActive(href)
                    ? 'text-white bg-slate-800'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50',
                ].join(' ')}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="w-px h-4 bg-slate-700" />

          <AlertButton />
          <PersonalButton />
        </div>
      </div>

      {/* 마켓 티커 */}
      <MarketTicker />
    </header>
  );
}
