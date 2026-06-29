'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Minus } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import type { MarketResponse, MarketIndexData } from '@/lib/types';

interface WatchItem { ticker: string; name: string; price: number; changeRate: number }

interface Props {
  watchlist: WatchItem[];
  onSelectStock?: (ticker: string, name: string) => void;
}

interface MarketItem {
  label: string;
  value: number;
  change: number;
  changeRate: number;
  isUp: boolean;
  sparkline: number[];
  href: string;
  unit?: string;
}

// 등락 방향에 따른 더미 스파크라인 (실데이터 없을 때 fallback)
function makeDummy(isUp: boolean) {
  return isUp
    ? [0.3, 0.5, 0.4, 0.6, 0.5, 0.7, 0.6, 0.8, 0.7, 0.9, 0.85, 1.0]
    : [1.0, 0.85, 0.9, 0.7, 0.8, 0.6, 0.7, 0.5, 0.6, 0.4, 0.45, 0.3];
}

function MiniSparkline({ data, isUp, id }: { data: number[]; isUp: boolean; id: string }) {
  const color = isUp ? '#ef4444' : '#3b82f6';
  const chartData = data.map(v => ({ v }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 1, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone" dataKey="v"
          stroke={color} strokeWidth={1.5}
          fill={`url(#${id})`} dot={false} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-4">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  );
}

function fmt(n: number) { return n.toLocaleString(); }
function fmtRate(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

function buildMarketItems(data: MarketResponse): MarketItem[] {
  const items: MarketItem[] = [];
  const push = (label: string, d: MarketIndexData | null | undefined, href: string, unit?: string) => {
    if (!d || d.value <= 0) return;
    const isUp = d.changeRate >= 0;
    items.push({
      label, value: d.value, change: d.change, changeRate: d.changeRate, isUp, href, unit,
      sparkline: d.sparkline?.length ? d.sparkline : makeDummy(isUp),
    });
  };
  push('KOSPI',   data.KOSPI,   '/market/domestic');
  push('KOSDAQ',  data.KOSDAQ,  '/market/domestic');
  push('USD/KRW', data.USD_KRW, '/market/global', '원');
  return items;
}

export default function DiagnosisSidebar({ watchlist, onSelectStock }: Props) {
  const [marketItems, setMarketItems] = useState<MarketItem[]>([]);
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

      {/* ── WATCHLIST ── */}
      <SideCard title="Watchlist">
        {watchlist.length === 0 ? (
          <p className="text-[12px] text-slate-600">관심종목이 없습니다</p>
        ) : (
          <div className="flex flex-col gap-1">
            {watchlist.map(item => (
              <button
                key={item.ticker}
                type="button"
                onClick={() => onSelectStock?.(item.ticker, item.name)}
                className="flex items-center justify-between py-2 px-1 rounded-lg hover:bg-slate-700/30 transition-colors group w-full"
              >
                <div className="text-left">
                  <p className="text-[13px] font-medium text-white group-hover:text-indigo-300 transition-colors truncate max-w-[110px]">
                    {item.name}
                  </p>
                  <p className="text-[10px] text-slate-600 font-mono">{item.ticker}</p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] font-mono text-white">{fmt(item.price)}</p>
                  <p className={`text-[11px] font-mono ${item.changeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {fmtRate(item.changeRate)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </SideCard>

      {/* ── MARKET TREND ── */}
      <SideCard title="Market Trend">
        {marketLoading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="flex-1">
                  <div className="h-2.5 bg-slate-700 rounded w-14 mb-1.5" />
                  <div className="h-4 bg-slate-700 rounded w-20" />
                </div>
                <div className="w-16 h-8 bg-slate-700 rounded" />
              </div>
            ))}
          </div>
        ) : marketItems.length === 0 ? (
          <div className="flex items-center gap-2 text-slate-600">
            <Minus className="w-4 h-4" />
            <span className="text-[12px]">장 마감 시간</span>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-slate-700/40">
            {marketItems.map(item => {
              const gradId = `dsg-${item.label.replace('/', '-')}-${item.isUp ? 'u' : 'd'}`;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] font-bold text-slate-400 group-hover:text-white transition-colors">
                        {item.label}
                      </span>
                      <span className={`text-[10px] font-mono font-semibold ${item.isUp ? 'text-red-400' : 'text-blue-400'}`}>
                        {fmtRate(item.changeRate)}
                      </span>
                    </div>
                    <span className="text-[14px] font-bold font-mono text-white leading-none">
                      {item.label === 'USD/KRW'
                        ? item.value.toLocaleString('ko-KR', { minimumFractionDigits: 2 })
                        : item.value.toLocaleString()}
                      {item.unit && (
                        <span className="text-[10px] text-slate-500 font-normal ml-0.5">{item.unit}</span>
                      )}
                    </span>
                  </div>
                  <div className="w-16 h-8 shrink-0">
                    <MiniSparkline data={item.sparkline} isUp={item.isUp} id={gradId} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </SideCard>

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
