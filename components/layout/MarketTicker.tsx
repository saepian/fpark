'use client';

import { useEffect, useState, useCallback } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { MarketResponse } from '../../lib/types';

interface TickerItem {
  label: string;
  value: string;
  changeRate: number;
  changeText: string;
  isMock?: boolean;
}

// 라이브 데이터 없는 항목용 mock 폴백
const MOCK_EXTRAS: TickerItem[] = [
  { label: 'EUR/KRW', value: '1,541.30', changeRate: -0.27, changeText: '-0.27%', isMock: true },
  { label: 'S&P 500', value: '5,473.17', changeRate: 0.33,  changeText: '+0.33%', isMock: true },
];

function fmt(v: number | undefined, decimals = 2): string | null {
  if (v == null || v <= 0) return null;
  return v.toLocaleString('ko-KR', { minimumFractionDigits: decimals });
}

function rateText(r: number | undefined): string {
  if (r == null) return '0.00%';
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`;
}

function buildItems(data: MarketResponse): TickerItem[] {
  const live: TickerItem[] = [];

  const push = (label: string, value: string | null, changeRate: number | undefined) => {
    if (!value) return;
    live.push({ label, value, changeRate: changeRate ?? 0, changeText: rateText(changeRate) });
  };

  push('KOSPI',   fmt(data.KOSPI?.value),   data.KOSPI?.changeRate);
  push('KOSDAQ',  fmt(data.KOSDAQ?.value),  data.KOSDAQ?.changeRate);
  push('USD/KRW', fmt(data.USD_KRW?.value), data.USD_KRW?.changeRate);
  push('NASDAQ',  fmt(data.NASDAQ?.value),  data.NASDAQ?.changeRate);

  return [...live, ...MOCK_EXTRAS];
}

function TickerChip({ item }: { item: TickerItem }) {
  const { changeRate } = item;
  const color =
    changeRate > 0 ? 'text-red-400' :
    changeRate < 0 ? 'text-blue-400' :
    'text-gray-400';
  return (
    <span className="inline-flex items-center gap-2 px-5 whitespace-nowrap border-r border-gray-700/40">
      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
        {item.label}
        {item.isMock && <span className="ml-1 text-[9px] text-gray-600 font-normal">*</span>}
      </span>
      <span className="font-mono text-[12px] font-semibold text-gray-200">
        {item.value}
      </span>
      <span className={`font-mono text-[11px] font-bold flex items-center gap-0.5 ${color}`}>
        {changeRate > 0 && <ArrowUp className="w-2.5 h-2.5 stroke-[3]" />}
        {changeRate < 0 && <ArrowDown className="w-2.5 h-2.5 stroke-[3]" />}
        {item.changeText}
      </span>
    </span>
  );
}

export default function MarketTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/market');
      if (!res.ok) return;
      const data: MarketResponse = await res.json();
      setItems(buildItems(data));
    } catch { /* keep existing data */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!items.length) return null;

  // 3벌 복제 — translateX(-33.333%) 로 1세트 분량 이동
  // 1세트 너비 < 뷰포트여도 2세트가 항상 오른쪽을 커버해 공백 없음
  const tripled = [...items, ...items, ...items];

  return (
    <div className="ticker-wrapper w-full overflow-hidden bg-[#080f1e] border-b border-gray-800/60 h-8 flex items-center relative">
      <div
        className="ticker-scroll flex items-center h-full"
        style={{ width: 'max-content', willChange: 'transform' }}
      >
        {tripled.map((item, i) => (
          <TickerChip key={i} item={item} />
        ))}
      </div>
      {/* 좌우 페이드 마스크 — 스크롤 중 글자가 중간에 뚝 잘려 보이지 않고 배경으로 서서히 사라지도록 */}
      <div
        className="absolute inset-y-0 left-0 w-6 pointer-events-none"
        style={{ background: 'linear-gradient(to right, #080f1e, transparent)' }}
      />
      <div
        className="absolute inset-y-0 right-0 w-6 pointer-events-none"
        style={{ background: 'linear-gradient(to left, #080f1e, transparent)' }}
      />
      {items.some((it) => it.isMock) && (
        <p className="absolute right-3 text-[9px] text-gray-700 pointer-events-none select-none z-10">
          *mock
        </p>
      )}
    </div>
  );
}
