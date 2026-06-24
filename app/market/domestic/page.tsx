'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const TABS = ['거래대금순', '거래량순', '급등', '급락', '52주신고가', '52주신저가'] as const;
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

export default function DomesticMarketPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('거래대금순');
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketData, setMarketData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/market').then(r => r.json()).then(setMarketData).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/market/ranking?tab=${encodeURIComponent(activeTab)}`);
        const data = await res.json();
        if (!cancelled) setStocks(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
        if (!cancelled) setStocks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab]);

  const fmtPrice = (v: number) => v.toLocaleString();

  // v: 백만원 단위 (1조 = 1,000,000 백만원)
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

  const isKospiUp  = (marketData?.kospi?.changeRate  || 0) >= 0;
  const isKosdaqUp = (marketData?.kosdaq?.changeRate || 0) >= 0;

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">

      {/* 상단 지수 요약 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          { label: 'KOSPI',  value: marketData?.kospi?.value,  change: marketData?.kospi?.change,  rate: marketData?.kospi?.changeRate,  isUp: isKospiUp },
          { label: 'KOSDAQ', value: marketData?.kosdaq?.value, change: marketData?.kosdaq?.change, rate: marketData?.kosdaq?.changeRate, isUp: isKosdaqUp },
        ].map(m => (
          <div key={m.label} className="rounded-xl bg-[#1a1d27] border border-slate-800 px-5 py-4">
            <p className="text-xs text-slate-500 mb-1">{m.label}</p>
            <p className="text-2xl font-bold font-mono text-white">
              {m.value?.toLocaleString() || '-'}
            </p>
            <p className={`text-sm font-mono mt-1 ${m.isUp ? 'text-red-400' : 'text-blue-400'}`}>
              {m.isUp ? '▲' : '▼'} {Math.abs(m.change || 0).toFixed(2)}
              &nbsp;({m.isUp ? '+' : ''}{(m.rate || 0).toFixed(2)}%)
            </p>
          </div>
        ))}
      </div>

      {/* 탭 */}
      <div className="flex gap-2 mb-4 flex-wrap">
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
          <span className="text-right">현재가</span>
          <span className="text-right">등락률</span>
          <span className="text-right">거래량</span>
          <span className="text-right">거래대금</span>
        </div>

        {loading ? (
          <div className="space-y-1 p-2">
            {[...Array(20)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-800/50 rounded animate-pulse" />
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <p className="py-16 text-center text-slate-500 text-sm">데이터를 불러올 수 없습니다.</p>
        ) : (
          <div>
            {stocks.map((stock, idx) => {
              const isUp = stock.changeRate >= 0;
              return (
                <div
                  key={stock.ticker}
                  onClick={() => router.push(`/stock/${stock.ticker}`)}
                  className={[
                    'grid grid-cols-[40px_1fr_120px_100px_100px_120px] gap-4 px-4 py-3',
                    'cursor-pointer transition-colors hover:bg-slate-800/50',
                    'border-b border-slate-800/40 last:border-b-0',
                    idx === 0 ? 'bg-slate-800/20' : '',
                  ].join(' ')}
                >
                  {/* 순위 */}
                  <span className={[
                    'self-center text-center text-xs font-bold',
                    idx < 3 ? 'text-amber-400' : 'text-slate-600',
                  ].join(' ')}>
                    {stock.rank}
                  </span>

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
