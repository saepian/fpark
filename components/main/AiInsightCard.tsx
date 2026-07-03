'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, TrendingDown, AlertTriangle, AlertCircle } from 'lucide-react';
import { INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';

interface DailyPick {
  ticker: string;
  name: string;
  date: string;
  summary: string;
  analysis: string;
  catalysts: string[]; // 참고 정보 (뉴스·실적 등, 보조적)
  risks: string[];
  keywords: string[];
  pick_reason: string;
  foreign_net_buy_auk: number;
  institution_net_buy_auk: number;
  foreign_consecutive_days: number;
  institution_consecutive_days: number;
  week52_high: number | null;
  week52_low: number | null;
  currentPrice: number;
  currentChangeRate: number;
  price_at_pick: number;
}

function fmtAuk(v: number) {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}조원`;
  return `${sign}${abs.toLocaleString()}억원`;
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

  const dateLabel = new Date(pick.date).toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short',
  });

  // 52주 고점 대비 위치 (목표가 개념 아님, 관찰 정보로만 표시)
  const w52Position = (pick.week52_high && pick.week52_low && pick.week52_high > pick.week52_low)
    ? Math.round(((pick.currentPrice - pick.week52_low) / (pick.week52_high - pick.week52_low)) * 100)
    : null;

  const flowLead = [
    pick.foreign_net_buy_auk != null && `전일 외국인 순매수 ${fmtAuk(pick.foreign_net_buy_auk)}`,
    pick.institution_net_buy_auk != null && `전일 기관 순매수 ${fmtAuk(pick.institution_net_buy_auk)}`,
  ].filter(Boolean).join(' · ');

  const flowStreak = [
    pick.foreign_consecutive_days >= 2 && `외국인 ${pick.foreign_consecutive_days}일 연속`,
    pick.institution_consecutive_days >= 2 && `기관 ${pick.institution_consecutive_days}일 연속`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-indigo-900/40 to-purple-900/30 border-b border-slate-800 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between mb-2 gap-1.5">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-indigo-400 bg-indigo-400/10 border border-indigo-400/30 rounded-full px-2 py-0.5 tracking-wide">
                FPARK AI
              </span>
              <span className="text-xs text-slate-500 font-medium">오늘의 수급 상위 기업</span>
            </div>
            <p className="text-[10px] text-slate-600">전일 대량 순매수 또는 5일 연속 순매수 기준으로 선정되었습니다</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold border rounded-full px-2 py-0.5 text-indigo-300 bg-indigo-400/10 border-indigo-400/30">
              {pick.pick_reason}
            </span>
            <span className="text-xs text-slate-600 hidden sm:inline">{dateLabel}</span>
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

      {/* 상단 면책 안내 */}
      <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2">
        <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-[11px] text-amber-200/90 leading-relaxed">
          본 콘텐츠는 공개된 수급 데이터를 기반으로 한 분석 결과이며 기업 추천이 아닙니다. {INVESTMENT_DISCLAIMER}
        </p>
      </div>

      <div className="p-4 space-y-3.5">
        {/* 수급 데이터 — 구체적 수치 */}
        {(flowLead || flowStreak) && (
          <div className="border-l-2 border-indigo-500 pl-3">
            <p className="text-sm font-semibold text-white leading-relaxed">{flowLead}</p>
            {flowStreak && <p className="text-xs text-indigo-300 mt-0.5">{flowStreak} 순매수 관찰됨</p>}
          </div>
        )}

        {/* 요약 */}
        <p className="text-sm text-slate-300 leading-relaxed">{pick.summary}</p>

        {/* 상세 분석 */}
        <p className="text-sm text-slate-400 leading-relaxed">
          {pick.analysis}
        </p>

        {/* 52주 고점 대비 위치 (목표가 아님, 관찰 정보) */}
        {w52Position !== null && (
          <div className="bg-slate-800/60 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-500 mb-0.5">52주 고점 대비 위치 (관찰 정보)</p>
            <p className="text-base font-bold font-mono text-slate-300">
              {w52Position}%
              <span className="text-xs font-normal text-slate-500 ml-1.5">
                (고점 {pick.week52_high?.toLocaleString()}원 / 저점 {pick.week52_low?.toLocaleString()}원)
              </span>
            </p>
          </div>
        )}

        {/* 참고 정보 (뉴스·실적 등, 보조적) */}
        {(pick.catalysts?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              📋 참고 정보
            </p>
            <ul className="space-y-1.5">
              {pick.catalysts.map((c, i) => (
                <li key={i} className="text-sm text-slate-400 flex items-start gap-1.5">
                  <span className="text-slate-500 mt-0.5 shrink-0">•</span>
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
              리스크 요인
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
          기업 리포트 보기 →
        </button>

        {/* 면책고지 */}
        <p className="text-xs text-slate-600 leading-relaxed">
          ⚠ {INVESTMENT_DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
