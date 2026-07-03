'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { StockInfo } from '../../lib/types';

interface StockMetricsProps {
  ticker: string;
}

export default function StockMetrics({ ticker }: StockMetricsProps) {
  const [info, setInfo] = useState<StockInfo | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [infoRes, priceRes] = await Promise.all([
        fetch(`/api/stock/${ticker}/info`),
        fetch(`/api/stock/${ticker}/price`),
      ]);
      const [infoJson, priceJson] = await Promise.all([infoRes.json(), priceRes.json()]);

      if (priceRes.ok && priceJson.price) setCurrentPrice(priceJson.price);

      if (infoRes.ok) {
        setInfo(infoJson);
        return;
      }

      // API가 재시도·캐시 폴백까지 실패한 경우에만 여기 도달 — 마지막으로 한 번 더 시도
      await new Promise((r) => setTimeout(r, 1000));
      const retryRes = await fetch(`/api/stock/${ticker}/info`);
      if (retryRes.ok) {
        setInfo(await retryRes.json());
      } else {
        throw new Error('일시적으로 정보를 불러오지 못했습니다.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '일시적으로 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [ticker]);

  if (loading) {
    return (
      <div id="stock-metrics-row" className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-[#122131] dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e] p-4 min-h-[96px] space-y-3"
          >
            <div className="h-2.5 w-16 bg-gray-300 dark:bg-[#273647] rounded" />
            <div className="h-6 w-24 bg-gray-300 dark:bg-[#273647] rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="p-4 border border-red-500/30 rounded-lg">
        <p className="text-red-500 text-sm">{error ?? '일시적으로 정보를 불러오지 못했습니다.'}</p>
        <button
          onClick={fetchData}
          className="mt-2 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400"
        >
          <RefreshCw className="w-3 h-3" /> 재시도
        </button>
      </div>
    );
  }

  const rangeDelta = info.week52High - info.week52Low;
  const currentDelta = (currentPrice ?? info.week52Low) - info.week52Low;
  const pct = rangeDelta > 0 ? Math.min(Math.max((currentDelta / rangeDelta) * 100, 0), 100) : 50;

  return (
    <div id="stock-metrics-row-wrap">
      {info.isCached && (
        <div className="flex items-center gap-1.5 mb-2 text-[11px] text-amber-500">
          <RefreshCw className="w-3 h-3 animate-spin" />
          <span>
            최신 정보 업데이트 중
            {info.cachedAt && ` · ${new Date(info.cachedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 기준`}
          </span>
        </div>
      )}
      <div id="stock-metrics-row" className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-[#122131] dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e] p-4 flex flex-col justify-between min-h-[96px]">
        <p className="text-[10px] font-bold text-gray-400 dark:text-[#8c909f] uppercase mb-1 tracking-wider">
          52W Range
        </p>
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] font-mono font-bold text-gray-500 dark:text-[#8c909f]">
            <span>{info.week52Low.toLocaleString()}</span>
            <span>{info.week52High.toLocaleString()}</span>
          </div>
          <div className="h-1.5 w-full bg-gray-200 dark:bg-[#273647] relative rounded-full overflow-visible">
            <div
              className={`absolute -top-1.5 w-4 h-4 rounded-full border border-white dark:border-[#0f1117] flex items-center justify-center transform -translate-x-1/2 shadow-sm transition-all duration-500 ${pct >= 50 ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ left: `${pct}%` }}
              title={`현재가 위치: ${pct.toFixed(1)}%`}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-white select-none pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#122131] dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e] p-4 flex flex-col justify-between min-h-[96px]">
        <p className="text-[10px] font-bold text-gray-400 dark:text-[#8c909f] uppercase mb-1 tracking-wider">
          Market Cap
        </p>
        <p className="font-mono text-lg lg:text-xl font-extrabold text-gray-900 dark:text-[#d4e4fa] leading-none mb-1">
          {info.marketCap} <span className="text-[10px] font-normal text-gray-400">KRW</span>
        </p>
      </div>

      <div className="bg-[#122131] dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e] p-4 flex flex-col justify-between min-h-[96px]">
        <p className="text-[10px] font-bold text-gray-400 dark:text-[#8c909f] uppercase mb-1 tracking-wider">
          PER
        </p>
        <p className="font-mono text-lg lg:text-xl font-extrabold text-gray-900 dark:text-[#d4e4fa] leading-none mb-1">
          {info.per > 0 ? info.per.toFixed(1) : 'N/A'}
        </p>
      </div>

      <div className="bg-[#122131] dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e] p-4 flex flex-col justify-between min-h-[96px]">
        <p className="text-[10px] font-bold text-gray-400 dark:text-[#8c909f] uppercase mb-1 tracking-wider">
          PBR
        </p>
        <p className="font-mono text-lg lg:text-xl font-extrabold text-gray-900 dark:text-[#d4e4fa] leading-none mb-1">
          {info.pbr > 0 ? info.pbr.toFixed(2) : 'N/A'}
        </p>
      </div>
      </div>
    </div>
  );
}
