'use client';

import React, { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import type { StockPrice } from '../../lib/types';

interface StockHeaderProps {
  ticker: string;
}

export default function StockHeader({ ticker }: StockHeaderProps) {
  const [data, setData] = useState<StockPrice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock/${ticker}/price`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json: StockPrice = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터 조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [ticker]);

  if (loading) {
    return (
      <section className="mb-6 animate-pulse">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-3">
            <div className="h-3 w-24 bg-gray-200 dark:bg-[#2d313e] rounded" />
            <div className="h-8 w-40 bg-gray-200 dark:bg-[#2d313e] rounded" />
            <div className="h-10 w-56 bg-gray-200 dark:bg-[#2d313e] rounded" />
          </div>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="mb-6">
        <p className="text-red-500 text-sm">{error ?? '데이터 없음'}</p>
        <button
          onClick={fetchData}
          className="mt-2 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400"
        >
          <RefreshCw className="w-3 h-3" /> 재시도
        </button>
      </section>
    );
  }

  const r = data.changeRate;
  const color =
    r > 0 ? 'text-red-600 dark:text-red-400'
    : r < 0 ? 'text-blue-600 dark:text-blue-400'
    : 'text-gray-400';

  return (
    <section id="stock-header-container" className="mb-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold px-2 py-0.5 bg-gray-100 dark:bg-[#1c2b3c] text-blue-600 dark:text-blue-400 rounded uppercase tracking-widest">
              KOSPI
            </span>
            <span className="text-gray-400 dark:text-[#8c909f] font-mono text-xs font-bold tracking-wider">
              {data.ticker}
            </span>
          </div>
          <h2 className="font-sans text-3xl font-extrabold text-gray-950 dark:text-white tracking-tight">
            {data.name}
          </h2>
          <div className="flex items-baseline gap-3.5 mt-2">
            <span className="font-mono text-4xl font-extrabold text-gray-950 dark:text-white">
              {data.price.toLocaleString()}
            </span>
            <div className={`flex items-center font-mono text-lg font-bold ${color}`}>
              {r > 0 ? (
                <ArrowUp className="w-4 h-4 mr-0.5 stroke-[2.5]" />
              ) : r < 0 ? (
                <ArrowDown className="w-4 h-4 mr-0.5 stroke-[2.5]" />
              ) : null}
              {r > 0 ? '+' : ''}
              {data.change.toLocaleString()} ({r > 0 ? '+' : ''}
              {r.toFixed(2)}%)
            </div>
          </div>
        </div>

        <div className="hidden lg:grid grid-cols-2 gap-8 border-l border-gray-200 dark:border-[#2d313e] pl-8">
          <div>
            <p className="text-[10px] font-bold text-gray-400 dark:text-[#8c909f] uppercase mb-1">
              VOLUME
            </p>
            <p className="font-mono text-lg font-bold text-gray-900 dark:text-[#d4e4fa]">
              {data.volume.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 dark:text-[#8c909f] uppercase mb-1">
              TRANSACTION VALUE
            </p>
            <p className="font-mono text-lg font-bold text-gray-900 dark:text-[#d4e4fa]">
              {data.tradingValue} <span className="text-xs font-normal text-gray-400">KRW</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
