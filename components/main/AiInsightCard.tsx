'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

interface DailyPick {
  ticker: string;
  name: string;
  date: string;
  summary: string;
  analysis: string;
  catalysts: string[];
  risks: string[];
  keywords: string[];
  sentiment: string;
  target_price: string;
  currentPrice: number;
  currentChangeRate: number;
  price_at_pick: number;
}

export default function AiInsightCard() {
  const [pick, setPick] = useState<DailyPick | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/daily-pick')
      .then((r) => r.json())
      .then(setPick)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 space-y-3 animate-pulse">
        <div className="h-3 bg-slate-700 rounded w-28" />
        <div className="h-5 bg-slate-700 rounded w-36" />
        <div className="h-3 bg-slate-700 rounded w-full" />
        <div className="h-3 bg-slate-700 rounded w-4/5" />
        <div className="h-3 bg-slate-700 rounded w-3/5" />
      </div>
    );
  }

  if (!pick) return null;

  const isUp = (pick.currentChangeRate ?? 0) >= 0;
  const priceColor = isUp ? 'text-red-400' : 'text-blue-400';
  const sentimentColor =
    pick.sentiment === 'bullish' ? 'text-red-400 bg-red-400/10 border-red-400/30'
    : pick.sentiment === 'bearish' ? 'text-blue-400 bg-blue-400/10 border-blue-400/30'
    : 'text-slate-400 bg-slate-700/40 border-slate-600/30';

  const dateLabel = new Date(pick.date).toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short',
  });

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-indigo-900/40 to-purple-900/30 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-indigo-400 bg-indigo-400/10 border border-indigo-400/30 rounded-full px-2 py-0.5 tracking-wide">
              FPARK AI
            </span>
            <span className="text-xs text-slate-500 font-medium">오늘의 추천 종목</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-bold border rounded-full px-2 py-0.5 ${sentimentColor}`}>
              {pick.sentiment === 'bullish' ? '매수 관심' : pick.sentiment === 'bearish' ? '주의' : '중립'}
            </span>
            <span className="text-xs text-slate-600">{dateLabel}</span>
          </div>
        </div>

        {/* 종목명 + 현재가 */}
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-base font-bold text-white leading-tight">{pick.name}</h3>
            <span className="text-xs text-slate-500 font-mono">{pick.ticker}</span>
          </div>
          <div className="text-right">
            <p className={`text-lg font-bold font-mono ${priceColor}`}>
              {pick.currentPrice?.toLocaleString()}원
            </p>
            <p className={`text-sm font-mono ${priceColor} flex items-center justify-end gap-0.5`}>
              {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isUp ? '+' : ''}{pick.currentChangeRate?.toFixed(2)}%
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3.5">
        {/* 핵심 투자 포인트 */}
        <div className="border-l-2 border-indigo-500 pl-3">
          <p className="text-sm font-semibold text-white leading-relaxed">
            {pick.summary}
          </p>
        </div>

        {/* 상세 분석 */}
        <p className="text-sm text-slate-400 leading-relaxed">
          {pick.analysis}
        </p>

        {/* 상승 촉매 */}
        {(pick.catalysts?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">
              📈 상승 촉매
            </p>
            <ul className="space-y-1.5">
              {pick.catalysts.map((c, i) => (
                <li key={i} className="text-sm text-slate-400 flex items-start gap-1.5">
                  <span className="text-red-400 mt-0.5 shrink-0">•</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 리스크 */}
        {(pick.risks?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              리스크
            </p>
            <ul className="space-y-1.5">
              {pick.risks.map((r, i) => (
                <li key={i} className="text-sm text-slate-400 flex items-start gap-1.5">
                  <span className="text-amber-400 mt-0.5 shrink-0">•</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 목표가 */}
        {pick.target_price && pick.target_price !== '-' && (
          <div className="bg-slate-800/60 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-500 mb-0.5">단기 목표가 / 저항선</p>
            <p className="text-base font-bold font-mono text-amber-400">{pick.target_price}</p>
          </div>
        )}

        {/* 키워드 */}
        {(pick.keywords?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pick.keywords.map((k) => (
              <span key={k} className="text-xs text-indigo-300 bg-indigo-400/10 border border-indigo-400/20 rounded-full px-2 py-0.5">
                #{k}
              </span>
            ))}
          </div>
        )}

        {/* CTA 버튼 */}
        <button
          onClick={() => router.push(`/stock/${pick.ticker}`)}
          className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors cursor-pointer"
        >
          종목 상세 분석 보기 →
        </button>

        {/* 면책고지 */}
        <p className="text-xs text-slate-600 leading-relaxed">
          ⚠ 본 분석은 AI가 공개 정보를 기반으로 생성한 참고용 자료입니다. 투자 판단과 책임은 투자자 본인에게 있습니다.
        </p>
      </div>
    </div>
  );
}
