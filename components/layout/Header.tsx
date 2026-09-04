'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X, Zap } from 'lucide-react';
import SearchBar from '../search/SearchBar';
import MarketTicker from './MarketTicker';
import NotificationBell from './NotificationBell';
import PersonalButton from './PersonalButton';
import Logo from './Logo';
import { useSession } from '@/lib/useSession';

interface HeaderProps {
  onSelectStock?: (ticker: string) => void;
  onGoHome?: () => void;
}

const NAV_ITEMS: { label: string; href: string; comingSoon?: boolean; special?: boolean; pro?: boolean; pricing?: boolean }[] = [
  { label: '홈',            href: '/' },
  { label: '기업 분석',       href: '/diagnosis',           special: true },
  { label: '포트폴리오 분석', href: '/portfolio-diagnosis', special: true, pro: true },
  { label: '대시보드',       href: '/dashboard',           special: true },
  { label: '국내증시',       href: '/market/domestic' },
  { label: '해외증시',       href: '/market/global' },
  { label: '뉴스',           href: '/news' },
  { label: '요금제',         href: '/pricing',             pricing: true },
];

export default function Header({ onSelectStock, onGoHome }: HeaderProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogoClick = () => {
    if (onGoHome) onGoHome();
    else router.push('/');
  };

  const handleSelectStock = (ticker: string) => {
    if (onSelectStock) onSelectStock(ticker);
    else router.push(`/stock/${ticker}`);
  };

  // 종목 상세 페이지(/stock/..., /overseas/...)는 각각 국내증시/해외증시 목록과
  // 다른 최상위 경로라 startsWith(href) 매칭이 실패한다 — 예외로 별도 매핑.
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/market/domestic' && pathname.startsWith('/stock/')) return true;
    if (href === '/market/global' && pathname.startsWith('/overseas/')) return true;
    return pathname.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-50 w-full bg-[#0f1117] border-b border-[#2d313e]">
      {/* 메인 행 — 3열 그리드(1fr / 중앙열 / 1fr). 2026-08-31: absolute left-1/2 중앙고정이
          우측 네비(홈~요금제 8개)와 겹쳐(1280~1600px 폭 실측) flex-1로 바꿨었는데, flex-1은
          "로고~우측 네비 사이 남는 공간"의 중앙이라 로고 폭과 우측 네비 폭이 다르면 화면
          전체 기준으로는 미묘하게 좌우 어느 한쪽으로 치우친다. 그리드 양쪽 열을 똑같이 1fr로
          두면 로고/우측 네비 폭이 서로 달라도 중앙열은 항상 "화면 전체" 기준 정중앙에 온다
          (각 열이 자기 콘텐츠만큼만 차지해 absolute처럼 겹칠 일도 없음).
          2026-09-04: 중앙열은 CSS 키워드 그대로의 auto(콘텐츠 고유폭)가 아니라
          minmax(0,500px) — 검색창이 실제로 500px까지 늘어나야(구 flex-1 동작 재현) 하는데,
          리터럴 auto 트랙은 퍼센트 폭(w-full) 자손의 기여폭을 auto 취급해 입력창 기본
          고유폭까지만 좁게 잡히는 문제가 있어 대신 상한을 트랙에 직접 못박았다. */}
      <div className="relative grid grid-cols-[1fr_minmax(0,500px)_1fr] items-center h-14 px-4 md:px-6">

        {/* 좌측: 로고 */}
        <div className="flex-shrink-0 justify-self-start z-10">
          <Link href="/" onClick={onGoHome} className="flex items-center cursor-pointer">
            <Logo />
          </Link>
        </div>

        {/* 중앙: 검색창 — 부모 flex(justify-center)가 중앙열 안에서 이 항목을 가운데 놓는다.
            2026-09-04 실측: 예전 래퍼는 독자적으로 max-w-[500px]를 얹었는데, SearchBar.tsx
            루트는 그와 무관하게 이미 자체 max-w-sm(384px)로 더 좁게 잡혀 있었다 — 두 상한이
            어긋난 채 래퍼가 w-full로 500px까지 넓어지면, 안의 384px SearchBar는 남는 공간에서
            기본 블록 정렬(좌측 정렬)로 왼쪽에 붙어버려 중앙열은 정중앙이어도 실제 입력창은
            왼쪽으로 치우쳤다(1920px 실측: 중앙열 오차 1.4px vs 입력창 오차 43.4px). 래퍼의
            상한을 SearchBar 자체 상한과 동일한 max-w-sm으로 맞추면(중복 상한 제거, 단일
            소스) 항상 같은 폭으로 꽉 차 정확히 같은 자리에서 중앙 정렬된다. */}
        <div className="hidden md:flex min-w-0 justify-center px-4">
          <div className="w-full max-w-sm">
            <SearchBar onSelectStock={handleSelectStock} />
          </div>
        </div>

        {/* 우측: 네비 + 구분선 + 알림 + 개인화 + 햄버거(모바일) */}
        <div className="flex-shrink-0 justify-self-end flex items-center gap-3 z-10">
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

          <NotificationBell />
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
                  className="text-[11px] font-bold px-2.5 py-1 rounded-full text-white"
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

      {/* 마켓 티커 — 로그인 세션이 있을 때만 (비로그인 방문자는 랜딩페이지) */}
      {user && <MarketTicker />}
    </header>
  );
}
