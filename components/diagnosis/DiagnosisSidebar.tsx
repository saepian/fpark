'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import type { MarketResponse, MarketIndexData } from '@/lib/types';

interface Props {}

interface MarketItem {
  label:      string;
  value:      number;
  change:     number;
  changeRate: number;
  unit?:      string;
  href:       string;
}

/* MarketSummary.tsx와 동일 */
function makeSparkData(isUp: boolean) {
  const pts = isUp
    ? [0.3, 0.5, 0.4, 0.6, 0.5, 0.7, 0.6, 0.8, 0.7, 0.9, 0.85, 1.0]
    : [1.0, 0.85, 0.9, 0.7, 0.8, 0.6, 0.7, 0.5, 0.6, 0.4, 0.45, 0.3];
  return pts.map(v => ({ value: v }));
}

/* gradId를 prop으로 받아 다중 렌더 시 SVG ID 충돌 방지 */
function MiniAreaChart({ isUp, gradId }: { isUp: boolean; gradId: string }) {
  const color = isUp ? '#ef4444' : '#3b82f6';
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
          type="monotone" dataKey="value"
          stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`} dot={false} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function buildMarketItems(data: MarketResponse): MarketItem[] {
  const out: MarketItem[] = [];
  const push = (label: string, d: MarketIndexData | null | undefined, href: string, unit?: string) => {
    if (d && d.value > 0) out.push({ label, value: d.value, change: d.change, changeRate: d.changeRate, unit, href });
  };
  push('KOSPI',   data.KOSPI,   '/market/domestic');
  push('KOSDAQ',  data.KOSDAQ,  '/market/domestic');
  push('USD/KRW', data.USD_KRW, '/market/global', '원');
  return out;
}

/* ────────── 공통 섹션 카드 ────────── */
function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800">
      <div className="px-4 pt-3 pb-2.5 border-b border-slate-800/70">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}


/* ────────── MARKET TREND 슬라이드 카드 ────────── */
function MarketSlide({ items }: { items: MarketItem[] }) {
  const [current, setCurrent] = useState(0);
  const [sliding, setSliding] = useState(false);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX  = useRef<number | null>(null);

  const slide = useCallback((nextFn: (prev: number, len: number) => number, len: number) => {
    setSliding(true);
    setTimeout(() => {
      setCurrent(prev => nextFn(prev, len));
      setSliding(false);
    }, 260);
  }, []);

  /* 3초 자동 슬라이드 */
  useEffect(() => {
    if (items.length === 0) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      slide((prev, len) => (prev + 1) % len, items.length);
    }, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [items.length, current, slide]);

  if (items.length === 0) return null;

  const item       = items[current];
  const isUp       = item.changeRate >= 0;
  const badge      = isUp ? 'bg-red-400/10 text-red-400' : 'bg-blue-400/10 text-blue-400';
  const color      = isUp ? 'text-red-400' : 'text-blue-400';
  const changeSign = item.change >= 0 ? '+' : '';
  const gradId     = `dsg-${item.label.replace('/', '')}-${isUp ? 'u' : 'd'}`;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) slide((prev, len) => (prev + 1) % len, items.length);
      else          slide((prev, len) => (prev - 1 + len) % len, items.length);
    }
    touchStartX.current = null;
  };

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden select-none">
      {/* 헤더 */}
      <div className="flex items-center px-4 pt-3 pb-2.5 border-b border-slate-800/70">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          Market Trend
        </span>
      </div>

      {/* 슬라이드 콘텐츠 */}
      <Link
        href={item.href}
        className="block px-4 pt-3 pb-2 overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          style={{
            transform:  sliding ? 'translateX(-20px)' : 'translateX(0)',
            opacity:    sliding ? 0 : 1,
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

          {/* 현재가 */}
          <div className="flex items-end gap-1.5 mb-0.5">
            <span className="text-2xl font-extrabold font-mono text-white leading-none">
              {item.label === 'USD/KRW'
                ? item.value.toLocaleString('ko-KR', { minimumFractionDigits: 2 })
                : item.value.toLocaleString()}
            </span>
            {item.unit && <span className="text-xs text-slate-500 mb-0.5">{item.unit}</span>}
          </div>

          {/* 등락값 */}
          <div className={`text-xs font-mono ${color} mb-3`}>
            {changeSign}{item.change.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            {' '}({changeSign}{item.changeRate.toFixed(2)}%)
          </div>

          {/* 스파크라인 */}
          <div className="h-14">
            <MiniAreaChart isUp={isUp} gradId={gradId} />
          </div>
        </div>
      </Link>

      {/* 페이지네이션 dots */}
      <div className="flex items-center justify-center gap-1.5 py-3">
        {items.map((_, i) => (
          <button
            key={i}
            type="button"
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

/* 스켈레톤 */
function MarketSlideSkeleton() {
  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden animate-pulse">
      <div className="px-4 pt-3 pb-2.5 border-b border-slate-800/70">
        <div className="h-3 bg-slate-700 rounded w-24" />
      </div>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="h-3 bg-slate-700 rounded w-12" />
          <div className="h-4 bg-slate-700 rounded w-16" />
        </div>
        <div className="h-7 bg-slate-700 rounded w-28 mb-1" />
        <div className="h-3 bg-slate-700 rounded w-36 mb-3" />
        <div className="h-14 bg-slate-700/50 rounded" />
      </div>
      <div className="flex justify-center gap-1.5 py-3">
        {[0, 1, 2].map(i => (
          <div key={i} className={`h-1.5 bg-slate-700 rounded-full ${i === 0 ? 'w-4' : 'w-1.5'}`} />
        ))}
      </div>
    </div>
  );
}

/* ────────── 메인 컴포넌트 ────────── */
export default function DiagnosisSidebar(_props: Props) {
  const [marketItems,   setMarketItems]   = useState<MarketItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);

  useEffect(() => {
    fetch('/api/market', { cache: 'no-store' })
      .then(r => r.json())
      .then((data: MarketResponse) => setMarketItems(buildMarketItems(data)))
      .catch(() => {})
      .finally(() => setMarketLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-4">

      {/* ── MARKET TREND 슬라이드 ── */}
      {marketLoading ? <MarketSlideSkeleton /> : <MarketSlide items={marketItems} />}

      {/* ── RISK ALERT ── */}
      <SideCard title="Risk Alert">
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <span className="text-amber-400 text-[11px] mt-0.5 shrink-0">●</span>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              AI 분석은 참고 자료입니다. 투자 결정 전 반드시 직접 검토하세요.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 text-[11px] mt-0.5 shrink-0">●</span>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              과거 수익률이 미래 수익을 보장하지 않습니다.
            </p>
          </div>
        </div>
      </SideCard>

    </div>
  );
}
