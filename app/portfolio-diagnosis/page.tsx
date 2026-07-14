'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import {
  Sparkles, Plus, Trash2, Search, ChevronLeft,
  Printer, TrendingUp, TrendingDown, BookMarked, Lock, RefreshCw,
} from 'lucide-react';
import DiagnosisSidebar from '@/components/diagnosis/DiagnosisSidebar';
import ShareDropdown from '@/components/ShareDropdown';
import PageBackground from '@/components/layout/PageBackground';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';

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
  signal:       '순유입 우위' | '중립·관망' | '차익실현 관찰' | '순유출 우위';
  reason:       string;
  sector:       string;
  newsBasis?:   'news' | 'estimated';
  news?:        { title: string; summary?: string; url?: string }[];
  mdd?:         number | null;
  volatility?:  number | null;
  todayContribution?: number | null; // 오늘 손익 기여도(원)
  isCached?:    boolean; // 휴장일 등 실시간 조회 실패 시 마지막 거래일 기준 값
  cachedAt?:    string;
}

interface HoldingPeriodEntry { ticker: string; name: string; holdDays: number; profitRate: number }

interface PortfolioHistory {
  daysSince: number | null; // null = 첫 포트폴리오 진단
  prevDate?: string;
  prevTotalProfitRate?: number | null;
  prevTotalProfit?:     number | null;
  compositionChanged: boolean;
  addedTickers:   { ticker: string; name: string }[];
  removedTickers: { ticker: string; name: string }[];
  narrative: string;
}

interface PortfolioResult {
  totalInvested:    number;
  totalValue:       number;
  totalProfit:      number;
  totalProfitRate:  number;
  summary:          string;
  sectors:          Sector[];
  holdings:         HoldingResult[];
  riskFactors?:        string[];
  opportunityFactors?: string[];
  shortTermOutlook?:   string;
  midTermOutlook?:     string;
  benchmark?: {
    portfolioProfitRate: number;
    kospiChangeRate: number;
    fromDate: string;
    toDate: string;
  } | null;
  history: PortfolioHistory;
  topContributors: {
    n: number;
    positive: { ticker: string; name: string; amount: number }[];
    negative: { ticker: string; name: string; amount: number }[];
  };
  contributionNarrative: string;
  coMovementText: string | null;
  coMovementNarrative: string;
  holdingPeriod: {
    longest: HoldingPeriodEntry | null;
    mostRecent: HoldingPeriodEntry | null;
    narrative: string;
  };
}

interface WatchItem { ticker: string; name: string; price: number; changeRate: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTOR_COLORS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500',
  'bg-amber-500',  'bg-pink-500',   'bg-teal-500', 'bg-orange-500',
];

const SECTOR_HEX = [
  '#6366f1', '#8b5cf6', '#0ea5e9', '#10b981',
  '#f59e0b', '#ec4899', '#14b8a6', '#f97316',
];

function fmt(n: number)  { return n.toLocaleString(); }
function fmtR(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }
function uid()           { return Math.random().toString(36).slice(2, 9); }

function emptyHolding(): HoldingInput {
  return { id: uid(), ticker: '', name: '', avgPrice: '', quantity: '', buyDate: '', _q: '', _results: [], _open: false };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Card({ title, children, className = '', ...rest }: { title?: string; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`} {...rest}>
      {title && <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">{title}</p>}
      {children}
    </div>
  );
}

function MetricCard({ label, value, sub, up, highlight }: {
  label: string; value: string; sub?: string; up?: boolean; highlight?: boolean;
}) {
  const bgStyle = highlight && up !== undefined
    ? up
      ? { background: 'rgba(34, 197, 94, 0.15)', borderColor: 'rgba(34, 197, 94, 0.4)' }
      : { background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)' }
    : {};
  return (
    <div className="border rounded-2xl p-4" style={{ background: '#1a1f2e', borderColor: '#334155', ...bgStyle }}>
      <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${up === undefined ? 'text-white' : up ? 'text-red-400' : 'text-blue-400'}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatDelta({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[13px] font-bold font-mono ${positive ? 'text-red-400' : 'text-blue-400'}`}>{value}</span>
    </div>
  );
}

// "직전 진단 대비" 카드 — components/diagnosis/DiagnosisReport.tsx의 HistoryCompareCard와
// 동일한 시각 언어 재사용. 델타 수치는 서버가 계산해 넘긴 값을 그대로 표시.
function PortfolioHistoryCard({ result }: { result: PortfolioResult }) {
  const h = result.history;
  const isFirst = h.daysSince === null;
  const label = isFirst
    ? '🔄 첫 포트폴리오 진단'
    : h.daysSince === 1
      ? '🔄 어제 대비'
      : h.daysSince! <= 6
        ? `🔄 ${h.daysSince}일 전 진단 대비`
        : '🔄 오랜만에 재조회';

  const rateDelta   = !isFirst && typeof h.prevTotalProfitRate === 'number' ? result.totalProfitRate - h.prevTotalProfitRate : null;
  const amountDelta = !isFirst && !h.compositionChanged && typeof h.prevTotalProfit === 'number' ? result.totalProfit - h.prevTotalProfit : null;

  return (
    <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-2xl px-5 py-4 mb-4">
      <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-wide mb-2">{label}</p>
      {!isFirst && (
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 mb-2.5">
          {rateDelta !== null && (
            <StatDelta label="총 수익률" value={`${rateDelta >= 0 ? '+' : ''}${rateDelta.toFixed(2)}%p`} positive={rateDelta >= 0} />
          )}
          {amountDelta !== null && (
            <StatDelta label="총 평가손익" value={`${amountDelta >= 0 ? '+' : ''}${fmt(Math.round(amountDelta))}원`} positive={amountDelta >= 0} />
          )}
          {h.compositionChanged && (
            <span className="text-[11px] text-amber-500/80">
              보유 종목 변경
              {h.addedTickers.length > 0 && ` · 추가: ${h.addedTickers.map(t => t.name).join(', ')}`}
              {h.removedTickers.length > 0 && ` · 제거: ${h.removedTickers.map(t => t.name).join(', ')}`}
            </span>
          )}
        </div>
      )}
      <p className="text-[13px] text-slate-300 leading-relaxed">{h.narrative}</p>
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
  const [isBasic,          setIsBasic]          = useState(false);
  const [remaining,        setRemaining]        = useState<number | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // holdings form
  const [holdings,     setHoldings]     = useState<HoldingInput[]>([emptyHolding()]);
  const [watchlist,    setWatchlist]    = useState<WatchItem[]>([]);
  const [showWatchPop, setShowWatchPop] = useState(false);
  const [watchChecked, setWatchChecked] = useState<Set<string>>(new Set());
  const watchBtnRef = useRef<HTMLButtonElement>(null);

  // submit
  const [loading,             setLoading]             = useState(false);
  const [loadingLabel,        setLoadingLabel]        = useState('');
  const [loadingStep,         setLoadingStep]         = useState(0);
  const [error,               setError]               = useState('');
  const [result,      setResult]      = useState<PortfolioResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');

  // debounce timers
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace(loginUrlWithRedirect(window.location.pathname + window.location.search)); return; }
      setAuthChecked(true);
      fetch('/api/portfolio-diagnosis')
        .then(r => r.json())
        .then(d => { setIsPro(d.isPro); setIsBasic(d.isBasic ?? false); setRemaining(d.remaining ?? 0); })
        .catch(() => {});
      fetch('/api/watchlist')
        .then(r => r.json())
        .then(d => { if (Array.isArray(d)) setWatchlist(d.filter(i => !i.market || i.market === 'kr')); })
        .catch(() => {});
    });
  }, []); // eslint-disable-line

  // 로딩 단계 순차 표시 — 2초 간격 타이머 (SSE와 무관하게 순서대로 진행)
  const PORT_LOADING_STEPS = ['종목 데이터 조회 중...', '뉴스 수집 중...', '수급 데이터 조회 중...', '재무 데이터 조회 중...', 'AI 분석 중...'];
  useEffect(() => {
    if (!loading) { setLoadingStep(0); return; }
    setLoadingStep(0);
    const t = [
      setTimeout(() => setLoadingStep(1), 2000),
      setTimeout(() => setLoadingStep(2), 4000),
      setTimeout(() => setLoadingStep(3), 6000),
      setTimeout(() => setLoadingStep(4), 8000),
    ];
    return () => t.forEach(clearTimeout);
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

  const applyWatchlistSelection = () => {
    const toAdd = watchlist.filter(w => watchChecked.has(w.ticker) && !holdings.some(h => h.ticker === w.ticker));
    setHoldings(prev => {
      let updated = [...prev];
      for (const item of toAdd) {
        if (updated.filter(h => h.ticker).length >= 10) break;
        const emptySlot = updated.find(h => !h.ticker);
        if (emptySlot) {
          updated = updated.map(h => h.id === emptySlot.id
            ? { ...h, ticker: item.ticker, name: item.name, _q: item.name }
            : h
          );
        } else if (updated.length < 10) {
          updated = [...updated, { ...emptyHolding(), ticker: item.ticker, name: item.name, _q: item.name }];
        }
      }
      return updated;
    });
    setWatchChecked(new Set());
    setShowWatchPop(false);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!isPro && !isBasic) { setShowUpgradeModal(true); return; }
    if (remaining === 0) { setError('이번 달 사용 한도를 초과했습니다.'); return; }

    const valid = holdings.filter(h => h.ticker && h.avgPrice && h.quantity);
    if (valid.length === 0) { setError('기업·매입가·수량을 하나 이상 입력해주세요.'); return; }

    setError('');
    setLoading(true);
    setLoadingLabel('분석 준비 중...');

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

      // 인증·검증 에러는 JSON으로 반환
      if (!res.ok) {
        const data = await res.json();
        if (data.error === 'PRO_REQUIRED') { setShowUpgradeModal(true); return; }
        setError(data.error || '분석 실패');
        return;
      }

      // 성공 → SSE 스트림 수신
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      // 2026-07-13 프로덕션 조사: Vercel이 함수 실행시간 초과로 강제 종료하면 SSE가
      // 명시적 error 프레임 없이 그냥 끊기고, reader.read()는 done:true를 정상 종료처럼
      // 반환한다 — result/error 이벤트를 한 번도 못 받고 루프가 끝나면 사용자는 아무
      // 안내 없이 그냥 이전 화면으로 돌아가는 것처럼 보였다(catch 블록도 안 타서 놓침).
      let receivedTerminalEvent = false;

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
            } else if (event.type === 'result') {
              receivedTerminalEvent = true;
              setResult(event.data);
              setGeneratedAt(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
              setRemaining(prev => Math.max(0, (prev ?? 1) - 1));
            } else if (event.type === 'error') {
              receivedTerminalEvent = true;
              if (event.message === 'PRO_REQUIRED') setShowUpgradeModal(true);
              else setError(event.message || '분석 실패');
            }
          } catch { /* malformed SSE line 무시 */ }
        }
      }

      if (!receivedTerminalEvent) {
        setError('분석 중 연결이 끊어졌습니다. 잠시 후 다시 시도해주세요.');
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // ── Auth loading ──────────────────────────────────────────────────────────

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PageBackground />
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
          <p className="text-slate-400 text-sm">예상 소요 시간: 30~60초</p>
        </div>
        <div className="flex flex-col gap-3 min-w-[240px]">
          {PORT_LOADING_STEPS.map((step, i) => (
            <div key={step} className={`flex items-center gap-3 transition-all duration-500 ${
              i < loadingStep  ? 'text-emerald-400' :
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
            <p className="text-[11px] font-bold tracking-widest text-indigo-400 uppercase mb-1">유료 플랜 전용 기능</p>
            <h2 className="text-xl font-bold text-white">포트폴리오 전체 분석</h2>
          </div>
          <div className="flex flex-col gap-2 text-left w-full">
            {[
              '최대 10개 기업 동시 분석',
              '섹터 편중도 자동 계산',
              '기업별 AI 관찰 리포트',
              '오늘 손익 기여도 분석',
              `월 최대 ${PLAN_USAGE_LIMITS.pro.portfolio}회 사용 가능`,
            ].map(f => (
              <div key={f} className="flex items-center gap-2">
                <span className="text-emerald-400 text-xs">✓</span>
                <span className="text-[13px] text-slate-300">{f}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => { setShowUpgradeModal(false); router.push('/pricing'); }}
            className="w-full py-3 rounded-xl text-[13px] font-semibold
              bg-gradient-to-r from-indigo-600 to-violet-600
              hover:from-indigo-500 hover:to-violet-500
              text-white transition-all cursor-pointer"
          >
            요금제 보기 →
          </button>
          <p className="text-[11px] text-slate-500">Basic 월 {PLAN_USAGE_LIMITS.basic.portfolio}회 · Pro 월 {PLAN_USAGE_LIMITS.pro.portfolio}회</p>
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
      <div className="pb-8">
        <PageBackground />
        {showUpgradeModal && <UpgradeModal />}
        <div className="max-w-5xl mx-auto px-4 pt-8">

          {/* Header */}
          <div className="flex items-start justify-between mb-6 gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">
                AI 포트폴리오 분석 리포트
              </p>
              <h1 className="text-[22px] font-bold text-white">포트폴리오 분석 리포트</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">리포트 생성: {generatedAt}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 mt-1 no-print">
              <ShareDropdown
                title="AI 포트폴리오 분석 리포트"
                description={`총 수익률 ${result.totalProfitRate >= 0 ? '+' : ''}${result.totalProfitRate.toFixed(2)}% | ${result.holdings.length}개 기업 AI 분석`}
                hashtags="fpark,기업분석,포트폴리오,AI분석"
                reportType="portfolio"
                reportData={{ ...result, generatedAt }}
              />
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30
                  border border-indigo-500/40 text-indigo-300 text-[11px] font-semibold tracking-wide transition-colors cursor-pointer"
              >
                <Printer className="w-3 h-3" /> PRINT REPORT
              </button>
            </div>
          </div>

          {/* 상단 면책 안내 (눈에 띄게) */}
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 mb-5">
            <span className="text-amber-400 text-sm mt-0.5 shrink-0">ⓘ</span>
            <p className="text-[12px] text-amber-200/90 leading-relaxed">
              본 리포트는 투자 판단에 참고할 수 있는 정보를 제공할 뿐, 투자자문이나 매매 권유가 아닙니다.
              투자 결정과 그 결과에 대한 책임은 투자자 본인에게 있습니다.
            </p>
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
              highlight
            />
            <MetricCard
              label="수익률"
              value={fmtR(result.totalProfitRate)}
              sub={`${result.holdings.length}개 기업`}
              up={isUp}
              highlight
            />
          </div>

          {/* 2행: AI 요약 */}
          <div
            className="rounded-2xl border border-indigo-500/25 overflow-hidden mb-4"
            style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}
          >
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
            <div className="px-8 py-6">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <p className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-widest">AI 종합 평가</p>
              </div>
              <div className="flex flex-col gap-3">
                {result.summary
                  .replace(/([.!?])\s+/g, '$1\n')
                  .split('\n')
                  .filter(Boolean)
                  .reduce<string[][]>((acc, s, i) => {
                    if (i % 2 === 0) acc.push([s]);
                    else acc[acc.length - 1].push(s);
                    return acc;
                  }, [])
                  .map((group, i) => (
                    <p key={i} className="text-[14px] text-slate-300" style={{ lineHeight: 1.8 }}>
                      {group.join(' ')}
                    </p>
                  ))
                }
              </div>
            </div>
          </div>

          {/* 2-1행: 직전 진단 대비 (신설) */}
          <PortfolioHistoryCard result={result} />

          {/* 3행: 벤치마크 비교 (사실 수치만, 판단 없음) */}
          {result.benchmark && (
            <Card title="벤치마크 비교 (참고용 수치)" className="mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-800/40 px-4 py-3">
                  <p className="text-[10px] text-slate-500 mb-1">귀하의 포트폴리오 수익률</p>
                  <p className={`text-lg font-mono font-bold ${result.benchmark.portfolioProfitRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {fmtR(result.benchmark.portfolioProfitRate)}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-800/40 px-4 py-3">
                  <p className="text-[10px] text-slate-500 mb-1">같은 기간 KOSPI 등락률</p>
                  <p className={`text-lg font-mono font-bold ${result.benchmark.kospiChangeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {fmtR(result.benchmark.kospiChangeRate)}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-600 mt-3">
                비교 기간: {result.benchmark.fromDate} ~ {result.benchmark.toDate} (편입 기업 평균 매입일 기준) · 판단이 아닌 수치 비교 정보입니다.
              </p>
            </Card>
          )}

          {/* 3행: 섹터 편중도 */}
          <Card title="섹터 편중도 분석" className="mb-4">
            <div className="flex flex-col gap-3">
              {sortedSectors.map((s, i) => {
                const hex = SECTOR_HEX[i % SECTOR_HEX.length];
                const barColor = s.warning ? '#ef4444' : hex;
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hex }} />
                        <span className="text-[13px] text-slate-300 font-medium">{s.name}</span>
                        {s.warning && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold"
                            style={{ backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
                          >
                            과집중
                          </span>
                        )}
                      </div>
                      <span className="text-[13px] font-mono text-slate-400">{s.weight}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1e293b' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${s.weight}%`, backgroundColor: barColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 3-1행: 오늘 손익 기여도 + 섹터 co-movement (신설, 데이터 있을 때만) */}
          {((result.topContributors?.positive.length ?? 0) > 0 || (result.topContributors?.negative.length ?? 0) > 0 || result.coMovementText) && (
            <div className={`grid grid-cols-1 ${result.coMovementText ? 'md:grid-cols-2' : ''} gap-4 mb-4`}>
              {((result.topContributors?.positive.length ?? 0) > 0 || (result.topContributors?.negative.length ?? 0) > 0) && (
                <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    오늘 손익 영향이 가장 큰 {result.topContributors.n}종목
                  </p>
                  <p className="text-[10px] text-slate-600 mb-3">전체 종목의 누적 수익률은 아래 &quot;기업별 관찰 지표&quot;를 참고하세요 — 여기는 오늘 하루 변화만 다룹니다</p>
                  {/* 금액은 서버 계산값을 그대로 표시(AI가 옮겨 적지 않음) — 아래 문장은 해석만 */}
                  <div className="flex flex-col gap-1.5 mb-3">
                    {result.topContributors.positive.map(c => (
                      <div key={c.ticker} className="flex items-center justify-between">
                        <span className="text-[12px] text-slate-400">{c.name}</span>
                        <span className="text-[13px] font-bold font-mono text-red-400">{c.amount >= 0 ? '+' : ''}{fmt(c.amount)}원</span>
                      </div>
                    ))}
                    {result.topContributors.negative.map(c => (
                      <div key={c.ticker} className="flex items-center justify-between">
                        <span className="text-[12px] text-slate-400">{c.name}</span>
                        <span className="text-[13px] font-bold font-mono text-blue-400">{fmt(c.amount)}원</span>
                      </div>
                    ))}
                  </div>
                  {result.contributionNarrative && (
                    <p className="text-[13px] text-slate-300 leading-relaxed">{result.contributionNarrative}</p>
                  )}
                </div>
              )}
              {result.coMovementText && (
                <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">섹터 동조화 관찰</p>
                  <p className="text-[11px] text-slate-500 mb-2">{result.coMovementText}</p>
                  {result.coMovementNarrative && (
                    <p className="text-[13px] text-slate-300 leading-relaxed">{result.coMovementNarrative}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4행: 기업별 관찰 지표 */}
          <Card title="기업별 관찰 지표" className="mb-4">
            <div className="flex flex-col divide-y divide-slate-700/40">
              {result.holdings.map(h => {
                const hUp = h.profitRate >= 0;
                return (
                  <div key={h.ticker} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3 flex-wrap md:flex-nowrap">
                      {/* 종목 */}
                      <div className="w-full md:w-40 shrink-0">
                        <p className="text-[14px] font-semibold text-white leading-tight">{h.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono">{h.ticker} · {h.sector}</p>
                        <Link href={`/stock/${h.ticker}`} className="text-[10px] text-indigo-400 hover:text-indigo-300 hover:underline mt-0.5 inline-block">
                          자세히 보기 →
                        </Link>
                      </div>
                      {/* 수치 */}
                      <div className="flex gap-4 shrink-0 text-right md:text-left">
                        <div>
                          <p className="text-[10px] text-slate-600 mb-0.5">현재가</p>
                          <p className="text-[13px] font-mono text-slate-300">{fmt(h.currentPrice)}</p>
                          {h.isCached && (
                            <p className="flex items-center gap-1 text-[10px] text-amber-500 mt-0.5">
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" /> 최근 거래일 종가
                            </p>
                          )}
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
                      {/* 관찰 지표 (변동성 — 방향성 판단 아닌 순수 수치) */}
                      {h.volatility != null && (
                        <div className="shrink-0 ml-auto flex flex-col items-end gap-1">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-bold text-slate-300 bg-slate-700/60 border border-slate-600/50">
                            변동성 {h.volatility.toFixed(2)}%
                          </span>
                        </div>
                      )}
                    </div>
                    {h.reason && (
                      <p className="mt-2 text-[12px] text-slate-500 leading-relaxed pl-0 md:pl-44">{h.reason}</p>
                    )}
                    {h.mdd != null && (
                      <p className="mt-1 text-[11px] text-slate-600 pl-0 md:pl-44">
                        최근 3개월 최대 {h.mdd.toFixed(1)}% 하락 이력
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 4-1행: 포트폴리오 Risk Factors + Opportunity Factors (대칭 구조) */}
          {((result.riskFactors?.length ?? 0) > 0 || (result.opportunityFactors?.length ?? 0) > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {(result.riskFactors?.length ?? 0) > 0 && (
                <div className="bg-[#1a1f2e] border border-red-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-[10px] font-bold text-red-400 uppercase tracking-wider">
                      Risk Factors
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {(result.riskFactors ?? []).map((line, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-red-500/60 text-[10px] mt-1 shrink-0">▶</span>
                        <p className="text-[12px] text-slate-300 leading-relaxed">{line}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(result.opportunityFactors?.length ?? 0) > 0 && (
                <div className="bg-[#1a1f2e] border border-emerald-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                      Opportunity Factors
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {(result.opportunityFactors ?? []).map((line, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-emerald-500/60 text-[10px] mt-1 shrink-0">▶</span>
                        <p className="text-[12px] text-slate-300 leading-relaxed">{line}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4-2행: 포트폴리오 단기/중기 전망 */}
          {(result.shortTermOutlook || result.midTermOutlook) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {result.shortTermOutlook && (
                <div className="bg-[#1a1f2e] border border-indigo-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                      단기 관찰 변수
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-300 leading-relaxed">{result.shortTermOutlook}</p>
                </div>
              )}
              {result.midTermOutlook && (
                <div className="bg-[#1a1f2e] border border-violet-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-[10px] font-bold text-violet-400 uppercase tracking-wider">
                      중기 관찰 변수
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-300 leading-relaxed">{result.midTermOutlook}</p>
                </div>
              )}
            </div>
          )}

          {/* 5행: 보유 기간별 관점 (신설, 매입일 데이터로 비교 가능할 때만) */}
          {(result.holdingPeriod?.longest && result.holdingPeriod?.mostRecent) && (
            <Card title="보유 기간별 관점" className="mb-4">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-xl bg-slate-800/40 px-4 py-3">
                  <p className="text-[10px] text-slate-500 mb-1">가장 오래 보유 · {result.holdingPeriod.longest.name} ({result.holdingPeriod.longest.holdDays}일 전 매입)</p>
                  <p className={`text-lg font-mono font-bold ${result.holdingPeriod.longest.profitRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {fmtR(result.holdingPeriod.longest.profitRate)}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-800/40 px-4 py-3">
                  <p className="text-[10px] text-slate-500 mb-1">가장 최근 편입 · {result.holdingPeriod.mostRecent.name} ({result.holdingPeriod.mostRecent.holdDays}일 전 매입)</p>
                  <p className={`text-lg font-mono font-bold ${result.holdingPeriod.mostRecent.profitRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {fmtR(result.holdingPeriod.mostRecent.profitRate)}
                  </p>
                </div>
              </div>
              {result.holdingPeriod.narrative && (
                <p className="text-[13px] text-slate-300 leading-relaxed">{result.holdingPeriod.narrative}</p>
              )}
            </Card>
          )}

          {/* 면책 */}
          <p className="text-[11px] text-slate-600 text-center leading-relaxed mb-6 px-4">
            본 리포트는 투자 판단에 참고할 수 있는 정보를 제공할 뿐, 투자자문이나 매매 권유가 아닙니다.
            투자 결정과 그 결과에 대한 책임은 투자자 본인에게 있습니다.
          </p>

          <button
            onClick={() => setResult(null)}
            className="flex items-center gap-2 mx-auto px-6 py-3 rounded-xl
              bg-slate-800 hover:bg-slate-700 border border-slate-700
              text-slate-300 text-[13px] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" /> 다시 분석받기
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INPUT FORM VIEW
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div className="pb-8">
      <PageBackground />
      {showUpgradeModal && <UpgradeModal />}

      <div className="max-w-5xl mx-auto px-4 pt-8">

        {/* 헤더 */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-2">
              AI Portfolio Analysis · Pro
            </p>
            <h1 className="text-2xl font-bold text-white">포트폴리오 전체 분석</h1>
            <p className="text-[13px] text-slate-500 mt-1">여러 기업을 한번에 입력하고 AI가 전체 포트폴리오를 종합 분석합니다.</p>
            <p className="text-[13px] text-slate-500 mt-1">국내 기업만 지원됩니다 · 해외 기업 분석은 준비 중입니다</p>
          </div>
          {/* 잔여 횟수 */}
          <div className="flex items-center gap-2 bg-[#1a1f2e] border border-slate-700/50 rounded-xl px-4 py-2.5 shrink-0">
            {(isPro || isBasic) ? (
              <>
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-[12px] text-slate-400">이번 달 잔여</span>
                <span className="text-[14px] font-bold text-white">{remaining}회</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-[12px] text-slate-500">유료 플랜 전용</span>
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
                Holdings  <span className="text-slate-600">({holdings.filter(h => h.ticker).length}/10)</span>
              </span>
            </div>
            {/* 워치리스트 불러오기 */}
            <div className="relative">
              <button
                ref={watchBtnRef}
                type="button"
                onClick={() => { setShowWatchPop(v => !v); setWatchChecked(new Set()); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold
                  bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                <BookMarked className="w-3 h-3" /> 워치리스트에서 불러오기
              </button>
              {showWatchPop && (
                <div className="absolute right-0 top-full mt-1 w-72
                  bg-[#1a1f2e] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
                  {watchlist.length === 0 ? (
                    <div className="px-4 py-3 text-[12px] text-slate-500">관심기업이 없습니다</div>
                  ) : (() => {
                    const filledCount   = holdings.filter(h => h.ticker).length;
                    const availableSlots = 10 - filledCount;
                    const selectableItems = watchlist.filter(w => !holdings.some(h => h.ticker === w.ticker));
                    const checkedCount  = watchlist.filter(w => watchChecked.has(w.ticker)).length;
                    const allChecked    = selectableItems.length > 0 && selectableItems.every(w => watchChecked.has(w.ticker));
                    const wouldExceed   = checkedCount > availableSlots;
                    return (
                      <>
                        {/* 전체선택 */}
                        <label className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-700/60 cursor-pointer hover:bg-slate-700/30 transition-colors">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            onChange={e => {
                              if (e.target.checked) setWatchChecked(new Set(selectableItems.map(w => w.ticker)));
                              else setWatchChecked(new Set());
                            }}
                            className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
                          />
                          <span className="text-[11px] font-semibold text-slate-400">전체선택</span>
                          <span className="ml-auto text-[10px] text-slate-600">{selectableItems.length}개</span>
                        </label>

                        {/* 종목 목록 */}
                        <div className="max-h-52 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-slate-500">
                          {watchlist.map(item => {
                            const already  = holdings.some(h => h.ticker === item.ticker);
                            const checked  = watchChecked.has(item.ticker);
                            return (
                              <label
                                key={item.ticker}
                                className={`flex items-center gap-3 px-4 py-2.5 transition-colors
                                  ${already ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-700/40'}`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={already || (!checked && checkedCount >= availableSlots)}
                                  checked={checked}
                                  onChange={e => {
                                    setWatchChecked(prev => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(item.ticker);
                                      else next.delete(item.ticker);
                                      return next;
                                    });
                                  }}
                                  className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
                                />
                                <span className="text-[13px] text-white flex-1">{item.name}</span>
                                <span className="text-[11px] text-slate-500 font-mono">{item.ticker}</span>
                              </label>
                            );
                          })}
                        </div>

                        {/* 하단 적용 버튼 */}
                        <div className="px-4 py-3 border-t border-slate-700/60">
                          {wouldExceed && (
                            <p className="text-[11px] text-amber-400 mb-2">
                              최대 10개까지 선택 가능합니다 (현재 {filledCount}개 입력됨)
                            </p>
                          )}
                          <button
                            type="button"
                            disabled={checkedCount === 0}
                            onClick={applyWatchlistSelection}
                            className="w-full py-2 rounded-lg text-[12px] font-semibold transition-colors cursor-pointer
                              bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            선택 적용 ({checkedCount}개)
                          </button>
                        </div>
                      </>
                    );
                  })()}
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
              <Plus className="w-4 h-4" /> 기업 추가 (최대 10개)
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
            ${(!isPro && !isBasic) || remaining === 0
              ? 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
              : 'text-white cursor-pointer hover:opacity-90 active:scale-[0.99]'
            }`}
          style={(!isPro && !isBasic) || remaining === 0 ? {} : {
            background: 'linear-gradient(135deg, #4f46e5 0%, #0ea5e9 50%, #10b981 100%)',
            boxShadow:  '0 0 30px rgba(79,70,229,0.3)',
          }}
        >
          {(isPro || isBasic) && remaining !== 0 && (
            <span className="absolute inset-0 bg-white/0 hover:bg-white/5 transition-colors rounded-xl" />
          )}
          {(!isPro && !isBasic) ? <Lock className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
          {(!isPro && !isBasic) ? '유료 플랜 전용 기능 — 업그레이드 필요' : '✦ START AI DIAGNOSIS'}
        </button>
        <p className="text-center text-[11px] text-slate-600 mt-2">
          {(!isPro && !isBasic)
            ? 'Basic 또는 Pro 플랜으로 업그레이드하면 포트폴리오 전체 분석을 이용할 수 있습니다.'
            : isPro
              ? `월 ${PLAN_USAGE_LIMITS.pro.portfolio}회 · 이번 달 ${remaining ?? 0}회 남음`
              : `월 ${PLAN_USAGE_LIMITS.basic.portfolio}회 · 이번 달 ${remaining ?? 0}회 남음`}
        </p>
        </div>{/* ← 좌측 컬럼 닫기 */}

        {/* ── 우측 사이드바 (모바일 숨김) ── */}
        <div className="hidden lg:block">
          <DiagnosisSidebar />
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
              onKeyDown={e => {
                if (e.key === 'Enter' && h._results.length > 0) {
                  e.preventDefault();
                  onSelect(h._results[0].ticker, h._results[0].name);
                }
              }}
              placeholder="기업명 또는 코드"
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
          placeholder="매입가 (KRW)"
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
