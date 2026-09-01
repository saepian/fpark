'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import { Search, Sparkles } from 'lucide-react';

import DiagnosisSidebar from '@/components/diagnosis/DiagnosisSidebar';
import PageBackground from '@/components/layout/PageBackground';
import AiLoadingOverlay from '@/components/common/AiLoadingOverlay';
import DiagnosisReport, { type DiagnosisResult } from '@/components/diagnosis/DiagnosisReport';
import { useSmoothTypingText } from '@/lib/useSmoothTypingText';

const RECENT_STOCKS = [
  { ticker: '005930', name: '삼성전자' },
  { ticker: '000660', name: 'SK하이닉스' },
  { ticker: '035420', name: 'NAVER' },
  { ticker: '035720', name: '카카오' },
  { ticker: '005380', name: '현대차' },
];

// ── 결과 카드 ──────────────────────────────────────────────────────────────────
function ResultCard({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      {title && <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-3">{title}</p>}
      {children}
    </div>
  );
}

// mainAnalysisSections_background/flowSummary/valuationNote/watchPoint 4개 top-level
// 키(lib/streaming-json-fields.ts DIAGNOSIS_FIELD_SPECS 참고, 2026-08-12 스키마 분리)를
// mainAnalysisSections 하위 필드명으로 되돌리는 매핑 — 이 키로 도착한 값(partial 포함)을
// prev.mainAnalysisSections 객체 안에 merge한다.
const MAIN_ANALYSIS_SECTION_KEYS: Record<string, keyof NonNullable<DiagnosisResult['mainAnalysisSections']>> = {
  mainAnalysisSections_background: 'background',
  mainAnalysisSections_valuationNote: 'valuationNote',
  mainAnalysisSections_watchPoint: 'watchPoint',
};

// Stage1 'field'/'field-partial' 이벤트의 key를 DiagnosisResult 형태로 매핑
// (app/portfolio-diagnosis/page.tsx의 applyPortfolioField와 동일한 패턴).
// historyNarrative는 history.narrative로 중첩되고, mainAnalysisSections_* 4개는
// mainAnalysisSections 객체 안으로 merge하면서 레거시 mainAnalysis 문자열도 함께
// 합성한다(서버가 DB에 저장하는 합성 로직과 동일 — app/api/diagnosis/route.ts 참고).
// 나머지는 최상위 키 그대로.
function applyDiagnosisField(prev: DiagnosisResult, key: string, value: unknown): DiagnosisResult {
  if (key === 'historyNarrative') {
    return { ...prev, history: { ...prev.history, narrative: value as string } };
  }
  const sectionKey = MAIN_ANALYSIS_SECTION_KEYS[key];
  if (sectionKey) {
    const sections = {
      background: '', valuationNote: '', watchPoint: '',
      ...prev.mainAnalysisSections,
      [sectionKey]: value as string,
    };
    const mainAnalysis = [sections.background, sections.valuationNote, sections.watchPoint]
      .filter(Boolean).join(' ');
    return { ...prev, mainAnalysisSections: sections, mainAnalysis };
  }
  return { ...prev, [key]: value };
}

// ── 사이드바 카드 ──────────────────────────────────────────────────────────────

export default function DiagnosisPage() {
  const router = useRouter();
  const supabase = createClient();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const skipSearch  = useRef(false);

  const [authChecked, setAuthChecked] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  // 입력
  const [ticker, setTicker] = useState('');
  const [stockName, setStockName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ ticker: string; name: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [overseasHint, setOverseasHint] = useState(false);
  const [avgPrice, setAvgPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [buyDate, setBuyDate] = useState('');

  // 상태
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('종목 데이터 수집 중...');
  const [error, setError] = useState('');
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [generatedAt, setGeneratedAt] = useState('');
  // 2026-08-11 스트리밍 전환 — Stage0(서버 계산값) 도착 즉시 showResult가 true가 되므로,
  // AI 필드가 아직 채워지는 중임을 DiagnosisReport에 알려 스켈레톤/타이핑 커서를 그리게 한다.
  // Stage1이 실패해도(stage1-error) isGenerating을 false로 내려 "생성 중" 표시만 멈추면
  // 되고, 별도 실패 배너는 없음 — emitFallbackFields가 채운 안내 문구가 기존 필드 자리에
  // 그대로 뜨는 것으로 충분하다(스트리밍 전환 전에도 buildFallback이 하던 방식과 동일).
  const [isGenerating, setIsGenerating] = useState(false);
  // 2026-08-12 클라이언트 측 smooth streaming — 서버가 보내는 field-partial은 그대로
  // 즉시 반영하되(엔드투엔드 지연 없음), 화면에 "보여주는 길이"는 이 훅이 일정 속도로
  // 따라잡는다(원인 조사: Claude API 자체가 SSE 델타를 문장 조각 단위로 뭉쳐 보내서
  // "단어 단위"로 보이던 문제 — lib/useSmoothTypingText.ts 참고).
  const smoothText = useSmoothTypingText();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace(loginUrlWithRedirect(window.location.pathname + window.location.search)); return; }
      setAuthChecked(true);
      fetch('/api/diagnosis').then(r => r.json()).then(d => setRemaining(d.remaining ?? 0));
    });
  }, []); // eslint-disable-line

  // 검색 자동완성 (종목 직접 선택 시 skipSearch로 드롭다운 억제)
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setOverseasHint(false); return; }
    if (skipSearch.current) { skipSearch.current = false; return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        // 종목진단은 아직 해외 종목 분석을 지원하지 않음 — 선택 가능하게 두면
        // KIS 조회 실패 후 조용히 매수가로 폴백해 엉터리 리포트가 나가므로 검색 결과에서 제외
        // (포트폴리오 진단과 동일한 필터)
        const rows = Array.isArray(data) ? data : [];
        const domesticOnly = rows.filter((s: { isOverseas?: boolean }) => !s.isOverseas);
        const hasOverseas  = rows.some((s: { isOverseas?: boolean }) => s.isOverseas);
        setSearchResults(domesticOnly.slice(0, 6));
        setOverseasHint(domesticOnly.length === 0 && hasOverseas);
        setShowDropdown(true);
      } catch { setSearchResults([]); setOverseasHint(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectStock = (t: string, n: string) => {
    skipSearch.current = true;
    setTicker(t); setStockName(n); setSearchQuery(n); setShowDropdown(false);
  };

  // 2026-08-11 스트리밍 전환 — app/portfolio-diagnosis/page.tsx의 SSE reader 루프와
  // 동일한 패턴. Stage0 이벤트로 서버 계산값이 통째로 도착하면 즉시 결과 화면을 띄우고,
  // 이후 field/field-partial 이벤트가 AI 텍스트를 필드별로 채운다.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) { setError('기업을 선택해주세요.'); return; }
    if (!avgPrice || !quantity) { setError('매입 평균가와 보유 수량을 입력해주세요.'); return; }

    setError(''); setLoading(true); setLoadingLabel('종목 데이터 수집 중...');
    setResult(null); setShowResult(false); setIsGenerating(false);
    smoothText.reset();

    // 2026-07-13 프로덕션 조사(포트폴리오진단)에서 발견된 것과 동일한 안전장치 — Vercel이
    // 함수 실행시간 초과로 강제종료하면 SSE가 명시적 done/error 프레임 없이 그냥 끊기고
    // reader.read()는 done:true를 정상 종료처럼 반환한다. 이 경우 Stage0는 이미 떠 있으므로
    // 화면을 지우지 않고 AI 섹션만 "생성 중" 표시를 멈춘다.
    let receivedTerminalEvent = false;

    try {
      const res = await fetch('/api/diagnosis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker, name: stockName,
          avgPrice: parseInt(avgPrice.replace(/,/g, '')),
          quantity: parseInt(quantity),
          buyDate: buyDate || null,
        }),
        // 2026-07-23: 종목분석(AiAnalysis.tsx)과 동일한 방어적 타임아웃 — 서버
        // maxDuration(120s)보다 살짝 여유를 둬서, 서버가 죽어 응답이 영영 안 오는
        // 경우에도 무한 대기하지 않고 catch로 떨어져 에러 메시지를 보여주게 함.
        signal: AbortSignal.timeout(125_000),
      });

      // 인증·크레딧·검증 에러는 스트림 시작 전에 JSON으로 반환됨(app/api/diagnosis/route.ts)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '분석 실패');
        return;
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'progress') {
              setLoadingLabel(event.label);
            } else if (event.type === 'stage0') {
              const { type: _t, ...stage0Fields } = event;
              setResult(stage0Fields as DiagnosisResult);
              setLoading(false);
              setShowResult(true);
              setIsGenerating(true);
            } else if (event.type === 'field-partial') {
              const { key, value: v } = event;
              setResult(prev => prev ? applyDiagnosisField(prev, key, v) : prev);
              smoothText.feed(key, v);
            } else if (event.type === 'field') {
              const { key, value: v } = event;
              setResult(prev => prev ? applyDiagnosisField(prev, key, v) : prev);
              if (typeof v === 'string') smoothText.snap(key, v);
            } else if (event.type === 'stage1-error') {
              setIsGenerating(false);
              smoothText.snapAll();
            } else if (event.type === 'done') {
              receivedTerminalEvent = true;
              setIsGenerating(false);
              smoothText.snapAll();
              setGeneratedAt(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
              setRemaining(prev => Math.max(0, (prev ?? 1) - 1));
            } else if (event.type === 'error') {
              receivedTerminalEvent = true;
              setError(event.message || '분석 실패');
              setIsGenerating(false);
              smoothText.snapAll();
            }
          } catch { /* malformed SSE line 무시 */ }
        }
      }

      if (!receivedTerminalEvent) {
        // Vercel 강제종료 등으로 done/error 없이 스트림만 끊긴 경우 — 애니메이션이
        // 중간에 멈춘 채로 남지 않도록 여기서도 스냅한다(사용자 대기 방지).
        setIsGenerating(false);
        smoothText.snapAll();
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
      smoothText.snapAll();
    } finally {
      setLoading(false);
      // 위 각 종료 분기에서 이미 snapAll을 호출하지만, 예상 못한 종료 경로가 생기더라도
      // 화면이 타이핑 애니메이션 중간에 멈춰있지 않도록 여기서 한 번 더 보장한다.
      smoothText.snapAll();
    }
  };

  const handleReset = () => {
    setShowResult(false);
    setResult(null);
    setIsGenerating(false);
    smoothText.reset();
    setTicker('');
    setStockName('');
    setSearchQuery('');
    setAvgPrice('');
    setQuantity('');
    setBuyDate('');
    setError('');
    fetch('/api/diagnosis').then(r => r.json()).then(d => setRemaining(d.remaining ?? 0));
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PageBackground />
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── 로딩 오버레이 ── Stage0 도착 전까지만(보통 1~2초) — 도착 즉시 VIEW 2로 전환되고
  // 이후 AI 필드는 DiagnosisReport 내부 스켈레톤/타이핑 커서로 표시된다.
  if (loading) {
    return <AiLoadingOverlay title="AI가 기업을 분석하고 있습니다..." subtitle={loadingLabel} />;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW 2: 결과 — Stage0 도착 시점에 showResult가 true가 되므로, isGenerating이 true인
  // 동안은 AI 필드가 아직 채워지는 중(스켈레톤/타이핑 커서는 DiagnosisReport가 그림)
  // ══════════════════════════════════════════════════════════════════════════
  if (showResult && result) {
    return (
      <DiagnosisReport
        result={result}
        stockName={stockName}
        ticker={ticker}
        generatedAt={generatedAt}
        onReset={handleReset}
        isGenerating={isGenerating}
        revealed={smoothText.revealed}
      />
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW 1: 입력 폼
  // ══════════════════════════════════════════════════════════════════════════
  const isDisabled = remaining === 0;

  return (
    <div className="pb-8">
      <PageBackground />
      <div className="max-w-5xl mx-auto px-4 pt-8">

        {/* 페이지 제목 */}
        <div className="mb-8">
          <p className="text-[11px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-2">AI Portfolio Analysis</p>
          <h1 className="text-2xl font-bold text-white">기업 분석</h1>
          <p className="text-[13px] text-slate-500 mt-1">국내 기업만 지원됩니다 · 해외 기업 분석은 준비 중입니다</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">

          {/* ── 좌측 메인 폼 ── */}
          <form onSubmit={handleSubmit} className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-6 flex flex-col gap-5">
            {/* 섹션 레이블 */}
            <div className="flex items-center gap-2 pb-4 border-b border-slate-700/50">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="text-[11px] font-bold tracking-[0.2em] text-slate-400 uppercase">Add New Holding</span>
            </div>

            {/* 종목 검색 */}
            <div ref={dropdownRef} className="relative">
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">기업</label>
              <div className="relative flex items-center">
                <Search className="absolute left-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setTicker(''); setStockName(''); }}
                  onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && searchResults.length > 0) {
                      e.preventDefault();
                      selectStock(searchResults[0].ticker, searchResults[0].name);
                    }
                  }}
                  placeholder="기업명 또는 코드 검색"
                  className="w-full bg-[#0d1117] border border-slate-700 rounded-xl pl-10 pr-4 py-3
                    text-[14px] text-white placeholder-slate-600
                    focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
                />
                {ticker && (
                  <span className="absolute right-3 text-[11px] text-indigo-400 font-mono bg-indigo-500/10 px-2 py-0.5 rounded-md">
                    {ticker}
                  </span>
                )}
              </div>

              {/* 검색 드롭다운 */}
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1f2e] border border-slate-700
                  rounded-xl shadow-2xl z-50 overflow-hidden">
                  {searchResults.map(s => (
                    <button
                      key={s.ticker} type="button"
                      onClick={() => selectStock(s.ticker, s.name)}
                      className="flex items-center justify-between w-full px-4 py-3
                        hover:bg-slate-700/40 transition-colors"
                    >
                      <span className="text-[14px] text-white">{s.name}</span>
                      <span className="text-[11px] text-slate-500 font-mono">{s.ticker}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 해외 종목만 검색된 경우 안내 문구 (종목진단은 국내 종목만 지원) */}
              {showDropdown && overseasHint && (
                <p className="mt-2 text-[12px] text-amber-400 font-medium">
                  해외 기업은 기업 인사이트 카드에서 확인해주세요.
                </p>
              )}

              {/* 최근 검색 태그 */}
              {!ticker && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {RECENT_STOCKS.map(s => (
                    <button
                      key={s.ticker} type="button"
                      onClick={() => selectStock(s.ticker, s.name)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700
                        text-slate-400 hover:text-white border border-slate-700/50 transition-colors"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 매수가 + 수량 2열 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Purchase Price (KRW)
                </label>
                <input
                  value={avgPrice}
                  onChange={e => setAvgPrice(e.target.value.replace(/[^0-9,]/g, ''))}
                  placeholder="예: 75,000"
                  className="w-full bg-[#0d1117] border border-slate-700 rounded-xl px-4 py-3
                    text-[14px] text-white placeholder-slate-600
                    focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Quantity (주)
                </label>
                <input
                  value={quantity}
                  onChange={e => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="예: 10"
                  className="w-full bg-[#0d1117] border border-slate-700 rounded-xl px-4 py-3
                    text-[14px] text-white placeholder-slate-600
                    focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
                />
              </div>
            </div>

            {/* 매수 날짜 — buyDate 입력률이 낮아(11.6%) 벤치마크 비교 섹션이 대부분 안 뜨는
                상태였다(2026-08-26 조사) — 강제 필수화는 기존 플로우를 막으므로 하지 않고,
                입력 시 이득을 짧게 안내해 자발적 입력을 유도한다. */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Purchase Date <span className="normal-case text-slate-600 font-normal">(선택)</span>
              </label>
              <input
                type="date"
                value={buyDate}
                onChange={e => setBuyDate(e.target.value)}
                className="w-full bg-[#0d1117] border border-slate-700 rounded-xl px-4 py-3
                  text-[14px] text-white
                  focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all
                  [color-scheme:dark]"
              />
              {!buyDate && (
                <p className="mt-1.5 text-[11px] text-indigo-400/80">
                  💡 입력하면 코스피 대비 벤치마크 비교를 함께 볼 수 있어요
                </p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30">
                <span className="text-red-400 text-[13px]">{error}</span>
              </div>
            )}

            {/* 진단 버튼 */}
            <div className="pt-1">
              <button
                type="submit"
                disabled={isDisabled}
                className={`w-full relative py-4 rounded-xl font-bold text-[15px] transition-all
                  flex items-center justify-center gap-2 overflow-hidden
                  ${isDisabled
                    ? 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
                    : 'text-white cursor-pointer hover:opacity-90 active:scale-[0.99]'
                  }`}
                style={isDisabled ? {} : {
                  background: 'linear-gradient(135deg, #4f46e5 0%, #0ea5e9 50%, #10b981 100%)',
                  boxShadow: '0 0 30px rgba(79,70,229,0.3)',
                }}
              >
                {!isDisabled && (
                  <span className="absolute inset-0 bg-white/0 hover:bg-white/5 transition-colors rounded-xl" />
                )}
                <Sparkles className="w-4 h-4" />
                ✦ START AI ANALYSIS
              </button>

              <p className="text-center text-[11px] text-slate-600 mt-2">
                {isDisabled
                  ? '이번 달 이용 한도를 모두 사용했습니다. 다음 달에 초기화됩니다.'
                  : '이번 달 남은 이용 횟수 내에서 무료 · 매달 초기화'}
              </p>
            </div>
          </form>

          {/* ── 우측 사이드바 ── */}
          <DiagnosisSidebar />
        </div>
      </div>
    </div>
  );
}
