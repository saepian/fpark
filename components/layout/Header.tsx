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

const NAV_ITEMS: { label: string; href: string; comingSoon?: boolean }[] = [
  { label: '홈',     href: '/' },
  { label: '국내증시', href: '/market/domestic', comingSoon: true },
  { label: '해외증시', href: '/market/global',    comingSoon: true },
  { label: '뉴스',   href: '/news' },
];

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
      {/* 메인 행 */}
      <div className="relative flex items-center h-14 px-4 md:px-6">

        {/* 좌측: 로고 */}
        <div className="flex-shrink-0 z-10">
          <Link href="/" onClick={onGoHome} className="flex items-center cursor-pointer">
            <Logo />
          </Link>
        </div>

        {/* 중앙: 검색창 — md+ 에서만 absolute 중앙 고정 */}
        <div className="hidden md:block absolute left-1/2 -translate-x-1/2 w-full max-w-[500px] px-4">
          <SearchBar onSelectStock={handleSelectStock} />
        </div>

        {/* 우측: 네비 + 구분선 + 알림 + 개인화 */}
        <div className="flex-shrink-0 ml-auto flex items-center gap-3 z-10">
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV_ITEMS.map(({ label, href, comingSoon }) =>
              comingSoon ? (
                <div key={href} className="relative group">
                  <span className="text-[12px] font-medium px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-default text-slate-600 select-none">
                    {label}
                  </span>
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-[11px] text-slate-300 font-medium">준비중입니다.</span>
                    </div>
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800 border-l border-t border-slate-700 rotate-45" />
                  </div>
                </div>
              ) : (
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
              )
            )}
          </nav>

          <div className="w-px h-4 bg-slate-700" />

          <AlertButton />
          <PersonalButton />
        </div>
      </div>

      {/* 모바일 전용 검색창 행 */}
      <div className="md:hidden px-4 pb-2">
        <SearchBar onSelectStock={handleSelectStock} />
      </div>

      {/* 마켓 티커 */}
      <MarketTicker />
    </header>
  );
}
