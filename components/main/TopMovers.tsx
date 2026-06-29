'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { MoverStock, MoversResponse } from '../../lib/types';

interface TopMoversProps {
  onSelectStock: (ticker: string) => void;
}

function padToTwenty(arr: MoverStock[]): MoverStock[] {
  const result = [...arr];
  while (result.length < 20) {
    result.push({ name: '-', ticker: '-', price: 0, changeRate: 0, isEmpty: true });
  }
  return result.slice(0, 20);
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between p-4 animate-pulse">
      <div className="flex flex-col gap-1.5">
        <div className="h-3.5 w-24 bg-gray-700/50 rounded" />
        <div className="h-2.5 w-14 bg-gray-800/50 rounded" />
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="h-3.5 w-16 bg-gray-700/50 rounded" />
        <div className="h-2.5 w-12 bg-gray-800/50 rounded" />
      </div>
    </div>
  );
}

function StockRow({ stock, rank, onSelectStock }: { stock: MoverStock; rank: number; onSelectStock: (t: string) => void }) {
  if (stock.isEmpty) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 opacity-30">
        <span className="font-mono text-xs font-bold w-4 text-center text-gray-600">{rank}</span>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-sans text-sm font-extrabold text-gray-600">-</span>
          <span className="font-mono text-[11px] font-bold text-gray-700">-</span>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-mono text-sm font-bold text-gray-700">-</div>
          <div className="font-mono text-xs font-bold text-gray-700">-</div>
        </div>
      </div>
    );
  }

  const r = stock.changeRate;
  const color = r > 0 ? 'text-red-500' : r < 0 ? 'text-blue-500' : 'text-gray-400';
  const rankColor = rank <= 3 ? 'text-yellow-400' : 'text-gray-500';

  return (
    <div
      onClick={() => onSelectStock(stock.ticker)}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100/60 dark:hover:bg-[#1c2b3c] transition-colors cursor-pointer group"
    >
      <span className={`font-mono text-xs font-bold w-4 text-center ${rankColor}`}>{rank}</span>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="font-sans text-sm font-extrabold text-[#d4e4fa] group-hover:text-blue-400 transition-colors truncate">
          {stock.name}
        </span>
        <span className="font-mono text-[11px] font-bold text-gray-400 dark:text-[#8c909f] uppercase tracking-wider">
          {stock.ticker}
        </span>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-mono text-sm font-bold text-gray-900 dark:text-gray-100">
          {stock.price.toLocaleString()}
        </div>
        <div className={`font-mono text-xs font-bold ${color}`}>
          {r > 0 ? '+' : ''}{r.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

export default function TopMovers({ onSelectStock }: TopMoversProps) {
  const [tab,      setTab]      = useState<'gainers' | 'losers'>('gainers');
  const [movers,   setMovers]   = useState<MoversResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [spinning, setSpinning] = useState(false);

  const load = async (showSpinner = false) => {
    if (showSpinner) setSpinning(true);
    try {
      const res  = await fetch('/api/market/movers');
      const json = await res.json();
      if (json.gainers?.length > 0 || json.losers?.length > 0) {
        setMovers(json);
      }
    } catch (e) {
      console.error('[MOVERS] error:', e);
    } finally {
      setLoading(false);
      setSpinning(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const displayGainers = padToTwenty(movers?.gainers ?? []);
  const displayLosers  = padToTwenty(movers?.losers  ?? []);
  const list = tab === 'gainers' ? displayGainers : displayLosers;

  return (
    <div id="top-movers-card" className="glass-card bg-[#1a1d27]/40 dark:bg-[#1a1d27]/40 border border-gray-200 dark:border-[#2d313e] rounded-lg flex flex-col overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 pt-4 pb-0 bg-gray-50 dark:bg-[#122131]/60 border-b border-gray-200 dark:border-[#2d313e]">
        <div className="flex justify-between items-center mb-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-sans text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[#8c909f]">
              TOP MOVERS
            </h2>
            {movers?.isCached && movers?.cachedAt && (
              <span className="text-[10px] text-slate-500">
                장마감 · {new Date(movers.cachedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })} 기준
              </span>
            )}
            {!movers?.isCached && movers && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-500">실시간</span>
            )}
          </div>
          <button
            onClick={() => load(true)}
            disabled={loading || spinning}
            className="text-gray-400 hover:text-blue-500 dark:hover:text-[#adc6ff] transition-colors focus:outline-none disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(loading || spinning) ? 'animate-spin text-blue-500' : ''}`} />
          </button>
        </div>
        {/* 탭 */}
        <div className="flex gap-0">
          <button
            onClick={() => setTab('gainers')}
            className={`flex-1 py-2 text-xs font-bold transition-colors border-b-2 ${
              tab === 'gainers'
                ? 'border-red-500 text-red-500'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            급등 TOP 20
          </button>
          <button
            onClick={() => setTab('losers')}
            className={`flex-1 py-2 text-xs font-bold transition-colors border-b-2 ${
              tab === 'losers'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            급락 TOP 20
          </button>
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 divide-y divide-gray-100 dark:divide-[#2d313e]/30">
        {loading && Array.from({ length: 20 }).map((_, i) => <SkeletonRow key={i} />)}

        {!loading && list.map((stock, i) => (
          <StockRow
            key={stock.isEmpty ? `empty-${i}` : stock.ticker}
            stock={stock}
            rank={i + 1}
            onSelectStock={onSelectStock}
          />
        ))}
      </div>
    </div>
  );
}
