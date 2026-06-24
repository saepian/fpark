'use client';

import { useState, useEffect } from 'react';
import { Sparkles, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';
import type { AnalysisResult } from '@/app/api/stock/[ticker]/analysis/route';

const ANALYSIS_STEPS = [
  '📊 시장 데이터 수집 중...',
  '📈 차트 패턴 분석 중...',
  '💹 투자자 동향 파악 중...',
  '⚡ 리스크 요인 검토 중...',
  '🎯 목표가 산출 중...',
  '📝 분석 리포트 작성 중...',
];

function AiLoadingScreen() {
  const [msgIdx,    setMsgIdx]    = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [fading,    setFading]    = useState(false);
  const [activeDot, setActiveDot] = useState(0);

  const message = ANALYSIS_STEPS[msgIdx];
  const chars   = [...message]; // emoji-safe split
  const displayed = chars.slice(0, charCount).join('');
  const done      = charCount >= chars.length;

  // 타이핑 + 순환
  useEffect(() => {
    if (fading) return;
    if (!done) {
      const t = setTimeout(() => setCharCount(c => c + 1), 55);
      return () => clearTimeout(t);
    }
    const wait = setTimeout(() => {
      setFading(true);
      const fade = setTimeout(() => {
        setMsgIdx(i => (i + 1) % ANALYSIS_STEPS.length);
        setCharCount(0);
        setFading(false);
      }, 350);
      return () => clearTimeout(fade);
    }, 1100);
    return () => clearTimeout(wait);
  }, [charCount, done, fading]);

  // 점 순차 점등
  useEffect(() => {
    const t = setInterval(() => setActiveDot(d => (d + 1) % 3), 420);
    return () => clearInterval(t);
  }, []);

  return (
    <div id="ai-stock-analysis" className="bg-[#122131] border border-blue-900/40 rounded-xl overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-blue-900/30">
        <div className="flex items-center gap-2">
          <Sparkles className="text-blue-400 w-4 h-4 shrink-0" />
          <span className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">FPARK AI</span>
        </div>
        <p className="text-[14px] font-semibold text-slate-300 mt-1.5">분석 중...</p>
      </div>

      <div className="px-6 py-8 flex flex-col items-center gap-6">
        {/* 타이핑 문구 */}
        <div
          className="min-h-[28px] text-center transition-opacity duration-300"
          style={{ opacity: fading ? 0 : 1 }}
        >
          <span className="text-[15px] font-medium text-indigo-300 tracking-wide">
            {displayed}
          </span>
          <span className="ml-0.5 text-white animate-pulse font-light">|</span>
        </div>

        {/* 점 3개 로딩 인디케이터 */}
        <div className="flex items-center gap-2">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-2 rounded-full transition-all duration-200"
              style={{
                backgroundColor: activeDot === i ? 'rgb(129 140 248)' : 'rgb(30 41 59)',
                transform: activeDot === i ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        <p className="text-[11px] text-slate-600">AI가 종목을 분석하고 있습니다</p>
      </div>
    </div>
  );
}

const OPINION_STYLE = {
  매수: {
    badge: 'bg-red-500/15 text-red-400 border border-red-500/30',
    bar: 'bg-red-500/70',
    text: 'text-red-400',
  },
  관망: {
    badge: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    bar: 'bg-amber-500/70',
    text: 'text-amber-400',
  },
  매도: {
    badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
    bar: 'bg-blue-500/70',
    text: 'text-blue-400',
  },
} as const;

function fmtPrice(v: number) {
  return v.toLocaleString('ko-KR');
}

function priceDiff(current: number, target: number) {
  const pct = ((target - current) / current) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export default function AiAnalysis({ ticker }: { ticker: string }) {
  const [data, setData]       = useState<AnalysisResult | null>(null);
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
          const json = await res.json() as AnalysisResult;
          if (!cancelled) setData(json);
          return;
        } catch {
          if (attempt === 0 && !cancelled) await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!cancelled) setError('AI 분석을 불러올 수 없습니다.');
    };

    load().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  // ── 로딩
  if (loading) return <AiLoadingScreen />;

  // ── 에러
  if (error || !data) {
    return (
      <div id="ai-stock-analysis" className="bg-[#122131] border border-blue-900/40 p-6 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="text-blue-400 w-5 h-5" />
          <h3 className="text-lg font-bold text-gray-100">FPARK AI 종목 분석</h3>
        </div>
        <p className="text-sm text-gray-500">{error ?? 'AI 분석 데이터 없음'}</p>
      </div>
    );
  }

  const opinion = data.opinion ?? '관망';
  const style   = OPINION_STYLE[opinion] ?? OPINION_STYLE['관망'];
  const timeLabel = data.isCached
    ? '오늘 분석 (캐시)'
    : new Date(data.createdAt).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 기준';

  return (
    <div id="ai-stock-analysis" className="bg-[#122131] border border-blue-900/40 rounded-xl overflow-hidden">

      {/* 상단 헤더 */}
      <div className="px-6 pt-5 pb-4 border-b border-blue-900/30">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="text-blue-400 w-4 h-4 shrink-0" />
            <span className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">FPARK AI</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-wide ${style.badge}`}>
              {opinion}
            </span>
            <span className="px-2 py-1 border border-blue-400/30 text-blue-400/70 text-[10px] font-bold rounded uppercase tracking-widest">
              AI INSIGHT
            </span>
          </div>
        </div>
        <p className="text-[15px] font-semibold text-white leading-snug">
          {data.summary}
        </p>
        <p className="text-[11px] text-slate-500 mt-1.5">{timeLabel}</p>
      </div>

      <div className="px-6 py-4 space-y-5">

        {/* 목표주가 / 손절가 */}
        {(data.target_price || data.stop_loss) && (
          <div className="grid grid-cols-2 gap-3">
            {data.target_price > 0 && (
              <div className="bg-red-500/8 border border-red-500/20 rounded-lg p-3">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingUp className="w-3 h-3 text-red-400" />
                  <span className="text-[10px] text-red-400/80 font-bold uppercase tracking-wide">목표주가</span>
                </div>
                <p className="text-[16px] font-bold font-mono text-red-300">
                  ₩{fmtPrice(data.target_price)}
                </p>
                {data.current_price > 0 && (
                  <p className="text-[11px] text-red-400/60 font-mono mt-0.5">
                    {priceDiff(data.current_price, data.target_price)}
                  </p>
                )}
              </div>
            )}
            {data.stop_loss > 0 && (
              <div className="bg-blue-500/8 border border-blue-500/20 rounded-lg p-3">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingDown className="w-3 h-3 text-blue-400" />
                  <span className="text-[10px] text-blue-400/80 font-bold uppercase tracking-wide">손절가</span>
                </div>
                <p className="text-[16px] font-bold font-mono text-blue-300">
                  ₩{fmtPrice(data.stop_loss)}
                </p>
                {data.current_price > 0 && (
                  <p className="text-[11px] text-blue-400/60 font-mono mt-0.5">
                    {priceDiff(data.current_price, data.stop_loss)}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 섹션들 */}
        {data.sections?.map((sec) => (
          <div key={sec.title}>
            <p className="text-[12px] font-bold text-slate-300 mb-2">{sec.title}</p>
            <ul className="space-y-1.5">
              {sec.points?.map((pt, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-slate-400 leading-snug">
                  <span className="shrink-0 mt-[3px] w-1.5 h-1.5 rounded-full bg-slate-600" />
                  {pt}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* 태그 */}
        {data.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {data.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-blue-950/60 text-blue-400/80 text-[11px] font-semibold rounded"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* 면책 고지 */}
        <div className="pt-3 border-t border-blue-900/30 flex items-start gap-2 text-[11px] text-slate-600 leading-snug">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>{data.disclaimer}</p>
        </div>
      </div>
    </div>
  );
}
