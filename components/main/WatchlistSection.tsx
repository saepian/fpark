'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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

// 3개씩 나눠 개별 종목 가격 재조회
async function refetchPrices(tickers: string[]): Promise<Map<string, { price: number; changeRate: number }>> {
  const result = new Map<string, { price: number; changeRate: number }>();
  const CHUNK = 3;
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    await Promise.allSettled(
      chunk.map(async (ticker) => {
        try {
          const res = await fetch(`/api/stock/${ticker}/price`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.price > 0) {
            result.set(ticker, { price: data.price, changeRate: data.changeRate ?? 0 });
          }
        } catch { /* 재시도 실패 무시 */ }
      }),
    );
    if (i + CHUNK < tickers.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return result;
}

export default function WatchlistSection() {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [items, setItems]       = useState<WatchItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(false);
  const [paused, setPaused]       = useState(false);
  const [index, setIndex]         = useState(0);
  const [transition, setTransition] = useState(true);
  // price === 0 인 종목 — 3초 후 재시도 중
  const [retrying, setRetrying]   = useState<Set<string>>(new Set());
  const retryTimerRef             = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRetry = useCallback((failed: string[]) => {
    if (failed.length === 0) return;
    setRetrying(new Set(failed));
    retryTimerRef.current = setTimeout(async () => {
      const updates = await refetchPrices(failed);
      setItems(prev =>
        prev.map(item => {
          const u = updates.get(item.ticker);
          return u ? { ...item, ...u } : item;
        }),
      );
      setRetrying(new Set());
    }, 3000);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setLoggedIn(false); setLoading(false); return; }
      setLoggedIn(true);
      fetch('/api/watchlist')
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) {
            setItems(data);
            const failed = (data as WatchItem[])
              .filter(i => i.price === 0)
              .map(i => i.ticker);
            scheduleRetry(failed);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    });
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [scheduleRetry]);

  const n            = items.length;
  const needCarousel = n > VISIBLE;
  const track        = needCarousel ? [...items, ...items] : items;

  // ── 캐러셀 ──────────────────────────────────────────────────────────────

  // 자동 슬라이드
  useEffect(() => {
    if (!needCarousel || paused) return;
    const id = setInterval(() => {
      setTransition(true);
      setIndex(i => i + 1);
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [needCarousel, paused]);

  const goNext = () => {
    if (!needCarousel) return;
    setTransition(true);
    setIndex(i => i + 1);
  };

  const goPrev = () => {
    if (!needCarousel) return;
    if (index <= 0) {
      // 1) 애니메이션 없이 position n으로 순간 이동 (position 0과 시각적으로 동일)
      setTransition(false);
      setIndex(n);
      // 2) 브라우저가 렌더링한 뒤 n-1로 애니메이션
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransition(true);
          setIndex(n - 1);
        });
      });
    } else {
      setTransition(true);
      setIndex(i => i - 1);
    }
  };

  // 오른쪽 끝 도달 시 처음으로 순간 이동 후 transition 복원
  const handleTransitionEnd = () => {
    if (index >= n) {
      setTransition(false);
      setIndex(i => i - n);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTransition(true));
      });
    }
  };

  const remove = async (ticker: string) => {
    setItems(prev => prev.filter(i => i.ticker !== ticker));
    setRetrying(prev => { const s = new Set(prev); s.delete(ticker); return s; });
    setTransition(false);
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

      {/* 초기 로딩 스켈레톤 */}
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
                transition: transition ? 'transform 500ms ease-in-out' : 'none',
              }}
              onTransitionEnd={handleTransitionEnd}
            >
              {track.map((stock, i) => {
                const isUp         = stock.changeRate >= 0;
                const priceColor   = isUp ? 'text-red-400' : 'text-blue-400';
                const isPriceReady = stock.price > 0;
                const isRetrying   = !isPriceReady && retrying.has(stock.ticker);

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
                    {isPriceReady ? (
                      <div className="flex items-baseline gap-2">
                        <p className="text-xl font-bold font-mono text-white">
                          {stock.price.toLocaleString()}
                        </p>
                        <p className={`text-sm font-mono font-semibold ${priceColor}`}>
                          {isUp ? '+' : ''}{stock.changeRate.toFixed(1)}%
                        </p>
                      </div>
                    ) : isRetrying ? (
                      /* 재시도 중: 스켈레톤 */
                      <div className="flex flex-col gap-1.5 mt-0.5">
                        <div className="h-5 w-24 rounded bg-slate-700/70 animate-pulse" />
                        <div className="h-3.5 w-14 rounded bg-slate-700/40 animate-pulse" />
                      </div>
                    ) : (
                      /* 재시도 후에도 실패 */
                      <p className="text-xl font-bold font-mono text-slate-600">—</p>
                    )}
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
