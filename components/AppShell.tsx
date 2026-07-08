'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Hero from './main/Hero';
import NewsFeed from './main/NewsFeed';
import TopMovers from './main/TopMovers';
import MarketSummary from './main/MarketSummary';
import AiInsightCard from './main/AiInsightCard';
import OnboardingChecklist from './main/OnboardingChecklist';
import AdFit from './AdFit';

export default function AppShell() {
  const router = useRouter();
  const handleSelectStock = (ticker: string) => router.push(`/stock/${ticker}`);

  return (
    <>
      {/* 풀 와이드 히어로 */}
      <Hero />

      {/* 콘텐츠 그리드 */}
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        {/* 신규 가입자 온보딩 체크리스트 (가입 7일 이내 + 닫지 않은 유저에게만 노출) */}
        <OnboardingChecklist />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <NewsFeed onSelectStock={handleSelectStock} />
          <aside className="flex flex-col gap-4">
            <MarketSummary />
            <TopMovers onSelectStock={handleSelectStock} />
            <AiInsightCard />
            <a href="https://devkitpack.com/tools/stock-avg" target="_blank" rel="noopener noreferrer"
              className="group block rounded-xl border border-slate-700 bg-[#0f1629] p-4 hover:border-blue-500/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-950 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-400 text-xl">⌗</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-blue-400 font-medium">무료 도구</span>
                      <span className="text-[11px] bg-blue-950 text-blue-400 border border-blue-900 px-2 py-0.5 rounded-full">DevKitPack</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-100">평균 매입단가 계산기</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">여러 번에 걸쳐 매입한 평균 단가를 빠르게 계산하세요</p>
                  </div>
                </div>
                <span className="arrow-slide text-blue-400 text-base flex-shrink-0">→</span>
              </div>
            </a>
            {/* <div>
              <p className="text-[10px] text-slate-600 mb-1 text-right">광고</p>
              <AdFit unit="DAN-srccfxvxgEOdHPPB" width={300} height={250} />
            </div> */}
          </aside>
        </div>
      </div>
    </>
  );
}
