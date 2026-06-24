'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';

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
  value: number;
  change: number;
  changeRate: number;
}

const RANK_COLORS = [
  'bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40',
  'bg-slate-400/20 text-slate-300 ring-1 ring-slate-400/40',
  'bg-orange-700/20 text-orange-400 ring-1 ring-orange-700/40',
];

export default function DomesticMarketPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('거래대금순');
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [indices, setIndices] = useState<IndexCard[]>([]);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    fetch('/api/market')
      .then(r => r.json())
      .then(d => {
        const cards: IndexCard[] = [];
        if (d?.KOSPI?.value)   cards.push({ label: 'KOSPI',   ...d.KOSPI });
        if (d?.KOSDAQ?.value)  cards.push({ label: 'KOSDAQ',  ...d.KOSDAQ });
        if (d?.USD_KRW?.value) cards.push({ label: 'USD/KRW', ...d.USD_KRW });
        setIndices(cards);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setSortKey(null);
      try {
        const res = await fetch(`/api/market/ranking?tab=${encodeURIComponent(activeTab)}`);
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return stocks;
    return [...stocks].sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortDir === 'desc' ? -diff : diff;
    });
  }, [stocks, sortKey, sortDir]);

  const fmtPrice = (v: number) => v.toLocaleString();

  const fmtAmount = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}조`;
    if (v >= 100_000)   return `${(v / 100_000).toFixed(1)}천억`;
    if (v >= 10_000)    return `${(v / 10_000).toFixed(0)}백억`;
    if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}십억`;
    return `${v}백만`;
  };

  const fmtVolume = (v: number) => {
    if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(0)}천만`;
    if (v >= 1_000_000)  return `${(v / 1_000_000).toFixed(1)}백만`;
    if (v >= 10_000)     return `${(v / 10_000).toFixed(0)}만`;
    return v.toLocaleString();
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-slate-600 ml-0.5" />;
    return sortDir === 'desc'
      ? <ArrowDown className="w-3 h-3 text-indigo-400 ml-0.5" />
      : <ArrowUp className="w-3 h-3 text-indigo-400 ml-0.5" />;
  };

  const ColHeader = ({ col, label, className }: { col: SortKey; label: string; className?: string }) => (
    <button
      onClick={() => handleSort(col)}
      className={`flex items-center justify-end gap-0.5 hover:text-slate-300 transition-colors cursor-pointer ${className ?? ''}`}
    >
      {label}
      <SortIcon col={col} />
    </button>
  );

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">

      {/* 페이지 타이틀 */}
      <h1 className="text-xl font-bold text-white mb-5">국내증시</h1>

      {/* 상단 지수 카드 (3열) */}
      {indices.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {indices.map(m => {
            const isUp = m.changeRate >= 0;
            const isUsdKrw = m.label === 'USD/KRW';
            return (
              <div
                key={m.label}
                className="rounded-xl bg-[#1a1d27] border border-slate-800 px-5 py-4
                  hover:border-slate-600 hover:bg-[#1e2130] transition-all cursor-default"
              >
                <p className="text-xs text-slate-500 mb-1">{m.label}</p>
                <p className="text-2xl font-bold font-mono text-white">
                  {isUsdKrw
                    ? m.value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : m.value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className={`text-sm font-mono mt-1 ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
                  {isUp ? '▲' : '▼'} {Math.abs(m.change).toFixed(2)}
                  &nbsp;
                  <span className="text-xs">
                    ({isUp ? '+' : ''}{m.changeRate.toFixed(2)}%)
                  </span>
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-2 mb-4">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer',
              activeTab === tab
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* 종목 테이블 */}
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">

        {/* 헤더 */}
        <div className="grid grid-cols-[40px_1fr_120px_100px_100px_120px] gap-4 px-4 py-2.5
          border-b border-slate-800 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          <span className="text-center">#</span>
          <span>종목명</span>
          <ColHeader col="price"        label="현재가"  className="justify-end" />
          <ColHeader col="changeRate"   label="등락률"  className="justify-end" />
          <ColHeader col="volume"       label="거래량"  className="justify-end" />
          <ColHeader col="tradingValue" label="거래대금" className="justify-end" />
        </div>

        {loading ? (
          <div className="space-y-1 p-2">
            {[...Array(20)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-800/50 rounded animate-pulse" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="py-16 text-center text-slate-500 text-sm">데이터를 불러올 수 없습니다.</p>
        ) : (
          <div>
            {sorted.map((stock, idx) => {
              const isUp = stock.changeRate >= 0;
              const rankStyle = idx < 3 ? RANK_COLORS[idx] : null;
              return (
                <div
                  key={stock.ticker}
                  onClick={() => router.push(`/stock/${stock.ticker}`)}
                  className={[
                    'grid grid-cols-[40px_1fr_120px_100px_100px_120px] gap-4 px-4 py-3',
                    'cursor-pointer transition-colors hover:bg-slate-700/40',
                    'border-b border-slate-800/40 last:border-b-0',
                    idx % 2 === 1 ? 'bg-slate-800/20' : '',
                  ].join(' ')}
                >
                  {/* 순위 */}
                  <div className="self-center flex justify-center">
                    {rankStyle ? (
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${rankStyle}`}>
                        {stock.rank}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-slate-600">{stock.rank}</span>
                    )}
                  </div>

                  {/* 종목명 */}
                  <div className="self-center min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{stock.name}</p>
                    <p className="text-[10px] text-slate-600 font-mono">{stock.ticker}</p>
                  </div>

                  {/* 현재가 */}
                  <span className={`self-center text-right text-sm font-bold font-mono
                    ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
                    {fmtPrice(stock.price)}
                  </span>

                  {/* 등락률 */}
                  <span className={`self-center text-right text-sm font-mono
                    ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
                    {isUp ? '+' : ''}{stock.changeRate.toFixed(2)}%
                  </span>

                  {/* 거래량 */}
                  <span className="self-center text-right text-sm font-mono text-slate-400">
                    {fmtVolume(stock.volume)}
                  </span>

                  {/* 거래대금 */}
                  <span className="self-center text-right text-sm font-mono text-slate-400">
                    {fmtAmount(stock.tradingValue)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
