'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase-browser';
import type { User } from '@supabase/supabase-js';

// ── Watchlist 사이드 패널 내부 리스트 ─────────────────────────────────────────

interface WatchItem {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  market?: string;
  currency?: string;
}

const MARKET_FLAG: Record<string, string> = {
  us: '🇺🇸', jp: '🇯🇵', hk: '🇭🇰', cn: '🇨🇳',
};

function WatchlistList({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [list, setList]           = useState<WatchItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/watchlist')
      .then(r => r.json())
      .then(data => setList(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const remove = async (ticker: string) => {
    setList(prev => prev.filter(s => s.ticker !== ticker));
    await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    });
  };

  const getPath = (stock: WatchItem) =>
    stock.market && stock.market !== 'kr'
      ? `/overseas/${stock.market}/${stock.ticker}`
      : `/stock/${stock.ticker}`;

  if (loading) {
    return <div className="p-8 text-center text-slate-500 text-sm">불러오는 중…</div>;
  }

  if (list.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        <p className="text-3xl mb-3">⭐</p>
        <p>관심종목이 없습니다</p>
        <p className="text-xs mt-1 text-slate-600">종목 상세 페이지에서 ⭐를 눌러 추가하세요</p>
      </div>
    );
  }

  return (
    <div>
      <div className="px-5 py-2 text-xs text-slate-500">{list.length}/15개</div>
      {list.map((stock, idx) => {
        const isUp       = (stock.changeRate ?? 0) >= 0;
        const market     = stock.market ?? 'kr';
        const flag       = MARKET_FLAG[market];
        const isOverseas = market !== 'kr';
        const isDragging = dragIndex === idx;
        const isOver     = overIndex === idx && dragIndex !== idx;
        return (
          <div
            key={stock.ticker}
            draggable={true}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDragIndex(idx);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overIndex !== idx) setOverIndex(idx);
            }}
            onDragLeave={() => setOverIndex(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex === null || dragIndex === idx) {
                setDragIndex(null);
                setOverIndex(null);
                return;
              }
              const next = [...list];
              const [removed] = next.splice(dragIndex, 1);
              next.splice(idx, 0, removed);
              setList(next);
              setDragIndex(null);
              setOverIndex(null);
              const order = next.map(s => s.ticker);
              console.log('[WATCHLIST] 순서 변경:', order);
              fetch('/api/watchlist', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order }),
              }).then(r => r.json()).then(console.log).catch(console.error);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={[
              'flex items-center gap-2 px-3 py-3.5 border-b border-slate-800 select-none transition-all',
              isDragging ? 'opacity-40' : 'hover:bg-slate-800/50',
              isOver ? 'border-t-2 border-t-indigo-500' : '',
            ].join(' ')}
          >
            {/* 드래그 핸들 */}
            <span
              className="text-slate-600 cursor-grab active:cursor-grabbing mr-1 select-none shrink-0 text-base"
              draggable={false}
            >
              ⠿
            </span>

            {/* 종목 정보 */}
            <div
              className="flex-1 cursor-pointer min-w-0"
              onClick={() => { router.push(getPath(stock)); onClose(); }}
            >
              <p className="text-sm font-semibold text-white truncate leading-tight">{stock.name}</p>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                {flag && <span className="mr-1">{flag}</span>}
                {stock.ticker}
              </p>
            </div>

            {/* 가격 */}
            <div className="text-right shrink-0">
              <p className="text-sm font-bold font-mono text-white">
                {stock.price > 0 ? stock.price.toLocaleString() : '—'}
              </p>
              <p className={`text-xs font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
                {stock.price > 0
                  ? `${isUp ? '+' : ''}${(stock.changeRate ?? 0).toFixed(2)}%`
                  : '—'}
              </p>
            </div>

            {/* 삭제 */}
            <button
              onClick={() => remove(stock.ticker)}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-red-500/20
                hover:text-red-400 text-slate-500 flex items-center justify-center
                transition-colors text-xs shrink-0 cursor-pointer"
              aria-label="삭제"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── PersonalButton ─────────────────────────────────────────────────────────────

export default function PersonalButton() {
  const supabase = createClient();
  const router   = useRouter();
  const [user, setUser]               = useState<User | null>(null);
  const [open, setOpen]               = useState(false);
  const [isWatchlistOpen, setWatchlistOpen] = useState(false);
  const [mounted, setMounted]         = useState(false);
  const dropdownRef                   = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []); // eslint-disable-line

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 패널 열릴 때 body 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = isWatchlistOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isWatchlistOpen]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setOpen(false);
    router.refresh();
  };

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? '';

  if (!user) {
    return (
      <button
        onClick={() => router.push('/auth/login')}
        className="text-[12px] font-medium text-slate-300 hover:text-white
          px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500
          transition-colors cursor-pointer"
      >
        로그인
      </button>
    );
  }

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(v => !v)}
          className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500
            flex items-center justify-center text-white text-[12px] font-bold
            transition-colors cursor-pointer"
          aria-label="내 계정"
        >
          {initials}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 z-50 w-44
            bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden">

            {/* 이메일 */}
            <div className="px-4 py-3 border-b border-slate-700">
              <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
            </div>

            {/* 메뉴 */}
            <div className="py-1">
              <button
                onClick={() => { setOpen(false); setWatchlistOpen(true); }}
                className="flex items-center gap-2.5 w-full px-4 py-2.5
                  text-[13px] text-slate-300 hover:text-white hover:bg-slate-700/60
                  transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 0 0 .95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 0 0-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 0 0-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 0 0-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 0 0 .951-.69l1.519-4.674z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                관심종목
              </button>

              <button
                onClick={signOut}
                className="flex items-center gap-2.5 w-full px-4 py-2.5
                  text-[13px] text-slate-400 hover:text-red-400 hover:bg-slate-700/60
                  transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                로그아웃
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Watchlist 사이드 패널 (portal → body) */}
      {mounted && isWatchlistOpen && createPortal(
        <>
          {/* 오버레이 */}
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            onClick={() => setWatchlistOpen(false)}
          />

          {/* 패널 */}
          <div className="fixed right-0 top-0 h-full w-80 z-[61]
            bg-[#1e2130] border-l border-slate-700 shadow-2xl
            overflow-y-auto
            [&::-webkit-scrollbar]:w-1
            [&::-webkit-scrollbar-track]:bg-transparent
            [&::-webkit-scrollbar-thumb]:bg-slate-700
            [&::-webkit-scrollbar-thumb]:rounded-full">

            {/* 패널 헤더 */}
            <div className="flex items-center justify-between p-5
              border-b border-slate-700 sticky top-0 bg-[#1e2130] z-10">
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-base">★</span>
                <span className="font-bold text-white text-sm tracking-wider">MY WATCHLIST</span>
              </div>
              <button
                onClick={() => setWatchlistOpen(false)}
                className="w-7 h-7 flex items-center justify-center
                  text-slate-400 hover:text-white transition-colors
                  rounded-lg hover:bg-slate-700 cursor-pointer text-base"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            {/* 리스트 */}
            <WatchlistList onClose={() => setWatchlistOpen(false)} />
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
