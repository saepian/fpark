'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import type { SearchResult } from '../../lib/types';

interface SearchDropdownProps {
  results: SearchResult[];
  onSelect: (ticker: string) => void;
  onClose: () => void;
  query: string;
}

const MARKET_FLAG: Record<string, string> = {
  us: '🇺🇸', jp: '🇯🇵', hk: '🇭🇰', cn: '🇨🇳',
};

export default function SearchDropdown({ results, onSelect, onClose, query }: SearchDropdownProps) {
  const router = useRouter();

  if (!query) return null;

  const domestic = results.filter(r => !r.isOverseas);
  const overseas = results.filter(r => r.isOverseas);

  const handleClick = (stock: SearchResult) => {
    if (stock.isOverseas && stock.market) {
      router.push(`/overseas/${stock.market}/${stock.ticker}`);
    } else {
      onSelect(stock.ticker);
    }
    onClose();
  };

  const renderItem = (stock: SearchResult) => {
    const isUp = stock.changeRate >= 0;
    return (
      <div
        id={`search-dropdown-item-${stock.ticker}`}
        key={stock.ticker}
        onClick={() => handleClick(stock)}
        className="flex items-center justify-between px-3 py-2.5 gap-3
          hover:bg-slate-800/70 cursor-pointer transition-colors"
      >
        {/* 좌측: 국기 + 종목명 */}
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          {stock.isOverseas && (
            <span className="text-base shrink-0">
              {MARKET_FLAG[stock.market ?? 'us'] ?? '🌐'}
            </span>
          )}
          <div className="min-w-0 overflow-hidden">
            <p className="text-[13px] font-semibold text-slate-100 truncate leading-tight">
              {stock.name}
            </p>
            <p className="text-xs text-slate-500 font-mono">
              {stock.ticker}
            </p>
          </div>
        </div>

        {/* 우측: 현재가 + 등락률 */}
        <div className="flex items-center gap-2 shrink-0 flex-none">
          {stock.price > 0 && (
            <span className="font-mono text-[13px] text-slate-300">
              {stock.isOverseas
                ? `${stock.currency ?? '$'}${stock.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `${stock.price.toLocaleString()}원`}
            </span>
          )}
          <span className={`font-mono text-xs w-14 text-right font-semibold ${
            isUp ? 'text-red-400' : 'text-blue-400'
          }`}>
            {stock.price > 0 ? `${isUp ? '+' : ''}${stock.changeRate.toFixed(2)}%` : '-'}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      id="search-dropdown-container"
      className="absolute left-0 mt-2 w-full
        bg-[#13151f] border border-slate-700/60
        rounded-xl shadow-2xl shadow-black/40
        overflow-hidden z-[100]"
    >
      {results.length === 0 ? (
        <div className="p-4 text-center text-sm text-slate-500">
          검색 결과가 없습니다
        </div>
      ) : (
        <>
          <div
            className="max-h-80 overflow-y-auto
              [&::-webkit-scrollbar]:w-1
              [&::-webkit-scrollbar-track]:bg-transparent
              [&::-webkit-scrollbar-thumb]:bg-slate-600
              [&::-webkit-scrollbar-thumb]:rounded-full
              [&::-webkit-scrollbar-thumb:hover]:bg-slate-500"
          >
            {/* 국내 종목 */}
            {domestic.length > 0 && (
              <div className="divide-y divide-slate-800/60">
                {domestic.map(renderItem)}
              </div>
            )}

            {/* 구분선 */}
            {domestic.length > 0 && overseas.length > 0 && (
              <div className="px-4 py-1.5 bg-slate-900/50 border-y border-slate-800/60">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">해외 기업</span>
              </div>
            )}

            {/* 해외 종목 */}
            {overseas.length > 0 && (
              <div className="divide-y divide-slate-800/60">
                {overseas.map(renderItem)}
              </div>
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-slate-800/60 bg-slate-900/50">
            <span className="text-xs text-slate-500">
              {results.length}개 결과 · Enter로 검색
            </span>
          </div>
        </>
      )}
    </div>
  );
}
