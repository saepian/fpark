'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import type { MarketResponse, MarketIndexData } from '../../lib/types';

function makeSparkData(isUp: boolean) {
  const pts = isUp
    ? [0.3, 0.5, 0.4, 0.6, 0.5, 0.7, 0.6, 0.8, 0.7, 0.9, 0.85, 1.0]
    : [1.0, 0.85, 0.9, 0.7, 0.8, 0.6, 0.7, 0.5, 0.6, 0.4, 0.45, 0.3];
  return pts.map((v) => ({ value: v }));
}

function MiniAreaChart({ isUp }: { isUp: boolean }) {
  const color = isUp ? '#ef4444' : '#3b82f6';
  const gradId = `grad-ms-${isUp ? 'up' : 'dn'}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={makeSparkData(isUp)} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface SlideItem {
  label: string;
  value: number;
  change: number;
  changeRate: number;
  unit?: string;
  showChart: boolean;
}

function buildItems(data: MarketResponse): SlideItem[] {
  const out: SlideItem[] = [];
  const push = (label: string, d: MarketIndexData | null | undefined, unit?: string, showChart = false) => {
    if (d && d.value > 0) out.push({ label, value: d.value, change: d.change, changeRate: d.changeRate, unit, showChart });
  };
  push('KOSPI',   data.KOSPI,   undefined, true);
  push('KOSDAQ',  data.KOSDAQ,  undefined, true);
  push('NASDAQ',  data.NASDAQ,  undefined, true);
  push('USD/KRW', data.USD_KRW, '원',      true);
  return out;
}

export default function MarketSummary() {
  const [items,        setItems]       = useState<SlideItem[]>([]);
  const [current,      setCurrent]     = useState(0);
  const [sliding,      setSliding]     = useState(false);
  const [loading,      setLoading]     = useState(true);
  const [isPrevDay,    setIsPrevDay]   = useState(false);
  const [prevDateLabel, setPrevDateLabel] = useState<string | undefined>();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res  = await fetch('/api/market', { cache: 'no-store' });
      const data: MarketResponse = await res.json();
      if (res.ok) {
        setItems(buildItems(data));
        setIsPrevDay(data.isPrevDay ?? false);
        setPrevDateLabel(data.prevDateLabel);
      }
    } catch (e) {
      console.error('[MarketSummary] 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // 슬라이드 전환 (애니메이션 후 index 변경)
  const slide = useCallback((nextFn: (prev: number, len: number) => number, len: number) => {
    setSliding(true);
    setTimeout(() => {
      setCurrent((prev) => nextFn(prev, len));
      setSliding(false);
    }, 260);
  }, []);

  // 5초 자동 전환 — current 바뀔 때마다 타이머 리셋
  useEffect(() => {
    if (items.length === 0) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      slide((prev, len) => (prev + 1) % len, items.length);
    }, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [items.length, current, slide]);

  // 초기 데이터 + 30초 갱신
  useEffect(() => {
    loadData();
    const refresh = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadData();
    }, 30_000);
    return () => clearInterval(refresh);
  }, [loadData]);

  if (loading) {
    return (
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 animate-pulse">
        <div className="h-3 bg-slate-700 rounded w-24 mb-4" />
        <div className="h-8 bg-slate-700 rounded w-32 mb-2" />
        <div className="h-3 bg-slate-700 rounded w-40 mb-4" />
        <div className="h-14 bg-slate-700 rounded" />
      </div>
    );
  }

  if (!items.length) return null;

  const item  = items[current];
  const isUp  = item.changeRate >= 0;
  const color = isUp ? 'text-red-400' : 'text-blue-400';
  const badge = isUp ? 'bg-red-400/10 text-red-400' : 'bg-blue-400/10 text-blue-400';
  const changeSign = item.change >= 0 ? '+' : '';

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden select-none">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-slate-800/70">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Market Summary
          </span>
          {isPrevDay && (
            <span className="text-[10px] text-slate-500">
              {prevDateLabel ? `${prevDateLabel} 종가 기준` : '전일 종가 기준'}
            </span>
          )}
          {!isPrevDay && !loading && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-500">실시간</span>
          )}
        </div>
        <button
          onClick={loadData}
          className="text-slate-600 hover:text-slate-400 transition-colors cursor-pointer"
          aria-label="새로고침"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* 슬라이드 콘텐츠 */}
      <div className="overflow-hidden px-4 pt-3 pb-2">
        <div
          style={{
            transform: sliding ? 'translateX(-20px)' : 'translateX(0)',
            opacity:   sliding ? 0 : 1,
            transition: 'transform 260ms ease-in-out, opacity 260ms ease-in-out',
          }}
        >
          {/* 지수명 + 등락률 뱃지 */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-200">{item.label}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge}`}>
              {isUp ? '▲' : '▼'} {Math.abs(item.changeRate).toFixed(2)}%
            </span>
          </div>

          {/* 현재값 */}
          <div className="flex items-end gap-1.5 mb-0.5">
            <span className="text-2xl font-extrabold font-mono text-white leading-none">
              {item.label === 'USD/KRW'
                ? item.value.toLocaleString('ko-KR', { minimumFractionDigits: 2 })
                : item.value.toLocaleString()}
            </span>
            {item.unit && (
              <span className="text-xs text-slate-500 mb-0.5">{item.unit}</span>
            )}
          </div>

          {/* 등락값 */}
          <div className={`text-xs font-mono ${color} mb-3`}>
            {changeSign}{item.change.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            {' '}({changeSign}{item.changeRate.toFixed(2)}%)
          </div>

          {/* 미니 스파크차트 (KOSPI/KOSDAQ만) */}
          {item.showChart && (
            <div className="h-14">
              <MiniAreaChart isUp={isUp} />
            </div>
          )}
        </div>
      </div>

      {/* 인디케이터 점 */}
      <div className="flex items-center justify-center gap-1.5 py-3">
        {items.map((_, i) => (
          <button
            key={i}
            onClick={() => slide(() => i, items.length)}
            className={[
              'rounded-full transition-all duration-200 cursor-pointer',
              i === current
                ? 'w-4 h-1.5 bg-indigo-400'
                : 'w-1.5 h-1.5 bg-slate-600 hover:bg-slate-500',
            ].join(' ')}
          />
        ))}
      </div>
    </div>
  );
}
