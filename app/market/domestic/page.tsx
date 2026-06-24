'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

const TABS = ['거래대금순', '거래량순', '급등', '급락'] as const;
type Tab = typeof TABS[number];

interface StockRow {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  change: number;
  volume: number;
  tradingValue: number;
}

interface IndexCard {
  label: string;
  value: number;
  change: number;
  changeRate: number;
  isExchange?: boolean;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

const SPARK_UP   = [0.3,0.5,0.4,0.6,0.55,0.7,0.65,0.8,0.72,0.9,0.85,1.0].map(v => ({ v }));
const SPARK_DOWN = [1.0,0.85,0.9,0.7,0.8,0.6,0.68,0.5,0.58,0.4,0.45,0.3].map(v => ({ v }));

function Sparkline({ isUp }: { isUp: boolean }) {
  const color = isUp ? '#ef4444' : '#3b82f6';
  const gid   = `sp-${isUp ? 'u' : 'd'}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={isUp ? SPARK_UP : SPARK_DOWN} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RANK_BADGE: Record<number, string> = {
  1: 'bg-amber-400/20 text-amber-300 border border-amber-400/30',
  2: 'bg-slate-400/15 text-slate-300 border border-slate-500/30',
  3: 'bg-orange-800/20 text-orange-400 border border-orange-700/30',
};

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtComma  = (v: number) => v.toLocaleString('ko-KR');

const fmtAmount = (v: number): string => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}조`;
  if (v >= 100_000)   return `${(v / 100_000).toFixed(1)}천억`;
  if (v >= 10_000)    return `${(v / 10_000).toFixed(0)}백억`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}십억`;
  return `${v}백만`;
};

const fmtVolume = (v: number): string => {
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}천만`;
  if (v >= 1_000_000)  return `${(v / 1_000_000).toFixed(1)}백만`;
  if (v >= 10_000)     return `${(v / 10_000).toFixed(0)}만`;
  return fmtComma(v);
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function IndexCardView({ card }: { card: IndexCard }) {
  const isUp  = card.changeRate >= 0;
  const color = isUp ? 'text-red-400' : 'text-blue-400';

  return (
    <div className="flex-1 bg-[#1e2130] rounded-2xl overflow-hidden min-w-0">
      <div className="px-5 pt-4 pb-2">
        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-1.5">
          {card.label}
        </p>
        <p className="text-[21px] font-bold text-white font-mono leading-tight">
          {card.value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className={`text-[12px] font-mono mt-1 ${color}`}>
          {isUp ? '▲' : '▼'} {Math.abs(card.change).toFixed(2)}
          <span className="ml-1.5 text-[11px] opacity-75">
            ({isUp ? '+' : ''}{card.changeRate.toFixed(2)}%)
          </span>
        </p>
      </div>
      {/* 스파크라인 */}
      <div className="h-12 w-full">
        <Sparkline isUp={isUp} />
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-slate-800/40">
      {[...Array(15)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
          <div className="w-6 h-6 rounded-full bg-slate-800 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-slate-800 rounded w-28" />
            <div className="h-2.5 bg-slate-800/60 rounded w-16" />
          </div>
          <div className="h-3.5 bg-slate-800 rounded w-16 flex-shrink-0" />
          <div className="h-3.5 bg-slate-800 rounded w-14 flex-shrink-0" />
          <div className="h-3.5 bg-slate-800 rounded w-12 flex-shrink-0" />
          <div className="h-3.5 bg-slate-800 rounded w-16 flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DomesticMarketPage() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('거래대금순');
  const [stocks, setStocks]       = useState<StockRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [indices, setIndices]     = useState<IndexCard[]>([]);

  // 지수 로드
  useEffect(() => {
    fetch('/api/market')
      .then(r => r.json())
      .then(d => {
        const cards: IndexCard[] = [];
        if (d?.KOSPI?.value)   cards.push({ label: 'KOSPI',    ...d.KOSPI });
        if (d?.KOSDAQ?.value)  cards.push({ label: 'KOSDAQ',   ...d.KOSDAQ });
        if (d?.USD_KRW?.value) cards.push({ label: '달러환율', ...d.USD_KRW, isExchange: true });
        setIndices(cards);
      })
      .catch(() => {});
  }, []);

  // 랭킹 로드
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res  = await fetch(`/api/market/ranking?tab=${encodeURIComponent(activeTab)}`);
        const data = await res.json();
        if (!cancelled) setStocks(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setStocks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab]);

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-7">

      {/* 타이틀 */}
      <h1 className="text-[18px] font-bold text-white mb-5 tracking-tight">국내증시</h1>

      {/* 지수 카드 (스파크라인 포함) */}
      {indices.length > 0 && (
        <div className="flex gap-3 mb-7">
          {indices.map(card => <IndexCardView key={card.label} card={card} />)}
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-1.5 mb-4">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer',
              activeTab === tab
                ? 'bg-indigo-600 text-white'
                : 'bg-[#1e2130] text-slate-400 hover:text-slate-200',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      <div className="rounded-2xl bg-[#13161f] overflow-hidden">

        {/* 헤더 */}
        <div className="grid grid-cols-[48px_1fr_110px_90px_90px_110px] gap-3 px-4 py-2.5
          text-[10px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800/60">
          <span className="text-center">#</span>
          <span>종목</span>
          <span className="text-right">현재가</span>
          <span className="text-right">등락률</span>
          <span className="text-right">거래량</span>
          <span className="text-right">거래대금</span>
        </div>

        {loading ? <SkeletonRows /> : stocks.length === 0 ? (
          <p className="py-20 text-center text-slate-600 text-sm">데이터를 불러올 수 없습니다.</p>
        ) : (
          <div className="divide-y divide-slate-800/30">
            {stocks.map((stock, idx) => {
              const isUp       = stock.changeRate >= 0;
              const priceColor = isUp ? 'text-red-400' : 'text-blue-400';
              const badge      = RANK_BADGE[stock.rank];

              return (
                <div
                  key={stock.ticker}
                  onClick={() => router.push(`/stock/${stock.ticker}`)}
                  className={[
                    'grid grid-cols-[48px_1fr_110px_90px_90px_110px] gap-3 px-4 py-3',
                    'cursor-pointer transition-colors duration-100 hover:bg-white/[0.03]',
                    idx % 2 === 1 ? 'bg-white/[0.015]' : '',
                  ].join(' ')}
                >
                  {/* 순위 */}
                  <div className="self-center flex justify-center">
                    {badge ? (
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${badge}`}>
                        {stock.rank}
                      </span>
                    ) : (
                      <span className="text-[12px] font-medium text-slate-600">{stock.rank}</span>
                    )}
                  </div>

                  {/* 종목명 */}
                  <div className="self-center min-w-0">
                    <p className="text-[13px] font-semibold text-white truncate leading-tight">
                      {stock.name}
                    </p>
                    <p className="text-[10px] text-slate-600 font-mono mt-0.5">{stock.ticker}</p>
                  </div>

                  {/* 현재가 */}
                  <p className={`self-center text-right text-[13px] font-bold font-mono ${priceColor}`}>
                    {fmtComma(stock.price)}
                  </p>

                  {/* 등락률 */}
                  <p className={`self-center text-right text-[13px] font-mono font-semibold ${priceColor}`}>
                    {isUp ? '+' : ''}{stock.changeRate.toFixed(2)}%
                  </p>

                  {/* 거래량 */}
                  <p className="self-center text-right text-[13px] font-mono text-slate-400">
                    {fmtVolume(stock.volume)}
                  </p>

                  {/* 거래대금 */}
                  <p className="self-center text-right text-[13px] font-mono text-slate-400">
                    {fmtAmount(stock.tradingValue)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
