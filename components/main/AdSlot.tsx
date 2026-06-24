'use client';

import React from 'react';
import { Megaphone, ExternalLink } from 'lucide-react';

interface AdSlotProps {
  size?: 'sidebar' | 'feed' | 'banner';
}

export default function AdSlot({ size = 'feed' }: AdSlotProps) {
  // Return different designs based on the sizing
  if (size === 'sidebar') {
    return (
      <div 
        id="adslot-sidebar"
        className="glass-card rounded-lg h-[280px] p-6 flex flex-col items-center justify-center text-center relative overflow-hidden group border border-dashed border-gray-300 dark:border-[#424754] bg-[#1a1d27]/40 hover:border-blue-500 transition-all duration-300"
      >
        {/* Google AdSense: client="ca-pub-12345678" slot="98765432" */}
        <div className="absolute top-2 right-3 font-mono text-[9px] font-bold tracking-widest text-gray-400 dark:text-[#8c909f]">
          AD
        </div>
        <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-500 dark:text-blue-400 mb-3 group-hover:scale-110 transition-transform">
          <Megaphone className="w-6 h-6" />
        </div>
        <span className="font-sans text-xs uppercase tracking-widest text-[#8c909f] font-bold mb-1">
          FPARK PARTNERS
        </span>
        <p className="font-sans text-xs text-gray-500 dark:text-gray-400 px-4 leading-normal mb-4">
          파트너스 기업 매칭 광고 지면
        </p>
        <div className="font-mono text-sm font-bold text-blue-600 dark:text-[#d4e4fa] group-hover:underline">
          광고 문의: ad@fpark.com
        </div>
      </div>
    );
  }

  if (size === 'banner') {
    return (
      <div 
        id="adslot-banner"
        className="w-full min-h-[96px] bg-white dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e] rounded-lg p-5 flex items-center justify-between relative overflow-hidden group cursor-pointer"
      >
        {/* Google AdSense: client="ca-pub-12345678" slot="11111111" */}
        <div className="absolute top-2 right-3 text-[9px] font-mono tracking-widest text-gray-400 dark:text-[#8c909f]">
          ADVERTISEMENT
        </div>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-[#4d8eff]/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Megaphone className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              데이터 중심 투자 전략, FPARK PRO와 함께하세요
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              실시간 AI 예측, 무제한 재무 검색, 고급 지표 분석 제공
            </p>
          </div>
        </div>
        <button className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white dark:bg-[#4d8eff] dark:text-[#00285d] font-bold text-xs rounded hover:opacity-95 transition-opacity">
          PRO 구독하기 <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // Default: 'feed'
  return (
    <div 
      id="adslot-feed"
      className="bg-gray-50 dark:bg-[#0d1c2d] border border-gray-200 dark:border-[#2d313e] p-4 flex items-center justify-between rounded-lg hover:border-blue-400 transition-colors"
    >
      {/* Google AdSense: client="ca-pub-12345678" slot="22222222" */}
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center rounded-lg">
          <Megaphone className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">자산 관리의 새로운 기준</p>
          <p className="text-xs text-gray-500 dark:text-[#c2c6d6]">삼성전자 주주 분들만을 위한 특별 프리미엄 우대 금리 혜택</p>
        </div>
      </div>
      <button className="px-3.5 py-1.5 bg-blue-600 text-white dark:bg-blue-500 font-bold text-xs rounded hover:opacity-90 transition-opacity uppercase">
        Learn More
      </button>
    </div>
  );
}
