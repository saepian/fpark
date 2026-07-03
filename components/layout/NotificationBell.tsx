'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-browser';
import type { StockNotification } from '@/lib/types';

export default function NotificationBell() {
  const router       = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [user, setUser]                 = useState<User | null>(null);
  const [authReady, setAuthReady]       = useState(false);
  const [open, setOpen]                 = useState(false);

  // Pro 관심기업 알림
  const [isPro, setIsPro]               = useState(false);
  const [notifications, setNotifications] = useState<StockNotification[]>([]);
  const [unreadCount, setUnreadCount]   = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);

  // ── 인증 상태 ──────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []); // eslint-disable-line

  // ── Pro 관심기업 알림 fetch ────────────────────────────────────
  const fetchNotifications = () =>
    fetch('/api/notifications')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setIsPro(data.isPro);
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      })
      .catch(() => {});

  // 로그인 후 최초 로드 + 1분 폴링
  useEffect(() => {
    if (!authReady || !user) return;
    fetchNotifications();
    const id = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(id);
  }, [authReady, user]); // eslint-disable-line

  // 드롭다운 열고 닫을 때 상태 초기화 + 캐시 없이 재조회
  useEffect(() => {
    if (!open) {
      setNotifications([]);
      setUnreadCount(0);
      setNotifLoading(false);
      return;
    }
    setNotifications([]);
    setUnreadCount(0);
    setNotifLoading(true);
    fetch('/api/notifications', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setIsPro(data.isPro);
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      })
      .catch(() => {})
      .finally(() => setNotifLoading(false));
  }, [open]);

  // ── 외부 클릭 시 닫기 ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── 읽음 처리 ──────────────────────────────────────────────────
  const markRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    });
  };

  const handleNotifClick = async (n: StockNotification) => {
    if (!n.is_read) await markRead(n.id);
    router.push(`/stock/${n.stock_code}`);
    setOpen(false);
  };

  // ── 알림 타입 분류 ────────────────────────────────────────────
  const isUpType   = (t: string) => ['price_up',   'foreign_buy',  'institution_buy' ].includes(t);
  const isDownType = (t: string) => ['price_down', 'foreign_sell', 'institution_sell'].includes(t);

  // ── 배지 카운트 ────────────────────────────────────────────────
  const badgeCount = Math.min(isPro ? unreadCount : 0, 99);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg hover:bg-slate-800 transition-colors focus:outline-none"
        aria-label="알림"
      >
        <Bell
          className={`w-5 h-5 text-gray-400 dark:text-[#c2c6d6] ${
            badgeCount > 0 ? 'animate-wiggle' : ''
          }`}
        />
        {badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 bg-[#1a1d27] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* ── 헤더 ── */}
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">알림</h3>
            <div className="flex items-center gap-3">
              {isPro && unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  모두 읽음
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-slate-500 hover:text-slate-300 transition-colors text-xs"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="max-h-[480px] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full">

            {/* ── Pro: 관심기업 알림 섹션 ── */}
            {(isPro || notifLoading) && (
              <div>
                <p className="px-4 pt-3 pb-1.5 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                  ⭐ 관심기업 알림
                </p>
                {notifLoading ? (
                  <div className="px-4 pb-4 flex flex-col gap-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="w-[3px] h-10 rounded-full bg-slate-700/60 animate-pulse shrink-0" />
                        <div className="flex-1 flex flex-col gap-1.5">
                          <div className="h-3 w-full rounded bg-slate-700/60 animate-pulse" />
                          <div className="h-2.5 w-1/3 rounded bg-slate-700/40 animate-pulse" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="px-4 pb-4 text-center">
                    <p className="text-slate-500 text-xs">새 알림이 없습니다</p>
                    <p className="text-slate-600 text-[10px] mt-0.5">
                      주가·수급 변동 시 알림을 드립니다
                    </p>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const isUp   = isUpType(n.type);
                    const isDown = isDownType(n.type);
                    const barColor = isUp
                      ? 'bg-red-500/60'
                      : isDown
                      ? 'bg-blue-500/60'
                      : 'bg-slate-700/40';
                    const bgColor = isUp
                      ? n.is_read ? 'bg-red-500/[0.04] hover:bg-red-500/[0.08]' : 'bg-red-500/[0.08] hover:bg-red-500/[0.12]'
                      : isDown
                      ? n.is_read ? 'bg-blue-500/[0.04] hover:bg-blue-500/[0.08]' : 'bg-blue-500/[0.08] hover:bg-blue-500/[0.12]'
                      : n.is_read ? 'hover:bg-slate-800/30' : 'bg-indigo-950/30 hover:bg-indigo-950/50';

                    return (
                      <div
                        key={n.id}
                        onClick={() => handleNotifClick(n)}
                        className={`flex items-stretch border-b border-slate-800/60 cursor-pointer transition-colors ${bgColor}`}
                      >
                        {/* 왼쪽 컬러 바 */}
                        <div className={`w-[3px] shrink-0 rounded-r-full my-1 ${barColor}`} />

                        <div className="flex items-start gap-2 flex-1 min-w-0 px-3 py-3">
                          {/* 방향 아이콘 */}
                          <span className={`mt-[2px] text-[11px] shrink-0 font-bold ${isUp ? 'text-red-400' : isDown ? 'text-blue-400' : 'text-slate-500'}`}>
                            {isUp ? '▲' : isDown ? '▼' : '●'}
                          </span>

                          <div className="flex-1 min-w-0">
                            <p className={`text-sm leading-snug ${n.is_read ? 'text-slate-400' : 'text-white font-medium'}`}>
                              {n.message}
                            </p>
                            <p className="text-[10px] text-slate-600 mt-0.5">
                              {new Date(n.created_at).toLocaleString('ko-KR', {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>

                          {!n.is_read && (
                            <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${isUp ? 'bg-red-500' : isDown ? 'bg-blue-500' : 'bg-indigo-500'}`} />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                {/* 구분선 */}
                <div className="border-t border-slate-700/60 mx-4 my-1" />
              </div>
            )}

            {/* 비Pro 회원: 관심기업 알림 프로모 */}
            {authReady && user && !isPro && (
              <div className="mx-4 mb-3 mt-1 px-3 py-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/40">
                <p className="text-[11px] text-indigo-300 font-medium">
                  ⭐ Pro 구독자는 관심기업 주가·수급 알림도 받을 수 있어요
                </p>
                <button
                  onClick={() => { router.push('/pricing'); setOpen(false); }}
                  className="mt-1.5 text-[10px] text-indigo-400 hover:text-indigo-200 transition-colors underline underline-offset-2"
                >
                  Pro 플랜 보기 →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
