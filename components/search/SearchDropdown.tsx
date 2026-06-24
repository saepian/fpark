'use client';

import React from 'react';
import type { SearchResult } from '../../lib/types';

interface SearchDropdownProps {
  results: SearchResult[];
  onSelect: (ticker: string) => void;
  onClose: () => void;
  query: string;
}

export default function SearchDropdown({ results, onSelect, onClose, query }: SearchDropdownProps) {
  if (!query) return null;

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
            className="max-h-80 overflow-y-auto divide-y divide-slate-800/60
              [&::-webkit-scrollbar]:w-1
              [&::-webkit-scrollbar-track]:bg-transparent
              [&::-webkit-scrollbar-thumb]:bg-slate-600
              [&::-webkit-scrollbar-thumb]:rounded-full
              [&::-webkit-scrollbar-thumb:hover]:bg-slate-500"
          >
            {results.map((stock) => {
              const isUp = stock.changeRate >= 0;
              return (
                <div
                  id={`search-dropdown-item-${stock.ticker}`}
                  key={stock.ticker}
                  onClick={() => { onSelect(stock.ticker); onClose(); }}
                  className="flex items-center justify-between px-4 py-3
                    hover:bg-slate-800/70 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-500 w-14">
                      {stock.ticker}
                    </span>
                    <span className="font-bold text-sm text-slate-100">
                      {stock.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    {stock.price > 0 && (
                      <span className="font-mono text-sm text-slate-300">
                        {stock.price.toLocaleString()}원
                      </span>
                    )}
                    <span className={`font-mono text-xs w-16 text-right font-semibold ${
                      isUp ? 'text-red-400' : 'text-blue-400'
                    }`}>
                      {stock.price > 0 ? `${isUp ? '+' : ''}${stock.changeRate.toFixed(2)}%` : '-'}
                    </span>
                  </div>
                </div>
              );
            })}
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
