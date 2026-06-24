'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Hero from './main/Hero';
import NewsFeed from './main/NewsFeed';
import TopMovers from './main/TopMovers';
import MarketSummary from './main/MarketSummary';
import AiInsightCard from './main/AiInsightCard';
import AdSlot from './main/AdSlot';

export default function AppShell() {
  const router = useRouter();
  const handleSelectStock = (ticker: string) => router.push(`/stock/${ticker}`);

  return (
    <>
      {/* 풀 와이드 히어로 */}
      <Hero />

      {/* 콘텐츠 그리드 */}
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <NewsFeed onSelectStock={handleSelectStock} />
          <aside className="flex flex-col gap-4">
            <MarketSummary />
            <TopMovers onSelectStock={handleSelectStock} />
            <AiInsightCard />
            <AdSlot size="sidebar" />
          </aside>
        </div>
      </div>
    </>
  );
}
