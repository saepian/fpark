'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import { Search, Sparkles } from 'lucide-react';

import DiagnosisSidebar from '@/components/diagnosis/DiagnosisSidebar';
import PageBackground from '@/components/layout/PageBackground';
import DiagnosisReport, { type DiagnosisResult } from '@/components/diagnosis/DiagnosisReport';

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
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [generatedAt, setGeneratedAt] = useState('');

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

  // 로딩 단계 자동 진행 (타이밍 기반 UX)
  const LOADING_STEPS = ['기업 데이터 조회 중...', '뉴스 수집 중...', '수급 데이터 조회 중...', '재무 데이터 조회 중...', 'AI 분석 중...'];
  useEffect(() => {
    if (!loading) { setLoadingStep(0); return; }
    const timers = [
      setTimeout(() => setLoadingStep(1), 2500),
      setTimeout(() => setLoadingStep(2), 4500),
      setTimeout(() => setLoadingStep(3), 6500),
      setTimeout(() => setLoadingStep(4), 9000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [loading]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) { setError('기업을 선택해주세요.'); return; }
    if (!avgPrice || !quantity) { setError('매입 평균가와 보유 수량을 입력해주세요.'); return; }

    setError(''); setLoading(true);
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
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '분석 실패'); return; }
      setResult(data);
      setGeneratedAt(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
      setRemaining(prev => Math.max(0, (prev ?? 1) - 1));
      setShowResult(true);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setShowResult(false);
    setResult(null);
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

  // ── 로딩 오버레이 ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-8">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
          <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-emerald-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
        </div>
        <div className="text-center mb-2">
          <p className="text-white font-semibold text-lg mb-1">AI가 기업을 분석하고 있습니다...</p>
          <p className="text-slate-400 text-sm">예상 소요 시간: 15~25초</p>
        </div>
        <div className="flex flex-col gap-3 min-w-[230px]">
          {LOADING_STEPS.map((step, i) => (
            <div key={step} className={`flex items-center gap-3 transition-all duration-500 ${
              i < loadingStep ? 'text-emerald-400' :
              i === loadingStep ? 'text-white' :
              'text-slate-600'
            }`}>
              {i < loadingStep ? (
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center shrink-0 text-[10px]">✓</span>
              ) : i === loadingStep ? (
                <span className="w-5 h-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
              ) : (
                <span className="w-5 h-5 rounded-full border border-slate-700 shrink-0" />
              )}
              <span className={`text-[13px] ${i === loadingStep ? 'font-semibold' : ''}`}>{step}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW 2: 결과
  // ══════════════════════════════════════════════════════════════════════════
  if (showResult && result) {
    return (
      <DiagnosisReport
        result={result}
        stockName={stockName}
        ticker={ticker}
        generatedAt={generatedAt}
        onReset={handleReset}
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
          <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-2">AI Portfolio Analysis</p>
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

            {/* 매수 날짜 */}
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
