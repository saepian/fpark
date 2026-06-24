'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { AlertResponse } from '../../lib/types';

export default function AlertButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [alerts,  setAlerts]  = useState<AlertResponse | null>(null);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/alerts');
        if (res.ok) setAlerts(await res.json());
      } catch {}
      finally { setLoading(false); }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  // 외부 클릭 시 닫기
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

  const count = alerts?.total ?? 0;
  const hasHigh = (alerts?.highAlerts?.length ?? 0) > 0;
  const hasLow  = (alerts?.lowAlerts?.length  ?? 0) > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg hover:bg-slate-800 transition-colors focus:outline-none"
        aria-label="52주 신고가/신저가 알림"
      >
        <Bell
          className={`w-5 h-5 text-gray-400 dark:text-[#c2c6d6] ${count > 0 ? 'animate-wiggle' : ''}`}
        />
        {!loading && count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 bg-[#1a1d27] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">52주 신고가/신저가</h3>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-slate-300 transition-colors text-xs"
            >
              ✕
            </button>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {/* 신고가 */}
            {hasHigh && (
              <div className="p-3">
                <p className="text-[10px] font-bold text-red-400 mb-2 uppercase tracking-wider">
                  📈 신고가 ({alerts!.highAlerts.length})
                </p>
                {alerts!.highAlerts.map((a) => (
                  <div
                    key={a.ticker}
                    onClick={() => { router.push(`/stock/${a.ticker}`); setOpen(false); }}
                    className="flex justify-between items-center py-1.5 hover:bg-slate-800/60 px-2 rounded cursor-pointer transition-colors"
                  >
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="text-sm font-semibold text-white truncate">{a.name}</span>
                      <span className="text-[10px] text-slate-500 flex-shrink-0">{a.ticker}</span>
                    </div>
                    <span className="text-sm font-mono text-red-400 flex-shrink-0 ml-2">
                      {a.price.toLocaleString()}원
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 신저가 */}
            {hasLow && (
              <div className={`p-3 ${hasHigh ? 'border-t border-slate-700/60' : ''}`}>
                <p className="text-[10px] font-bold text-blue-400 mb-2 uppercase tracking-wider">
                  📉 신저가 ({alerts!.lowAlerts.length})
                </p>
                {alerts!.lowAlerts.map((a) => (
                  <div
                    key={a.ticker}
                    onClick={() => { router.push(`/stock/${a.ticker}`); setOpen(false); }}
                    className="flex justify-between items-center py-1.5 hover:bg-slate-800/60 px-2 rounded cursor-pointer transition-colors"
                  >
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="text-sm font-semibold text-white truncate">{a.name}</span>
                      <span className="text-[10px] text-slate-500 flex-shrink-0">{a.ticker}</span>
                    </div>
                    <span className="text-sm font-mono text-blue-400 flex-shrink-0 ml-2">
                      {a.price.toLocaleString()}원
                    </span>
                  </div>
                ))}
              </div>
            )}

            {!loading && count === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-slate-400 text-sm">현재 52주 신고가/신저가</p>
                <p className="text-slate-500 text-xs mt-1">종목이 없습니다</p>
              </div>
            )}

            {loading && (
              <div className="px-4 py-10 text-center text-slate-500 text-sm">
                조회 중...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
