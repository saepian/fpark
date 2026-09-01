'use client';

import { useState, useEffect } from 'react';
import { Sparkles, AlertCircle, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import type { OverseasAnalysisResult } from '@/app/api/stock/overseas/[ticker]/analysis/route';
import { INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { useSmoothTypingText } from '@/lib/useSmoothTypingText';

// 2026-08-12 SSE 스트리밍 전환 — components/stock/AiAnalysis.tsx(국내 종목분석,
// 이미 검증된 구조)를 그대로 이식. 통화 포맷팅·52주 고저가 색상(빨강/고가·파랑/저가)·
// 거래대금배수/관련뉴스 배지 등 해외 전용 UI만 기존 app/overseas/[market]/[ticker]/page.tsx의
// 인라인 AiAnalysisCard에서 그대로 가져왔다.
const ANALYSIS_STEPS = [
  '📊 글로벌 시장 데이터 수집 중...',
  '📈 차트 패턴 분석 중...',
  '💹 밸류에이션 검토 중...',
  '⚡ 리스크 요인 분석 중...',
  '🎯 52주 가격 위치 확인 중...',
  '📝 분석 리포트 작성 중...',
];

function AiLoadingScreen({ ticker }: { ticker: string }) {
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
    <div id={`ai-stock-analysis-overseas-${ticker}`} className="bg-[#122131] border border-blue-900/40 rounded-xl overflow-hidden">
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

        <p className="text-[11px] text-slate-600">AI가 기업을 분석하고 있습니다</p>
      </div>
    </div>
  );
}

// 아직 도착하지 않은 필드 자리에 보여줄 스켈레톤 — 실제 내용 블록과 높이가 비슷하도록
// 줄 수를 다르게 줘서 레이아웃 점프를 최소화한다.
function FieldSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="space-y-1.5 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded bg-slate-700/40"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

// 지금 문자 단위로 자라나는 중인 필드 끝에 붙는 깜빡이는 커서.
function TypingCursor() {
  return <span className="ml-0.5 text-indigo-300 animate-pulse font-light">▌</span>;
}

// 2026-09-01: 해외증시 지원 범위를 미국으로 한정 — JPY/HKD/CNY는 더 이상 나올 수 없다.
const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$' };

type StreamedData = Partial<OverseasAnalysisResult>;

export default function OverseasAiAnalysis({ ticker, market }: { ticker: string; market: string }) {
  const [data, setData]             = useState<StreamedData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [partialFailure, setPartialFailure] = useState(false);
  const [updatedKey, setUpdatedKey] = useState<string | null>(null);
  // 2026-08-12 클라이언트 측 smooth streaming(국내 종목분석/기업분석/포트폴리오진단과
  // 동일 패턴) — field-partial은 그대로 즉시 반영하되(엔드투엔드 지연 없음), 화면 표시
  // 길이만 35자/초로 서서히 따라잡는다. 재생성(field-updated)은 원래도 즉시 교체라
  // 이 훅을 거치지 않는다.
  const smoothText = useSmoothTypingText();
  const [toast, setToast]           = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const showToast = () => {
    setToast(true);
    setTimeout(() => setToast(false), 2500);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNeedsLogin(false);
    setPartialFailure(false);
    setData(null);
    smoothText.reset();

    const flashUpdated = (key: string) => {
      setUpdatedKey(key);
      setTimeout(() => { if (!cancelled) setUpdatedKey((k) => (k === key ? null : k)); }, 900);
    };

    const run = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        let fieldsArrived = false;
        try {
          // 서버 maxDuration(60s)보다 살짝 여유를 둬서, 정상 응답은 끝까지 기다리되
          // 서버가 죽어 응답이 영영 안 오는 경우엔 무한 대기하지 않도록 함
          const res = await fetch(`/api/stock/overseas/${ticker}/analysis?market=${market}`, { signal: AbortSignal.timeout(65000) });
          if (res.status === 401) {
            if (!cancelled) setNeedsLogin(true);
            return;
          }
          if (res.status === 429) {
            const body = await res.json().catch(() => null) as { error?: string } | null;
            if (!cancelled) setError(body?.error ?? '이번 달 이용 한도를 초과했습니다.');
            return;
          }
          if (!res.ok || !res.body) throw new Error(`${res.status}`);

          const reader  = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let receivedDone = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              let event: Record<string, unknown>;
              try { event = JSON.parse(line.slice(6)); } catch { continue; }

              if (event.type === 'meta') {
                const { type: _t, ...metaFields } = event;
                if (!cancelled) {
                  setLoading(false);
                  setData((prev) => ({ ...prev, ...metaFields } as StreamedData));
                }
              } else if (event.type === 'field-partial') {
                // 문자 단위 타이핑 효과 — 1차 생성에서만 온다(서버가 80ms 스로틀로 전송).
                fieldsArrived = true;
                const key = event.key as keyof OverseasAnalysisResult;
                if (!cancelled) {
                  setData((prev) => ({ ...(prev ?? {}), [key]: event.value }));
                  smoothText.feed(key, event.value as string);
                }
              } else if (event.type === 'field') {
                fieldsArrived = true;
                const key = event.key as keyof OverseasAnalysisResult;
                if (!cancelled) {
                  setData((prev) => ({ ...(prev ?? {}), [key]: event.value }));
                  if (typeof event.value === 'string') smoothText.snap(key, event.value);
                }
              } else if (event.type === 'field-updated') {
                const key = event.key as keyof OverseasAnalysisResult;
                if (!cancelled) {
                  setData((prev) => ({ ...(prev ?? {}), [key]: event.value }));
                  flashUpdated(key);
                }
              } else if (event.type === 'done') {
                receivedDone = true;
                if (!cancelled) {
                  setData((prev) => (prev ? { ...prev, createdAt: (event.createdAt as string) ?? prev.createdAt } : prev));
                  smoothText.snapAll(); // 정상 종료 시 커서 확실히 정리
                }
              } else if (event.type === 'error') {
                throw new Error((event.message as string) ?? 'stream-error');
              }
            }
          }

          if (!receivedDone) {
            // 명시적 done 없이 스트림이 끊김(예: Vercel 함수 타임아웃) — 이미 보여준 필드가
            // 있으면 부분실패로 처리하고 그 내용은 그대로 유지한다.
            if (fieldsArrived) {
              if (!cancelled) { setPartialFailure(true); smoothText.snapAll(); }
              return;
            }
            throw new Error('stream-ended-without-done');
          }
          return; // 성공 종료
        } catch {
          if (fieldsArrived) {
            if (!cancelled) { setPartialFailure(true); smoothText.snapAll(); }
            return;
          }
          // 첫 필드가 뜨기도 전에 실패했을 때만 조용히 1회 재시도(기존 동작과 동일)
          if (attempt === 0 && !cancelled) { await new Promise((r) => setTimeout(r, 2000)); continue; }
        }
      }
      if (!cancelled) setError('AI 분석을 불러올 수 없습니다.');
    };

    run().finally(() => {
      if (!cancelled) {
        setLoading(false);
        // 위 각 종료 분기에서 이미 snapAll을 호출하지만, 예상 못한 종료 경로가 생기더라도
        // 화면이 타이핑 애니메이션 중간에 멈춰있지 않도록 여기서 한 번 더 보장한다.
        smoothText.snapAll();
      }
    });
    return () => { cancelled = true; };
  }, [ticker, market, retryToken]);

  // ── 로딩 (meta 도착 전)
  if (loading) return <AiLoadingScreen ticker={ticker} />;

  // ── 로그인 필요
  if (needsLogin) {
    return (
      <div id={`ai-stock-analysis-overseas-${ticker}`} className="bg-[#122131] border border-blue-900/40 p-6 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="text-blue-400 w-5 h-5" />
          <h3 className="text-lg font-bold text-gray-100">FPARK AI 기업 분석</h3>
        </div>
        <p className="text-sm text-gray-500 mb-3">로그인하면 AI 종목 분석을 이용하실 수 있습니다.</p>
        <a
          href={loginUrlWithRedirect(typeof window !== 'undefined' ? window.location.pathname : '/')}
          className="inline-block px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
        >
          로그인하기
        </a>
      </div>
    );
  }

  // ── 전체 에러 (필드가 하나도 안 뜬 상태에서 실패)
  if (error || !data) {
    return (
      <div id={`ai-stock-analysis-overseas-${ticker}`} className="bg-[#122131] border border-blue-900/40 p-6 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="text-blue-400 w-5 h-5" />
          <h3 className="text-lg font-bold text-gray-100">FPARK AI 기업 분석</h3>
        </div>
        <p className="text-sm text-gray-500">{error ?? 'AI 분석 데이터 없음'}</p>
      </div>
    );
  }

  const currency = data.currency ?? 'USD';
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  const timeLabel = data.createdAt
    ? `리포트 생성 시각: ${new Date(data.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
    : '리포트 생성 중...';

  const priceDiff = (target: number) => {
    if (!data.current_price) return '';
    const pct = ((target - data.current_price) / data.current_price) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  const highlightClass = (key: string) =>
    updatedKey === key ? 'bg-indigo-500/10 transition-colors duration-700' : 'transition-colors duration-700';

  return (
    <div id={`ai-stock-analysis-overseas-${ticker}`} className="bg-[#122131] border border-blue-900/40 rounded-xl overflow-hidden relative">

      {/* 토스트 */}
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none transition-all duration-300"
        style={{ opacity: toast ? 1 : 0, transform: `translateX(-50%) translateY(${toast ? 0 : -6}px)` }}
      >
        <span className="px-3 py-1.5 bg-slate-700 text-slate-200 text-[11px] font-medium rounded-full shadow-lg whitespace-nowrap">
          본 분석은 AI가 생성한 참고 자료입니다
        </span>
      </div>

      {/* 상단 헤더 */}
      <div className="px-6 pt-5 pb-4 border-b border-blue-900/30">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="text-blue-400 w-4 h-4 shrink-0" />
            <span className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">FPARK AI</span>
          </div>
          <div className="flex items-center gap-2">
            {data.tradingValueMultiple !== null && data.tradingValueMultiple !== undefined && (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide bg-slate-700 text-slate-200">
                거래대금 20일 평균 대비 {data.tradingValueMultiple}배
              </span>
            )}
            {data.hasRelevantNews === false && (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide bg-slate-800 text-slate-500">
                최근 관련 뉴스 반영: 없음
              </span>
            )}
            <button
              onClick={showToast}
              className="px-2 py-1 border border-blue-400/30 text-blue-400/70 text-[11px] font-bold rounded uppercase tracking-widest hover:border-blue-400/60 hover:text-blue-400 transition-colors cursor-pointer"
            >
              AI 데이터 요약
            </button>
          </div>
        </div>
        <div className={`rounded-md -mx-1.5 px-1.5 ${highlightClass('headline')}`}>
          {data.headline !== undefined ? (
            <p className="text-[15px] font-semibold text-white leading-snug">
              {smoothText.revealed.headline?.text ?? data.headline}{smoothText.revealed.headline?.active && <TypingCursor />}
            </p>
          ) : (
            <FieldSkeleton lines={1} />
          )}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">{timeLabel}</p>
      </div>

      {/* 상단 면책 안내 */}
      <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
        <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-[11px] text-amber-200/90 leading-relaxed">{INVESTMENT_DISCLAIMER}</p>
      </div>

      <div className="px-6 py-4 space-y-5">

        {/* 52주 최고가·최저가 (그대로 표시, 목표가·손절가 아님) — meta로 즉시 도착 */}
        {((data.resistance ?? 0) > 0 || (data.support ?? 0) > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {(data.resistance ?? 0) > 0 && (
              <div className="bg-red-500/8 border border-red-500/20 rounded-lg p-3">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingUp className="w-3 h-3 text-red-400" />
                  <span className="text-[11px] text-red-400/80 font-bold uppercase tracking-wide">52주 최고가</span>
                </div>
                <p className="text-[15px] font-bold font-mono text-red-300">
                  {sym}{data.resistance!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {(data.current_price ?? 0) > 0 && (
                  <p className="text-[11px] text-red-400/60 font-mono mt-0.5">
                    현재가 대비 {priceDiff(data.resistance!)}
                  </p>
                )}
              </div>
            )}
            {(data.support ?? 0) > 0 && (
              <div className="bg-blue-950/30 border border-blue-500/30 rounded-lg p-3">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingDown className="w-3 h-3 text-blue-400" />
                  <span className="text-[11px] text-blue-400/80 font-bold uppercase tracking-wide">52주 최저가</span>
                </div>
                <p className="text-[15px] font-bold font-mono text-blue-400">
                  {sym}{data.support!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {(data.current_price ?? 0) > 0 && (
                  <p className="text-[11px] text-blue-300/60 font-mono mt-0.5">
                    현재가 대비 {priceDiff(data.support!)}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 본문 */}
        <div>
          <p className={`${SECTION_TITLE_CLASS} text-slate-300 mb-2`}>
            {data.reportType === 'news-driven' ? '📰 오늘의 분석' : '📊 오늘의 분석'}
          </p>
          <div className={`rounded-md -mx-1.5 px-1.5 ${highlightClass('mainAnalysis')}`}>
            {data.mainAnalysis !== undefined ? (
              <p className="text-[13px] text-slate-400 leading-relaxed">
                {smoothText.revealed.mainAnalysis?.text ?? data.mainAnalysis}{smoothText.revealed.mainAnalysis?.active && <TypingCursor />}
              </p>
            ) : (
              <FieldSkeleton lines={4} />
            )}
          </div>
        </div>

        {/* 직전 리포트 대비 */}
        <div className={`bg-indigo-950/30 border border-indigo-800/40 rounded-lg p-3 ${highlightClass('yesterdayDelta')}`}>
          <p className={`${SECTION_TITLE_CLASS} text-indigo-400 uppercase tracking-wide mb-1`}>🔄 직전 리포트 대비</p>
          {data.yesterdayDelta !== undefined ? (
            <p className="text-[13px] text-slate-300 leading-relaxed">
              {smoothText.revealed.yesterdayDelta?.text ?? data.yesterdayDelta}{smoothText.revealed.yesterdayDelta?.active && <TypingCursor />}
            </p>
          ) : (
            <FieldSkeleton lines={2} />
          )}
        </div>

        {/* 리스크 요인 */}
        <div>
          <p className={`${SECTION_TITLE_CLASS} text-slate-300 mb-2`}>⚠️ 리스크 요인</p>
          <div className={`rounded-md -mx-1.5 px-1.5 ${highlightClass('riskFactor')}`}>
            {data.riskFactor !== undefined ? (
              <p className="text-[13px] text-slate-400 leading-relaxed">
                {smoothText.revealed.riskFactor?.text ?? data.riskFactor}{smoothText.revealed.riskFactor?.active && <TypingCursor />}
              </p>
            ) : (
              <FieldSkeleton lines={2} />
            )}
          </div>
        </div>

        {/* 태그 */}
        <div className={`flex flex-wrap gap-1.5 pt-1 min-h-[22px] rounded-md -mx-1.5 px-1.5 ${highlightClass('tags')}`}>
          {data.tags === undefined ? (
            <FieldSkeleton lines={1} />
          ) : (
            data.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-blue-950/60 text-blue-400/80 text-[11px] font-semibold rounded"
              >
                #{tag}
              </span>
            ))
          )}
        </div>

        {/* 부분 실패 안내 */}
        {partialFailure && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
            <p className="text-[12px] text-amber-200/90">나머지 내용을 불러오지 못했습니다.</p>
            <button
              onClick={() => setRetryToken((t) => t + 1)}
              className="flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-[12px] font-semibold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              다시 시도
            </button>
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
