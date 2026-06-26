'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { Search, Sparkles, ChevronLeft, Share2, Printer, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface DiagnosisResult {
  summary: string;
  currentPrice: number;
  avgPrice: number;
  quantity: number;
  profitRate: number;
  profitAmount: number;
  news: { title: string; description: string }[];
  institutional: string;
  foreign: string;
  technical: string;
  recommendation: '홀딩' | '매도' | '분할매도' | '추가매수' | '손절';
  reason: string;
  targetPrice: number;
  stopLoss: number;
  risk: string;
  opportunity: string;
}

interface WatchItem { ticker: string; name: string; price: number; changeRate: number }
interface MarketData { value: number; changeRate: number }

const REC_CONFIG: Record<string, { icon: string; color: string; bg: string; border: string; glow: string }> = {
  홀딩:   { icon: '◆', color: 'text-blue-300',   bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   glow: 'shadow-blue-500/20' },
  매도:   { icon: '▼', color: 'text-red-300',    bg: 'bg-red-500/10',    border: 'border-red-500/30',    glow: 'shadow-red-500/20' },
  분할매도: { icon: '▽', color: 'text-orange-300', bg: 'bg-orange-500/10', border: 'border-orange-500/30', glow: 'shadow-orange-500/20' },
  추가매수: { icon: '▲', color: 'text-emerald-300',bg: 'bg-emerald-500/10',border: 'border-emerald-500/30',glow: 'shadow-emerald-500/20' },
  손절:   { icon: '✕', color: 'text-red-400',    bg: 'bg-red-700/10',    border: 'border-red-700/30',    glow: 'shadow-red-700/20' },
};

const RECENT_STOCKS = [
  { ticker: '005930', name: '삼성전자' },
  { ticker: '000660', name: 'SK하이닉스' },
  { ticker: '035420', name: 'NAVER' },
  { ticker: '035720', name: '카카오' },
  { ticker: '005380', name: '현대차' },
];

function fmt(n: number) { return n.toLocaleString(); }
function fmtRate(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

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
function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-4">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  );
}

export default function DiagnosisPage() {
  const router = useRouter();
  const supabase = createClient();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  // 입력
  const [ticker, setTicker] = useState('');
  const [stockName, setStockName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ ticker: string; name: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [avgPrice, setAvgPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [buyDate, setBuyDate] = useState('');

  // 상태
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [generatedAt, setGeneratedAt] = useState('');

  // 사이드바
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [kospi, setKospi] = useState<MarketData | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace('/auth/login'); return; }
      setAuthChecked(true);
      fetch('/api/diagnosis').then(r => r.json()).then(d => setRemaining(d.remaining ?? 0));
      fetch('/api/watchlist').then(r => r.json()).then(d => {
        if (Array.isArray(d)) setWatchlist(d.filter(i => i.market === 'kr' || !i.market).slice(0, 3));
      }).catch(() => {});
      fetch('/api/market').then(r => r.json()).then(d => {
        if (d?.KOSPI) setKospi(d.KOSPI);
      }).catch(() => {});
    });
  }, []); // eslint-disable-line

  // 검색 자동완성
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data.slice(0, 6) : []);
        setShowDropdown(true);
      } catch { setSearchResults([]); }
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
    setTicker(t); setStockName(n); setSearchQuery(n); setShowDropdown(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) { setError('종목을 선택해주세요.'); return; }
    if (!avgPrice || !quantity) { setError('매수 평균가와 보유 수량을 입력해주세요.'); return; }

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
      if (!res.ok) { setError(data.error || '진단 실패'); return; }
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
    fetch('/api/diagnosis').then(r => r.json()).then(d => setRemaining(d.remaining ?? 0));
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── 로딩 오버레이 ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-6">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
          <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-emerald-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
        </div>
        <div className="text-center">
          <p className="text-white font-semibold text-lg mb-1">AI가 종목을 분석하고 있습니다...</p>
          <p className="text-slate-400 text-sm">예상 소요 시간: 10~20초</p>
        </div>
        <div className="flex gap-2 mt-2">
          {['수급 분석', '뉴스 수집', 'AI 판단'].map((step, i) => (
            <span key={step} className="text-[11px] px-3 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {step}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW 2: 결과
  // ══════════════════════════════════════════════════════════════════════════
  if (showResult && result) {
    const cfg = REC_CONFIG[result.recommendation] ?? REC_CONFIG['홀딩'];
    const isProfit = result.profitRate >= 0;

    return (
      <div className="min-h-screen bg-[#0d1117] pb-16">
        <div className="max-w-5xl mx-auto px-4 pt-8">

          {/* 헤더 */}
          <div className="flex items-start justify-between mb-8 gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-2">AI 상세 진단 리포트</p>
              <h1 className="text-2xl font-bold text-white mb-1">{stockName} <span className="text-slate-500 font-mono text-lg">({ticker})</span></h1>
              <p className="text-[12px] text-slate-500">리포트 생성: {generatedAt}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => alert('준비 중입니다.')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700
                  border border-slate-700 text-slate-400 text-[12px] transition-colors cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" /> SHARE
              </button>
              <button
                onClick={() => alert('준비 중입니다.')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700
                  border border-slate-700 text-slate-400 text-[12px] transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" /> PRINT
              </button>
            </div>
          </div>

          {/* 1행: 추천 의견 + 수익 스냅샷 */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 mb-4">
            {/* 추천 의견 */}
            <div className={`rounded-2xl p-6 border shadow-xl ${cfg.bg} ${cfg.border} ${cfg.glow}`}>
              <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase mb-3">AI 추천 의견</p>
              <div className="flex items-center gap-4 mb-4">
                <span className={`text-4xl font-black ${cfg.color}`}>{cfg.icon}</span>
                <span className={`text-3xl font-black ${cfg.color}`}>{result.recommendation}</span>
              </div>
              <p className="text-[14px] text-slate-300 leading-relaxed">{result.summary}</p>
            </div>
            {/* 수익 스냅샷 */}
            <div className="grid grid-cols-1 gap-3 w-full md:w-52">
              <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl px-5 py-4">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">현재가</p>
                <p className="text-xl font-bold text-white font-mono">{fmt(result.currentPrice)}원</p>
              </div>
              <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl px-5 py-4">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">수익률</p>
                <p className={`text-xl font-bold font-mono ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
                  {fmtRate(result.profitRate)}
                </p>
              </div>
              <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl px-5 py-4">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">평가손익</p>
                <p className={`text-lg font-bold font-mono ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
                  {result.profitAmount > 0 ? '+' : ''}{fmt(result.profitAmount)}원
                </p>
              </div>
            </div>
          </div>

          {/* 2행: 목표가 / 손절가 */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <ResultCard title="Target Price">
              <p className="text-2xl font-bold text-emerald-300 font-mono">{fmt(result.targetPrice)}원</p>
              <p className="text-[12px] text-slate-500 mt-1">
                현재가 대비 {((result.targetPrice - result.currentPrice) / result.currentPrice * 100) >= 0 ? '+' : ''}
                {((result.targetPrice - result.currentPrice) / result.currentPrice * 100).toFixed(1)}%
              </p>
            </ResultCard>
            <ResultCard title="Stop Loss">
              <p className="text-2xl font-bold text-red-300 font-mono">{fmt(result.stopLoss)}원</p>
              <p className="text-[12px] text-slate-500 mt-1">
                현재가 대비 {((result.stopLoss - result.currentPrice) / result.currentPrice * 100).toFixed(1)}%
              </p>
            </ResultCard>
          </div>

          {/* 3행: 추천 이유 / 기술적 분석 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <ResultCard title="추천 이유">
              <p className="text-[13px] text-slate-300 leading-relaxed whitespace-pre-line">{result.reason}</p>
            </ResultCard>
            <ResultCard title="기술적 분석">
              <p className="text-[13px] text-slate-300 leading-relaxed">{result.technical}</p>
            </ResultCard>
          </div>

          {/* 4행: 수급 동향 / 리스크·기회 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <ResultCard title="수급 동향">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">기관</p>
                  <p className="text-[13px] text-slate-300 leading-relaxed">{result.institutional}</p>
                </div>
                <div className="border-t border-slate-700/50 pt-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">외국인</p>
                  <p className="text-[13px] text-slate-300 leading-relaxed">{result.foreign}</p>
                </div>
              </div>
            </ResultCard>
            <div className="flex flex-col gap-4">
              <ResultCard title="⚠️ 리스크 요인">
                <p className="text-[13px] text-slate-300 leading-relaxed">{result.risk}</p>
              </ResultCard>
              <ResultCard title="💡 기회 요인">
                <p className="text-[13px] text-slate-300 leading-relaxed">{result.opportunity}</p>
              </ResultCard>
            </div>
          </div>

          {/* 5행: 뉴스 */}
          {result.news?.length > 0 && (
            <ResultCard title="뉴스 동향" className="mb-4">
              <div className="flex flex-col divide-y divide-slate-700/50">
                {result.news.map((n, i) => (
                  <div key={i} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-[13px] font-medium text-white leading-snug">{n.title}</p>
                    {n.description && (
                      <p className="text-[12px] text-slate-500 mt-1 leading-relaxed line-clamp-2">{n.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </ResultCard>
          )}

          {/* 면책 */}
          <p className="text-[11px] text-slate-600 text-center leading-relaxed mb-6">
            본 분석은 AI가 공개 정보를 바탕으로 생성한 참고 자료입니다. 투자 판단의 책임은 본인에게 있습니다.
          </p>

          {/* 다시 진단받기 */}
          <button
            onClick={handleReset}
            className="flex items-center gap-2 mx-auto px-6 py-3 rounded-xl
              bg-slate-800 hover:bg-slate-700 border border-slate-700
              text-slate-300 text-[14px] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" /> 다시 종목진단 받기
          </button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW 1: 입력 폼
  // ══════════════════════════════════════════════════════════════════════════
  const isDisabled = remaining === 0;

  return (
    <div className="min-h-screen bg-[#0d1117] pb-16">
      <div className="max-w-5xl mx-auto px-4 pt-8">

        {/* 페이지 제목 */}
        <div className="mb-8">
          <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-2">AI Portfolio Analysis</p>
          <h1 className="text-2xl font-bold text-white">종목 진단</h1>
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
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">종목</label>
              <div className="relative flex items-center">
                <Search className="absolute left-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setTicker(''); setStockName(''); }}
                  onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                  placeholder="종목명 또는 코드 검색"
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
                ✦ START AI DIAGNOSIS
              </button>

              <p className="text-center text-[11px] text-slate-600 mt-2">
                {isDisabled
                  ? '오늘 무료 진단을 이미 사용했습니다. 내일 다시 이용해주세요.'
                  : '하루 1회 무료 · 매일 자정 초기화'}
              </p>
            </div>
          </form>

          {/* ── 우측 사이드바 ── */}
          <div className="flex flex-col gap-4">

            {/* WATCHLIST */}
            <SideCard title="Watchlist">
              {watchlist.length === 0 ? (
                <p className="text-[12px] text-slate-600">관심종목이 없습니다</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {watchlist.map(item => (
                    <button
                      key={item.ticker} type="button"
                      onClick={() => selectStock(item.ticker, item.name)}
                      className="flex items-center justify-between py-2 hover:bg-slate-700/30
                        rounded-lg px-1 transition-colors group w-full"
                    >
                      <div className="text-left">
                        <p className="text-[13px] font-medium text-white group-hover:text-indigo-300 transition-colors truncate max-w-[120px]">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-slate-600 font-mono">{item.ticker}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] font-mono text-white">{fmt(item.price)}</p>
                        <p className={`text-[11px] font-mono ${item.changeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                          {fmtRate(item.changeRate)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </SideCard>

            {/* MARKET TREND */}
            <SideCard title="Market Trend">
              {kospi ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[12px] text-white font-semibold">KOSPI</p>
                    <p className="text-lg font-bold font-mono text-white">{fmt(Math.round(kospi.value))}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {kospi.changeRate >= 0
                      ? <TrendingUp className="w-5 h-5 text-red-400" />
                      : <TrendingDown className="w-5 h-5 text-blue-400" />
                    }
                    <p className={`text-[13px] font-mono font-bold ${kospi.changeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {fmtRate(kospi.changeRate)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-600">
                  <Minus className="w-4 h-4" />
                  <span className="text-[12px]">장 마감 시간</span>
                </div>
              )}
            </SideCard>

            {/* RISK ALERT */}
            <SideCard title="Risk Alert">
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <span className="text-amber-400 text-[11px] mt-0.5 shrink-0">●</span>
                  <p className="text-[12px] text-slate-400 leading-relaxed">
                    AI 분석은 참고 자료입니다. 투자 결정 전 반드시 직접 검토하세요.
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-400 text-[11px] mt-0.5 shrink-0">●</span>
                  <p className="text-[12px] text-slate-400 leading-relaxed">
                    과거 수익률이 미래 수익을 보장하지 않습니다.
                  </p>
                </div>
              </div>
            </SideCard>

          </div>
        </div>
      </div>
    </div>
  );
}
