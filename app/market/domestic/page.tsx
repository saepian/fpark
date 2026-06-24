'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

const TABS = ['거래대금순', '거래량순', '급등', '급락'] as const;
type Tab = typeof TABS[number];
type SortKey = 'price' | 'changeRate' | 'volume' | 'tradingValue';
type SortDir = 'asc' | 'desc';

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
  symbol: 'KOSPI' | 'KOSDAQ' | 'USD_KRW';
  value: number;
  change: number;
  changeRate: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RANK_BADGE: Record<number, string> = {
  1: 'bg-amber-400/20 text-amber-300 border border-amber-400/30',
  2: 'bg-slate-400/15 text-slate-300 border border-slate-500/30',
  3: 'bg-orange-800/20 text-orange-400 border border-orange-700/30',
};

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtComma = (v: number) => v.toLocaleString('ko-KR');

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

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ closes, isUp, uid }: { closes: number[]; isUp: boolean; uid: string }) {
  const color = isUp ? '#ef4444' : '#3b82f6';
  const gid   = `sp-${uid}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={closes.map(v => ({ v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
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

// ── Index Card ─────────────────────────────────────────────────────────────────

function IndexCardView({ card, closes }: { card: IndexCard; closes: number[] }) {
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
      {closes.length >= 2 && (
        <div className="h-12 w-full">
          <Sparkline closes={closes} isUp={isUp} uid={card.symbol} />
        </div>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="divide-y divide-slate-800/40">
      {[...Array(15)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
          <div className="w-6 h-6 rounded-full bg-slate-800 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-slate-800 rounded w-28" />
            <div className="h-2.5 bg-slate-800/60 rounded w-16" />
          </div>
          <div className="h-3.5 bg-slate-800 rounded w-16 shrink-0" />
          <div className="h-3.5 bg-slate-800 rounded w-14 shrink-0" />
          <div className="h-3.5 bg-slate-800 rounded w-12 shrink-0" />
          <div className="h-3.5 bg-slate-800 rounded w-16 shrink-0" />
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
  const [chartData, setChartData] = useState<Record<string, number[]>>({});
  const [sortKey, setSortKey]     = useState<SortKey | null>(null);
  const [sortDir, setSortDir]     = useState<SortDir>('desc');

  // 지수 + 차트 로드
  useEffect(() => {
    fetch('/api/market')
      .then(r => r.json())
      .then(d => {
        const cards: IndexCard[] = [];
        if (d?.KOSPI?.value)   cards.push({ label: 'KOSPI',    symbol: 'KOSPI',   ...d.KOSPI });
        if (d?.KOSDAQ?.value)  cards.push({ label: 'KOSDAQ',   symbol: 'KOSDAQ',  ...d.KOSDAQ });
        if (d?.USD_KRW?.value) cards.push({ label: '달러환율', symbol: 'USD_KRW', ...d.USD_KRW });
        setIndices(cards);
      })
      .catch(() => {});

    const symbols: Array<'KOSPI' | 'KOSDAQ' | 'USD_KRW'> = ['KOSPI', 'KOSDAQ', 'USD_KRW'];
    Promise.allSettled(
      symbols.map(s => fetch(`/api/market/chart?symbol=${s}`).then(r => r.json()) as Promise<number[]>)
    ).then(results => {
      const map: Record<string, number[]> = {};
      results.forEach((r, i) => { map[symbols[i]] = r.status === 'fulfilled' ? r.value : []; });
      setChartData(map);
    });
  }, []);

  // 랭킹 로드 — 탭 전환 시 정렬 초기화
  useEffect(() => {
    let cancelled = false;
    setSortKey(null);
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

  // 프론트 정렬 (sortKey 없으면 API 순서 그대로)
  const sorted = useMemo(() => {
    if (!sortKey) return stocks;
    return [...stocks].sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortDir === 'desc' ? -diff : diff;
    });
  }, [stocks, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'desc'
      ? <ChevronDown className="w-3 h-3 text-indigo-400" />
      : <ChevronUp   className="w-3 h-3 text-indigo-400" />;
  }

  function ColBtn({ col, label }: { col: SortKey; label: string }) {
    return (
      <button
        onClick={() => handleSort(col)}
        className="flex items-center justify-end gap-1 w-full hover:text-slate-200 transition-colors cursor-pointer"
      >
        {label}<SortIcon col={col} />
      </button>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-7">

      {/* 타이틀 */}
      <h1 className="text-[18px] font-bold text-white mb-5 tracking-tight">국내증시</h1>

      {/* 지수 카드 */}
      {indices.length > 0 && (
        <div className="flex gap-3 mb-7">
          {indices.map(card => (
            <IndexCardView key={card.symbol} card={card} closes={chartData[card.symbol] ?? []} />
          ))}
        </div>
      )}

      {/* 탭 */}
      <div className="flex items-center gap-1.5 mb-4">
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
        {sortKey && (
          <button
            onClick={() => setSortKey(null)}
            className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-500
              border border-slate-700 hover:text-slate-300 hover:border-slate-500 transition-all cursor-pointer"
          >
            정렬 초기화 ✕
          </button>
        )}
      </div>

      {/* 테이블 */}
      <div className="rounded-2xl bg-[#13161f] overflow-hidden">

        {/* 헤더 */}
        <div className="grid grid-cols-[48px_1fr_110px_90px_90px_110px] gap-3 px-4 py-2.5
          text-[10px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800/60">
          <span className="text-center">#</span>
          <span>종목</span>
          <span className="text-right"><ColBtn col="price"        label="현재가" /></span>
          <span className="text-right"><ColBtn col="changeRate"   label="등락률" /></span>
          <span className="text-right"><ColBtn col="volume"       label="거래량" /></span>
          <span className="text-right"><ColBtn col="tradingValue" label="거래대금" /></span>
        </div>

        {loading ? <SkeletonRows /> : sorted.length === 0 ? (
          <p className="py-20 text-center text-slate-600 text-sm">데이터를 불러올 수 없습니다.</p>
        ) : (
          <div className="divide-y divide-slate-800/30">
            {sorted.map((stock, idx) => {
              const isUp       = stock.changeRate >= 0;
              const priceColor = isUp ? 'text-red-400' : 'text-blue-400';
              // 정렬 중: 현재 표시 순서(idx+1) / 기본: API rank
              const displayRank = sortKey ? idx + 1 : stock.rank;
              const badge       = RANK_BADGE[displayRank];

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
                        {displayRank}
                      </span>
                    ) : (
                      <span className="text-[12px] font-medium text-slate-600">{displayRank}</span>
                    )}
                  </div>

                  {/* 종목명 */}
                  <div className="self-center min-w-0">
                    <p className="text-[13px] font-semibold text-white truncate leading-tight">{stock.name}</p>
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
