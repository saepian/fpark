'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X, Zap } from 'lucide-react';
import SearchBar from '../search/SearchBar';
import MarketTicker from './MarketTicker';
import AlertButton from './AlertButton';
import PersonalButton from './PersonalButton';
import Logo from './Logo';

interface HeaderProps {
  onSelectStock?: (ticker: string) => void;
  onGoHome?: () => void;
}

const NAV_ITEMS: { label: string; href: string; comingSoon?: boolean; special?: boolean; pro?: boolean; pricing?: boolean }[] = [
  { label: '홈',            href: '/' },
  { label: '종목진단',       href: '/diagnosis',           special: true },
  { label: '포트폴리오 진단', href: '/portfolio-diagnosis', special: true, pro: true },
  { label: '국내증시',       href: '/market/domestic' },
  { label: '해외증시',       href: '/market/global' },
  { label: '뉴스',           href: '/news' },
  { label: '요금제',         href: '/pricing',             pricing: true },
];

export default function Header({ onSelectStock, onGoHome }: HeaderProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

        {/* 우측: 네비 + 구분선 + 알림 + 개인화 + 햄버거(모바일) */}
        <div className="flex-shrink-0 ml-auto flex items-center gap-3 z-10">
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV_ITEMS.map(({ label, href, comingSoon, special, pro, pricing }) =>
              pricing ? (
                <Link
                  key={href}
                  href={href}
                  className="nav-pricing-btn ml-1 flex items-center gap-1.5 text-[11px] font-bold px-4 py-1.5 rounded-full whitespace-nowrap text-white"
                >
                  <Zap className="w-3 h-3" />
                  {label}
                </Link>
              ) : comingSoon ? (
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
              ) : special ? (
                <Link
                  key={href}
                  href={href}
                  className={[
                    'relative text-[12px] font-medium px-3 py-1.5 rounded-lg transition-all whitespace-nowrap flex items-center gap-1',
                    isActive(href) ? 'bg-slate-800' : 'hover:bg-slate-800/50',
                  ].join(' ')}
                >
                  <span className={isActive(href) ? 'text-white' : 'nav-diagnosis-text'}>
                    {label}
                  </span>
                  {pro && (
                    <span className="nav-pro-badge">
                      PRO
                      <span className="nav-pro-tail" />
                    </span>
                  )}
                </Link>
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

          <div className="hidden md:block w-px h-4 bg-slate-700" />

          <AlertButton />
          <PersonalButton />

          {/* 햄버거 버튼 (모바일 전용) */}
          <button
            className="md:hidden w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
            onClick={() => setMobileMenuOpen(v => !v)}
            aria-label="메뉴"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* 모바일 전용 검색창 행 */}
      <div className="md:hidden px-4 pb-2">
        <SearchBar onSelectStock={handleSelectStock} />
      </div>

      {/* 모바일 메뉴 드롭다운 */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#0f1117] border-t border-slate-800 px-4 pb-3">
          {NAV_ITEMS.map(({ label, href, comingSoon, special, pro, pricing }) =>
            pricing ? (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between py-3.5 border-b border-slate-800/60 last:border-0"
              >
                <span
                  className="flex items-center gap-2 text-[15px] font-bold"
                  style={{ background: 'linear-gradient(135deg, #818cf8, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
                >
                  <Zap className="w-4 h-4 shrink-0" style={{ color: '#818cf8', WebkitTextFillColor: 'initial' }} />
                  {label}
                </span>
                <span
                  className="text-[10px] font-bold px-2.5 py-1 rounded-full text-white"
                  style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
                >
                  플랜 보기 →
                </span>
              </Link>
            ) : comingSoon ? (
              <div key={href} className="flex items-center justify-between py-3.5 border-b border-slate-800/60 last:border-0">
                <span className="text-[15px] text-slate-600">{label}</span>
                <span className="text-[11px] text-amber-500 font-medium">준비중</span>
              </div>
            ) : (
              <Link
                key={href}
                href={href}
                onClick={() => {
                  setMobileMenuOpen(false);
                  if (href === '/' && onGoHome) onGoHome();
                }}
                className={[
                  'flex items-center gap-2 py-3.5 border-b border-slate-800/60 last:border-0 text-[15px] font-medium transition-colors',
                  isActive(href) ? 'text-white' : (special ? '' : 'text-slate-400'),
                ].join(' ')}
              >
                {special && !isActive(href)
                  ? <span className="nav-diagnosis-text">{label}</span>
                  : label}
                {pro && (
                  <span className="nav-pro-badge">
                    PRO
                    <span className="nav-pro-tail" />
                  </span>
                )}
              </Link>
            )
          )}
        </div>
      )}

      {/* 마켓 티커 */}
      <MarketTicker />
    </header>
  );
}
