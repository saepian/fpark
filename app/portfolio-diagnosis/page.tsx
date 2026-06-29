'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import {
  Sparkles, Plus, Trash2, Search, ChevronLeft,
  Share2, Printer, TrendingUp, TrendingDown, BookMarked, Lock,
} from 'lucide-react';
import DiagnosisSidebar from '@/components/diagnosis/DiagnosisSidebar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchItem { ticker: string; name: string }

interface HoldingInput {
  id:           string;
  ticker:       string;
  name:         string;
  avgPrice:     string;
  quantity:     string;
  buyDate:      string;
  _q:           string;
  _results:     SearchItem[];
  _open:        boolean;
}

interface Sector {
  name:    string;
  tickers: string[];
  weight:  number;
  warning: boolean;
}

interface HoldingResult {
  ticker:       string;
  name:         string;
  currentPrice: number;
  avgPrice:     number;
  quantity:     number;
  value:        number;
  invested:     number;
  profit:       number;
  profitRate:   number;
  action:       '매수' | '보유' | '분할매도' | '전량매도';
  reason:       string;
  sector:       string;
}

interface PortfolioResult {
  totalInvested:    number;
  totalValue:       number;
  totalProfit:      number;
  totalProfitRate:  number;
  summary:          string;
  sectors:          Sector[];
  holdings:         HoldingResult[];
  suggestions:      string[];
}

interface WatchItem { ticker: string; name: string; price: number; changeRate: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_CFG: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  '매수':    { color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: '▲' },
  '보유':    { color: 'text-blue-300',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    icon: '◆' },
  '분할매도': { color: 'text-orange-300',  bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  icon: '▽' },
  '전량매도': { color: 'text-red-300',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     icon: '▼' },
};

const SECTOR_COLORS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500',
  'bg-amber-500',  'bg-pink-500',   'bg-teal-500', 'bg-orange-500',
];

function fmt(n: number)  { return n.toLocaleString(); }
function fmtR(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }
function uid()           { return Math.random().toString(36).slice(2, 9); }

function emptyHolding(): HoldingInput {
  return { id: uid(), ticker: '', name: '', avgPrice: '', quantity: '', buyDate: '', _q: '', _results: [], _open: false };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      {title && <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">{title}</p>}
      {children}
    </div>
  );
}

function MetricCard({ label, value, sub, up }: { label: string; value: string; sub?: string; up?: boolean }) {
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-4">
      <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${up === undefined ? 'text-white' : up ? 'text-red-400' : 'text-blue-400'}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PortfolioDiagnosisPage() {
  const router  = useRouter();
  const supabase = createClient();

  // auth / plan
  const [authChecked,      setAuthChecked]      = useState(false);
  const [isPro,            setIsPro]            = useState(false);
  const [remaining,        setRemaining]        = useState<number | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // holdings form
  const [holdings,     setHoldings]     = useState<HoldingInput[]>([emptyHolding()]);
  const [watchlist,    setWatchlist]    = useState<WatchItem[]>([]);
  const [showWatchPop, setShowWatchPop] = useState(false);
  const watchBtnRef = useRef<HTMLButtonElement>(null);

  // submit
  const [loading,     setLoading]     = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error,       setError]       = useState('');
  const [result,      setResult]      = useState<PortfolioResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');

  // debounce timers
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace('/auth/login'); return; }
      setAuthChecked(true);
      fetch('/api/portfolio-diagnosis')
        .then(r => r.json())
        .then(d => { setIsPro(d.isPro); setRemaining(d.remaining ?? 0); })
        .catch(() => {});
      fetch('/api/watchlist')
        .then(r => r.json())
        .then(d => { if (Array.isArray(d)) setWatchlist(d.filter(i => !i.market || i.market === 'kr')); })
        .catch(() => {});
    });
  }, []); // eslint-disable-line

  // 로딩 단계 자동 진행
  const PORT_LOADING_STEPS = ['종목 데이터 조회 중...', '수급 데이터 조회 중...', '재무 데이터 조회 중...', '뉴스 수집 중...', 'AI 분석 중...'];
  useEffect(() => {
    if (!loading) { setLoadingStep(0); return; }
    const timers2 = [
      setTimeout(() => setLoadingStep(1), 3000),
      setTimeout(() => setLoadingStep(2), 7000),
      setTimeout(() => setLoadingStep(3), 11000),
      setTimeout(() => setLoadingStep(4), 15000),
    ];
    return () => timers2.forEach(clearTimeout);
  }, [loading]);

  // close watch popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (watchBtnRef.current && !watchBtnRef.current.parentElement?.contains(e.target as Node)) {
        setShowWatchPop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Holding helpers ───────────────────────────────────────────────────────

  const updateHolding = useCallback((id: string, patch: Partial<HoldingInput>) => {
    setHoldings(prev => prev.map(h => h.id === id ? { ...h, ...patch } : h));
  }, []);

  const searchStock = useCallback((id: string, q: string) => {
    updateHolding(id, { _q: q, ticker: '', name: '' });
    clearTimeout(timers.current[id]);
    if (!q.trim()) { updateHolding(id, { _results: [], _open: false }); return; }
    timers.current[id] = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        const items: SearchItem[] = Array.isArray(data)
          ? data.filter((s: { isOverseas?: boolean }) => !s.isOverseas).slice(0, 6)
          : [];
        updateHolding(id, { _results: items, _open: items.length > 0 });
      } catch { /* noop */ }
    }, 200);
  }, [updateHolding]);

  const selectStock = useCallback((id: string, ticker: string, name: string) => {
    updateHolding(id, { ticker, name, _q: name, _results: [], _open: false });
  }, [updateHolding]);

  const addHolding = () => {
    if (holdings.length >= 10) return;
    setHoldings(prev => [...prev, emptyHolding()]);
  };

  const removeHolding = (id: string) => {
    setHoldings(prev => prev.length <= 1 ? prev : prev.filter(h => h.id !== id));
  };

  const importFromWatchlist = (item: WatchItem) => {
    const already = holdings.some(h => h.ticker === item.ticker);
    if (already || holdings.length >= 10) return;
    const filled = holdings.find(h => !h.ticker);
    if (filled) {
      updateHolding(filled.id, { ticker: item.ticker, name: item.name, _q: item.name });
    } else {
      setHoldings(prev => [...prev, { ...emptyHolding(), ticker: item.ticker, name: item.name, _q: item.name }]);
    }
    setShowWatchPop(false);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!isPro) { setShowUpgradeModal(true); return; }
    if (remaining === 0) { setError('이번 달 사용 한도(30회)를 초과했습니다.'); return; }

    const valid = holdings.filter(h => h.ticker && h.avgPrice && h.quantity);
    if (valid.length === 0) { setError('종목·매수가·수량을 하나 이상 입력해주세요.'); return; }

    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio-diagnosis', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdings: valid.map(h => ({
            ticker:   h.ticker,
            name:     h.name,
            avgPrice: parseInt(h.avgPrice.replace(/,/g, ''), 10),
            quantity: parseInt(h.quantity, 10),
            buyDate:  h.buyDate || undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'PRO_REQUIRED') { setShowUpgradeModal(true); return; }
        setError(data.error || '분석 실패');
        return;
      }
      setResult(data);
      setGeneratedAt(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
      setRemaining(prev => Math.max(0, (prev ?? 1) - 1));
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // ── Auth loading ──────────────────────────────────────────────────────────

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Loading overlay ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-8">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
          <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-emerald-400 animate-spin"
            style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
        </div>
        <div className="text-center mb-2">
          <p className="text-white font-semibold text-lg mb-1">AI가 포트폴리오를 분석하고 있습니다...</p>
          <p className="text-slate-400 text-sm">예상 소요 시간: 20~40초</p>
        </div>
        <div className="flex flex-col gap-3 min-w-[240px]">
          {PORT_LOADING_STEPS.map((step, i) => (
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

  // ── Upgrade modal ─────────────────────────────────────────────────────────

  const UpgradeModal = () => (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1f2e] border border-indigo-500/30 rounded-2xl p-8 max-w-sm w-full shadow-2xl">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
            <Lock className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-widest text-indigo-400 uppercase mb-1">Pro 전용 기능</p>
            <h2 className="text-xl font-bold text-white">포트폴리오 전체 진단</h2>
          </div>
          <div className="flex flex-col gap-2 text-left w-full">
            {[
              '최대 10종목 동시 분석',
              '섹터 편중도 자동 계산',
              '종목별 AI 매매 액션',
              '포트폴리오 개선 제안',
              '월 30회 사용 가능',
            ].map(f => (
              <div key={f} className="flex items-center gap-2">
                <span className="text-emerald-400 text-xs">✓</span>
                <span className="text-[13px] text-slate-300">{f}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowUpgradeModal(false)}
            className="w-full py-3 rounded-xl text-[13px] font-semibold
              bg-gradient-to-r from-indigo-600 to-violet-600
              hover:from-indigo-500 hover:to-violet-500
              text-white transition-all cursor-pointer"
          >
            Pro 업그레이드 (준비 중)
          </button>
          <button
            onClick={() => setShowUpgradeModal(false)}
            className="text-[12px] text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // RESULT VIEW
  // ════════════════════════════════════════════════════════════════════════════

  if (result) {
    const isUp = result.totalProfitRate >= 0;
    const sortedSectors = [...result.sectors].sort((a, b) => b.weight - a.weight);

    return (
      <div className="min-h-screen bg-[#0d1117] pb-16">
        {showUpgradeModal && <UpgradeModal />}
        <div className="max-w-5xl mx-auto px-4 pt-8">

          {/* Header */}
          <div className="flex items-start justify-between mb-6 gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">
                AI 포트폴리오 진단 리포트
              </p>
              <h1 className="text-[22px] font-bold text-white">Portfolio Analysis</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">리포트 생성: {generatedAt}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 mt-1">
              <button
                onClick={() => alert('준비 중입니다.')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700
                  border border-slate-700 text-slate-400 text-[11px] font-semibold tracking-wide transition-colors cursor-pointer"
              >
                <Share2 className="w-3 h-3" /> SHARE
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30
                  border border-indigo-500/40 text-indigo-300 text-[11px] font-semibold tracking-wide transition-colors cursor-pointer"
              >
                <Printer className="w-3 h-3" /> PRINT REPORT
              </button>
            </div>
          </div>

          {/* 1행: 총 수익률 현황 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <MetricCard
              label="총 투자금"
              value={`${fmt(result.totalInvested)}원`}
            />
            <MetricCard
              label="평가금액"
              value={`${fmt(result.totalValue)}원`}
            />
            <MetricCard
              label="총 손익"
              value={`${result.totalProfit >= 0 ? '+' : ''}${fmt(result.totalProfit)}원`}
              up={isUp}
            />
            <MetricCard
              label="수익률"
              value={fmtR(result.totalProfitRate)}
              sub={`${result.holdings.length}개 종목`}
              up={isUp}
            />
          </div>

          {/* 2행: AI 요약 */}
          <div
            className="rounded-2xl border border-indigo-500/25 overflow-hidden mb-4"
            style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}
          >
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <p className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-widest">AI 종합 평가</p>
              </div>
              <p className="text-[14px] text-slate-300 leading-relaxed">{result.summary}</p>
            </div>
          </div>

          {/* 3행: 섹터 편중도 */}
          <Card title="섹터 편중도 분석" className="mb-4">
            <div className="flex flex-col gap-3">
              {sortedSectors.map((s, i) => (
                <div key={s.name}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${SECTOR_COLORS[i % SECTOR_COLORS.length]}`} />
                      <span className="text-[13px] text-slate-300 font-medium">{s.name}</span>
                      {s.warning && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 font-semibold">
                          과집중
                        </span>
                      )}
                    </div>
                    <span className="text-[13px] font-mono text-slate-400">{s.weight}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        s.warning
                          ? 'bg-red-500'
                          : SECTOR_COLORS[i % SECTOR_COLORS.length].replace('bg-', 'bg-')
                      }`}
                      style={{ width: `${s.weight}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* 4행: 종목별 AI 액션 */}
          <Card title="종목별 AI 액션" className="mb-4">
            <div className="flex flex-col divide-y divide-slate-700/40">
              {result.holdings.map(h => {
                const cfg = ACTION_CFG[h.action] ?? ACTION_CFG['보유'];
                const hUp = h.profitRate >= 0;
                return (
                  <div key={h.ticker} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3 flex-wrap md:flex-nowrap">
                      {/* 종목 */}
                      <div className="w-full md:w-40 shrink-0">
                        <p className="text-[14px] font-semibold text-white leading-tight">{h.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono">{h.ticker} · {h.sector}</p>
                      </div>
                      {/* 수치 */}
                      <div className="flex gap-4 shrink-0 text-right md:text-left">
                        <div>
                          <p className="text-[10px] text-slate-600 mb-0.5">현재가</p>
                          <p className="text-[13px] font-mono text-slate-300">{fmt(h.currentPrice)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-600 mb-0.5">수익률</p>
                          <p className={`text-[13px] font-mono font-semibold ${hUp ? 'text-red-400' : 'text-blue-400'}`}>
                            {fmtR(h.profitRate)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-600 mb-0.5">평가금액</p>
                          <p className="text-[13px] font-mono text-slate-300">{fmt(h.value)}</p>
                        </div>
                      </div>
                      {/* 액션 */}
                      <div className="shrink-0 ml-auto flex flex-col items-end gap-1">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-bold ${cfg.color} ${cfg.bg} border ${cfg.border}`}>
                          {cfg.icon} {h.action}
                        </span>
                      </div>
                    </div>
                    {h.reason && (
                      <p className="mt-2 text-[12px] text-slate-500 leading-relaxed pl-0 md:pl-44">{h.reason}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 5행: 포트폴리오 개선 제안 */}
          <Card title="포트폴리오 개선 제안" className="mb-4">
            <div className="flex flex-col gap-3">
              {result.suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-3 bg-slate-800/40 rounded-xl px-4 py-3">
                  <span className="text-indigo-400 text-[10px] mt-0.5 shrink-0 font-bold">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="text-[13px] text-slate-300 leading-relaxed">{s}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* 면책 */}
          <p className="text-[11px] text-slate-600 text-center leading-relaxed mb-6 px-4">
            본 분석은 AI가 공개 정보를 바탕으로 생성한 참고 자료입니다. 투자 판단의 책임은 본인에게 있습니다.
          </p>

          <button
            onClick={() => setResult(null)}
            className="flex items-center gap-2 mx-auto px-6 py-3 rounded-xl
              bg-slate-800 hover:bg-slate-700 border border-slate-700
              text-slate-300 text-[13px] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" /> 다시 진단받기
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INPUT FORM VIEW
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-[#0d1117] pb-16">
      {showUpgradeModal && <UpgradeModal />}

      <div className="max-w-5xl mx-auto px-4 pt-8">

        {/* 헤더 */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-2">
              AI Portfolio Analysis · Pro
            </p>
            <h1 className="text-2xl font-bold text-white">포트폴리오 전체 진단</h1>
            <p className="text-[13px] text-slate-500 mt-1">여러 종목을 한번에 입력하고 AI가 전체 포트폴리오를 종합 진단합니다.</p>
          </div>
          {/* 잔여 횟수 */}
          <div className="flex items-center gap-2 bg-[#1a1f2e] border border-slate-700/50 rounded-xl px-4 py-2.5 shrink-0">
            {isPro ? (
              <>
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-[12px] text-slate-400">이번 달 잔여</span>
                <span className="text-[14px] font-bold text-white">{remaining}회</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-[12px] text-slate-500">Pro 전용</span>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        <div>
        {/* 폼 영역 */}
        <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-6 mb-4">
          {/* 섹션 헤더 */}
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-700/50 gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="text-[11px] font-bold tracking-[0.2em] text-slate-400 uppercase">
                Holdings  <span className="text-slate-600">({holdings.filter(h => h.ticker).length}/{holdings.length})</span>
              </span>
            </div>
            {/* 워치리스트 불러오기 */}
            <div className="relative">
              <button
                ref={watchBtnRef}
                type="button"
                onClick={() => setShowWatchPop(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold
                  bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                <BookMarked className="w-3 h-3" /> 워치리스트에서 불러오기
              </button>
              {showWatchPop && (
                <div className="absolute right-0 top-full mt-1 w-64
                  bg-[#1a1f2e] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                  {watchlist.length === 0 ? (
                    <div className="px-4 py-3 text-[12px] text-slate-500">관심종목이 없습니다</div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto">
                      {watchlist.map(item => {
                        const already = holdings.some(h => h.ticker === item.ticker);
                        return (
                          <button
                            key={item.ticker} type="button"
                            disabled={already || holdings.length >= 10}
                            onClick={() => importFromWatchlist(item)}
                            className={`flex items-center justify-between w-full px-4 py-2.5 transition-colors
                              ${already || holdings.length >= 10
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-slate-700/40 cursor-pointer'}`}
                          >
                            <span className="text-[13px] text-white">{item.name}</span>
                            <span className="text-[11px] text-slate-500 font-mono">{item.ticker}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 종목 입력 행들 */}
          <div className="flex flex-col gap-3">
            {holdings.map((h, idx) => (
              <HoldingRow
                key={h.id}
                h={h}
                idx={idx}
                onSearch={q => searchStock(h.id, q)}
                onSelect={(t, n) => selectStock(h.id, t, n)}
                onBlurSearch={() => setTimeout(() => updateHolding(h.id, { _open: false }), 150)}
                onChange={patch => updateHolding(h.id, patch)}
                onRemove={() => removeHolding(h.id)}
                canRemove={holdings.length > 1}
              />
            ))}
          </div>

          {/* 종목 추가 버튼 */}
          {holdings.length < 10 && (
            <button
              type="button"
              onClick={addHolding}
              className="mt-3 w-full py-3 rounded-xl border border-dashed border-slate-700
                text-slate-500 hover:text-slate-300 hover:border-slate-500
                text-[13px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" /> 종목 추가 (최대 10개)
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 mb-4">
            <span className="text-red-400 text-[13px]">{error}</span>
          </div>
        )}

        {/* 진단 버튼 */}
        <button
          type="button"
          onClick={handleSubmit}
          className={`w-full relative py-4 rounded-xl font-bold text-[15px] transition-all
            flex items-center justify-center gap-2 overflow-hidden
            ${!isPro || remaining === 0
              ? 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
              : 'text-white cursor-pointer hover:opacity-90 active:scale-[0.99]'
            }`}
          style={!isPro || remaining === 0 ? {} : {
            background: 'linear-gradient(135deg, #4f46e5 0%, #0ea5e9 50%, #10b981 100%)',
            boxShadow:  '0 0 30px rgba(79,70,229,0.3)',
          }}
        >
          {isPro && remaining !== 0 && (
            <span className="absolute inset-0 bg-white/0 hover:bg-white/5 transition-colors rounded-xl" />
          )}
          {!isPro ? <Lock className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
          {!isPro ? 'Pro 전용 기능 — 업그레이드 필요' : '✦ START AI DIAGNOSIS'}
        </button>
        <p className="text-center text-[11px] text-slate-600 mt-2">
          {!isPro
            ? 'Pro 플랜으로 업그레이드하면 포트폴리오 전체 진단을 이용할 수 있습니다.'
            : `월 30회 · 이번 달 ${remaining ?? 0}회 남음`}
        </p>
        </div>{/* ← 좌측 컬럼 닫기 */}

        {/* ── 우측 사이드바 (모바일 숨김) ── */}
        <div className="hidden lg:block">
          <DiagnosisSidebar
            watchlist={watchlist}
            onSelectStock={(ticker, name) =>
              importFromWatchlist({ ticker, name, price: 0, changeRate: 0 })
            }
          />
        </div>
        </div>{/* ← 그리드 닫기 */}
      </div>
    </div>
  );
}

// ── HoldingRow (인라인 컴포넌트) ───────────────────────────────────────────────

interface HoldingRowProps {
  h:             HoldingInput;
  idx:           number;
  onSearch:      (q: string) => void;
  onSelect:      (ticker: string, name: string) => void;
  onBlurSearch:  () => void;
  onChange:      (patch: Partial<HoldingInput>) => void;
  onRemove:      () => void;
  canRemove:     boolean;
}

function HoldingRow({ h, idx, onSearch, onSelect, onBlurSearch, onChange, onRemove, canRemove }: HoldingRowProps) {
  return (
    <div className="bg-[#0d1117] border border-slate-700/50 rounded-xl p-4">
      {/* 행 번호 + 삭제 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold text-slate-600">#{String(idx + 1).padStart(2, '0')}</span>
        {canRemove && (
          <button
            type="button" onClick={onRemove}
            className="text-slate-600 hover:text-red-400 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-3 items-start">
        {/* 종목 검색 */}
        <div className="relative">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input
              value={h._q}
              onChange={e => onSearch(e.target.value)}
              onFocus={() => h._results.length > 0 && onChange({ _open: true })}
              onBlur={onBlurSearch}
              placeholder="종목명 또는 코드"
              className="w-full bg-[#1a1f2e] border border-slate-700 rounded-lg pl-9 pr-3 py-2.5
                text-[13px] text-white placeholder-slate-600
                focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
            />
            {h.ticker && (
              <span className="absolute right-2.5 text-[10px] text-indigo-400 font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded">
                {h.ticker}
              </span>
            )}
          </div>
          {h._open && h._results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1f2e] border border-slate-700
              rounded-xl shadow-2xl z-50 overflow-hidden">
              {h._results.map(s => (
                <button
                  key={s.ticker} type="button"
                  onMouseDown={() => onSelect(s.ticker, s.name)}
                  className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-slate-700/40 transition-colors"
                >
                  <span className="text-[13px] text-white">{s.name}</span>
                  <span className="text-[11px] text-slate-500 font-mono">{s.ticker}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 매수가 */}
        <input
          value={h.avgPrice}
          onChange={e => onChange({ avgPrice: e.target.value.replace(/[^0-9,]/g, '') })}
          placeholder="매수가 (KRW)"
          className="w-full sm:w-32 bg-[#1a1f2e] border border-slate-700 rounded-lg px-3 py-2.5
            text-[13px] text-white placeholder-slate-600
            focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
        />

        {/* 수량 */}
        <input
          value={h.quantity}
          onChange={e => onChange({ quantity: e.target.value.replace(/[^0-9]/g, '') })}
          placeholder="수량 (주)"
          className="w-full sm:w-24 bg-[#1a1f2e] border border-slate-700 rounded-lg px-3 py-2.5
            text-[13px] text-white placeholder-slate-600
            focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
        />

        {/* 매수일 */}
        <input
          type="date"
          value={h.buyDate}
          onChange={e => onChange({ buyDate: e.target.value })}
          className="w-full sm:w-36 bg-[#1a1f2e] border border-slate-700 rounded-lg px-3 py-2.5
            text-[13px] text-white
            focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all
            [color-scheme:dark]"
        />
      </div>
    </div>
  );
}
