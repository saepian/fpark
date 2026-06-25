'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '../../lib/supabase-browser';

const VISIBLE = 5;
const CARD_W  = 192; // w-48 = 12rem = 192px
const GAP     = 12;  // gap-3 = 0.75rem = 12px
const STEP    = CARD_W + GAP;
const AUTO_MS = 3000;

interface WatchItem {
  id: string;
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
}

export default function WatchlistSection() {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [items, setItems]       = useState<WatchItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(false);
  const [paused, setPaused]     = useState(false);
  const [index, setIndex]       = useState(0);
  // noAnim: transition 끄고 조용히 리셋할 때 true
  const [noAnim, setNoAnim]     = useState(false);
  // goPrev에서 noAnim 리셋 후 이어서 실행할 목표 인덱스
  const pendingRef              = useRef<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setLoggedIn(false); setLoading(false); return; }
      setLoggedIn(true);
      fetch('/api/watchlist')
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setItems(data); })
        .catch(() => {})
        .finally(() => setLoading(false));
    });
  }, []);

  const n            = items.length;
  const needCarousel = n > VISIBLE;
  // 5개 이하면 단순 렌더, 6개 이상이면 2배 복제로 무한 루프
  const track        = needCarousel ? [...items, ...items] : items;

  // noAnim이 true가 된 직후 → 브라우저가 해당 위치를 paint한 뒤
  // pendingRef가 있으면 이어서 애니메이션 실행, 없으면 transition만 재활성화
  useEffect(() => {
    if (!noAnim) return;
    const raf = requestAnimationFrame(() => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      setNoAnim(false);
      if (pending !== null) setIndex(pending);
    });
    return () => cancelAnimationFrame(raf);
  }, [noAnim]);

  // 3초마다 자동 슬라이드 (hover 시 정지)
  useEffect(() => {
    if (!needCarousel || paused) return;
    const id = setInterval(() => setIndex(i => i + 1), AUTO_MS);
    return () => clearInterval(id);
  }, [needCarousel, paused]);

  // 앞으로 이동 후 index가 n에 도달하면 조용히 0으로 리셋
  const onTransitionEnd = () => {
    if (index >= n) {
      setNoAnim(true);
      setIndex(i => i - n);
    }
  };

  const goNext = () => {
    if (!needCarousel) return;
    setIndex(i => i + 1);
  };

  const goPrev = () => {
    if (!needCarousel) return;
    if (index <= 0) {
      // 0 위치에서 뒤로: n으로 조용히 점프(0과 동일한 화면) → n-1로 애니메이션
      pendingRef.current = n - 1;
      setNoAnim(true);
      setIndex(n);
    } else {
      setIndex(i => i - 1);
    }
  };

  const remove = async (ticker: string) => {
    setItems(prev => prev.filter(i => i.ticker !== ticker));
    setIndex(0);
    await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    });
  };

  if (loggedIn === null) return null;

  return (
    <div className="mt-6 bg-[#1e2130] rounded-2xl p-5">

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-base">★</span>
          <span className="text-sm font-bold text-white tracking-wider">MY WATCHLIST</span>
          {loggedIn && !loading && (
            <span className={`text-xs font-mono ${n >= 15 ? 'text-red-400' : 'text-slate-600'}`}>
              {n}/15
            </span>
          )}
        </div>
        {loggedIn && n > 0 && (
          <button
            onClick={() => setEditing(e => !e)}
            className={[
              'w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors cursor-pointer',
              editing
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white',
            ].join(' ')}
            aria-label="편집"
          >
            ✏️
          </button>
        )}
      </div>

      {/* 비로그인 */}
      {!loggedIn && (
        <div className="text-center py-8">
          <p className="text-2xl mb-2">⭐</p>
          <p className="text-sm font-semibold text-white mb-1">MY WATCHLIST</p>
          <p className="text-xs text-slate-400 mb-4">로그인하고 관심종목을 등록해보세요</p>
          <button
            onClick={() => router.push('/auth/login')}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500
              text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
          >
            로그인하기
          </button>
        </div>
      )}

      {/* 로딩 */}
      {loggedIn && loading && (
        <div className="flex gap-3">
          {[...Array(VISIBLE)].map((_, i) => (
            <div key={i} className="flex-shrink-0 w-48 h-[92px] rounded-xl bg-slate-800/60 animate-pulse" />
          ))}
        </div>
      )}

      {/* 목록 없음 */}
      {loggedIn && !loading && n === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">
          아직 관심종목이 없습니다.
          <br />
          <span className="text-xs">종목 상세 페이지에서 ⭐를 눌러 추가해보세요</span>
        </div>
      )}

      {/* 카드 + 화살표 */}
      {loggedIn && !loading && n > 0 && (
        <div
          className="flex items-center gap-3"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* 왼쪽 화살표 */}
          <button
            onClick={goPrev}
            disabled={!needCarousel}
            className={[
              'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all',
              needCarousel
                ? 'bg-slate-700 hover:bg-slate-600 text-white cursor-pointer'
                : 'bg-slate-800/30 text-slate-800 cursor-default',
            ].join(' ')}
            aria-label="이전"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* 트랙 */}
          <div className="flex-1 overflow-hidden">
            <div
              className="flex gap-3"
              style={{
                transform: `translateX(-${index * STEP}px)`,
                transition: noAnim ? 'none' : 'transform 500ms ease-in-out',
              }}
              onTransitionEnd={onTransitionEnd}
            >
              {track.map((stock, i) => {
                const isUp       = stock.changeRate >= 0;
                const priceColor = isUp ? 'text-red-400' : 'text-blue-400';
                return (
                  <div
                    key={`${stock.ticker}-${i}`}
                    onClick={() => router.push(`/stock/${stock.ticker}`)}
                    className="flex-shrink-0 w-48 bg-[#13161f] rounded-xl p-4
                      border border-slate-700/50 cursor-pointer
                      hover:border-indigo-500/50 transition-colors"
                  >
                    {/* 종목명(좌) + 코드·X(우) */}
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-white truncate flex-1 leading-tight">
                        {stock.name}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <p className="text-xs text-slate-500 font-mono">{stock.ticker}</p>
                        {editing && (
                          <button
                            onClick={e => { e.stopPropagation(); remove(stock.ticker); }}
                            className="text-slate-500 hover:text-red-400 transition-colors text-xs cursor-pointer"
                            aria-label="삭제"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 현재가 + 등락률 */}
                    <div className="flex items-baseline gap-2">
                      <p className="text-xl font-bold font-mono text-white">
                        {stock.price > 0 ? stock.price.toLocaleString() : '—'}
                      </p>
                      {stock.price > 0 && (
                        <p className={`text-sm font-mono font-semibold ${priceColor}`}>
                          {isUp ? '+' : ''}{stock.changeRate.toFixed(1)}%
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 오른쪽 화살표 */}
          <button
            onClick={goNext}
            disabled={!needCarousel}
            className={[
              'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all',
              needCarousel
                ? 'bg-slate-700 hover:bg-slate-600 text-white cursor-pointer'
                : 'bg-slate-800/30 text-slate-800 cursor-default',
            ].join(' ')}
            aria-label="다음"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
