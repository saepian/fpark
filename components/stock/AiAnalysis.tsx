'use client';

import React, { useState, useEffect } from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';

interface AnalysisData {
  summary: string;
  details: string;
  keywords: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
  disclaimer: string;
  isCached: boolean;
  createdAt: string;
}

interface AiAnalysisProps {
  ticker: string;
}

const SENTIMENT_COLOR = {
  bullish: 'text-red-400',
  bearish: 'text-blue-400',
  neutral: 'text-slate-400',
} as const;

const SENTIMENT_LABEL = {
  bullish: '매수 우세',
  bearish: '매도 우세',
  neutral: '중립',
} as const;

export default function AiAnalysis({ ticker }: AiAnalysisProps) {
  const [data, setData]       = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    const load = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(`/api/stock/${ticker}/analysis`);
          if (!res.ok) throw new Error(`${res.status}`);
          const json = await res.json() as AnalysisData;
          if (!cancelled) setData(json);
          return;
        } catch {
          if (attempt === 0 && !cancelled) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
      if (!cancelled) setError('AI 분석을 불러올 수 없습니다.');
    };

    load().finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) {
    return (
      <div
        id="ai-stock-analysis"
        className="bg-[#122131] dark:bg-[#122131] border border-blue-900/40 p-6 rounded-lg animate-pulse"
      >
        <div className="flex justify-between items-start mb-4">
          <div className="space-y-2">
            <div className="h-5 w-48 bg-[#273647] rounded" />
            <div className="h-3 w-32 bg-[#1c2b3c] rounded" />
          </div>
          <div className="h-6 w-24 bg-[#1c2b3c] rounded-full" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-full bg-[#273647] rounded" />
          <div className="h-4 w-5/6 bg-[#273647] rounded" />
          <div className="h-4 w-3/4 bg-[#1c2b3c] rounded" />
          <div className="h-4 w-full bg-[#273647] rounded mt-3" />
          <div className="h-4 w-4/5 bg-[#1c2b3c] rounded" />
        </div>
        <div className="flex gap-2 mt-4">
          <div className="h-7 w-20 bg-[#1c2b3c] rounded-full" />
          <div className="h-7 w-20 bg-[#1c2b3c] rounded-full" />
          <div className="h-7 w-20 bg-[#1c2b3c] rounded-full" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        id="ai-stock-analysis"
        className="bg-[#122131] border border-blue-900/40 p-6 rounded-lg"
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="text-blue-400 w-5 h-5" />
          <h3 className="font-sans text-lg font-bold text-gray-100">FPARK AI 종목 분석</h3>
        </div>
        <p className="text-sm text-gray-500">{error ?? 'AI 분석 데이터 없음'}</p>
      </div>
    );
  }

  const sentiment = data.sentiment ?? 'neutral';

  return (
    <div
      id="ai-stock-analysis"
      className="bg-[#122131] dark:bg-[#122131] border border-blue-200 dark:border-blue-900/40 p-6 rounded-lg relative overflow-hidden transition-all duration-300 shadow-sm"
    >
      <div className="absolute top-0 right-0 p-4 opacity-[0.03] select-none pointer-events-none">
        <Sparkles className="w-48 h-48 text-blue-500" />
      </div>

      <div className="space-y-5 relative z-10">
        {/* 헤더 */}
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="text-blue-600 dark:text-blue-400 w-5 h-5" />
              <h3 className="font-sans text-lg font-bold text-gray-900 dark:text-gray-100">
                FPARK AI 종목 분석
              </h3>
            </div>
            <p className="text-[11px] font-sans text-gray-400 dark:text-[#8c909f] font-bold">
              {data.isCached ? '오늘 분석 (캐시)' : new Date(data.createdAt).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 기준'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="px-2.5 py-1 border border-blue-400/40 text-blue-600 dark:text-blue-400 text-[10px] font-extrabold rounded uppercase tracking-widest font-sans">
              AI INSIGHT
            </span>
            <span className={`text-xs font-bold ${SENTIMENT_COLOR[sentiment]}`}>
              {SENTIMENT_LABEL[sentiment]}
            </span>
          </div>
        </div>

        {/* 핵심 요약 */}
        <div className="border-l-[3px] border-blue-500/80 pl-4 py-0.5">
          <p className="text-sm text-gray-900 dark:text-gray-100 font-medium leading-relaxed">
            {data.summary}
          </p>
        </div>

        {/* 상세 분석 */}
        <p className="font-sans text-xs md:text-sm text-gray-600 dark:text-[#c2c6d6] leading-relaxed pl-4">
          {data.details}
        </p>

        {/* 키워드 태그 */}
        <div className="flex flex-wrap gap-2 pl-4">
          {data.keywords?.map((kw) => (
            <span
              key={kw}
              className="px-2.5 py-1 bg-blue-100 dark:bg-[#1c2b3c] text-blue-700 dark:text-blue-400 text-xs font-semibold rounded"
            >
              #{kw}
            </span>
          ))}
        </div>

        {/* 면책고지 */}
        <div className="pt-4 border-t border-gray-200 dark:border-[#2d313e]/30 flex items-start gap-2.5 text-[11px] text-gray-400 dark:text-[#8c909f] leading-snug">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{data.disclaimer}</p>
        </div>
      </div>
    </div>
  );
}
