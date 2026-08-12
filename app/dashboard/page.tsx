'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import { Plus, Trash2, Search, Sparkles, RefreshCw, Lock } from 'lucide-react';
import PageBackground from '@/components/layout/PageBackground';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { isKoreanMarketOpen } from '@/lib/market-utils';
import { useSmoothTypingText } from '@/lib/useSmoothTypingText';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchItem { ticker: string; name: string }

interface HoldingRow {
  id: string; ticker: string; name: string; market: string;
  avg_price: number; buy_date: string | null; quantity: number;
  currentPrice: number; changeRate: number;
}

interface DashboardHoldingResult {
  ticker: string; name: string; currentPrice: number; avgPrice: number; quantity: number;
  value: number; invested: number; profit: number; profitRate: number;
  newsBasis?: 'news' | 'estimated';
  news?: { title: string; summary?: string; url?: string }[];
  todayContribution?: number | null;
  reason?: string; sector?: string;
}

interface DashboardHistory {
  daysSince: number | null; prevDate?: string;
  compositionChanged?: boolean;
  addedTickers?: { ticker: string; name: string }[];
  removedTickers?: { ticker: string; name: string }[];
  narrative?: string;
}

interface HoldingPeriodEntry { ticker: string; name: string; holdDays: number; profitRate: number }

interface DashboardSummarySections {
  background: string; newsInterpretation: string; historicalComparison: string; judgment: string;
}

interface StreamedDashboardResult {
  totalInvested?: number; totalValue?: number; totalProfit?: number; totalProfitRate?: number;
  holdings?: DashboardHoldingResult[];
  history?: DashboardHistory;
  holdingPeriod?: { longest: HoldingPeriodEntry | null; mostRecent: HoldingPeriodEntry | null; narrative?: string };
  summarySections?: DashboardSummarySections;
  sectors?: unknown[];
  riskFactors?: ({ text: string; category?: 'macro' | 'company' } | string)[];
  opportunityFactors?: string[];
  shortTermOutlook?: string; midTermOutlook?: string;
  coMovementText?: string | null; coMovementNarrative?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number)  { return n.toLocaleString(); }
function fmtR(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

// Stage2 'portfolio-field(-partial)' 이벤트 key를 StreamedDashboardResult 형태로 매핑.
// app/api/dashboard/analysis/route.ts가 portfolio-diagnosis와 동일한 이벤트 shape을 쓰므로
// app/portfolio-diagnosis/page.tsx의 applyPortfolioField와 동일한 원칙을 그대로 재사용.
const SUMMARY_SECTION_KEYS: Record<string, keyof DashboardSummarySections> = {
  summarySections_background: 'background',
  summarySections_newsInterpretation: 'newsInterpretation',
  summarySections_historicalComparison: 'historicalComparison',
  summarySections_judgment: 'judgment',
};

function applyPortfolioField(prev: StreamedDashboardResult | null, key: string, value: unknown): StreamedDashboardResult {
  const base = prev ?? {};
  if (key === 'historyNarrative') {
    return { ...base, history: { ...(base.history ?? { daysSince: null }), narrative: value as string } };
  }
  if (key === 'holdingPeriodNarrative') {
    return { ...base, holdingPeriod: { ...(base.holdingPeriod ?? { longest: null, mostRecent: null }), narrative: value as string } };
  }
  const sectionKey = SUMMARY_SECTION_KEYS[key];
  if (sectionKey) {
    return {
      ...base,
      summarySections: {
        background: '', newsInterpretation: '', historicalComparison: '', judgment: '',
        ...base.summarySections,
        [sectionKey]: value as string,
      },
    };
  }
  return { ...base, [key]: value };
}

function TypingCursor() {
  return <span className="ml-0.5 text-indigo-300 animate-pulse font-light">▌</span>;
}

function FieldSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="space-y-1.5 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-slate-700/40" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      {title && <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-4`}>{title}</p>}
      {children}
    </div>
  );
}

// ── 종목 등록 폼 ──────────────────────────────────────────────────────────────

function AddHoldingForm({ onAdded, onCancel, showCancel }: { onAdded: () => void; onCancel?: () => void; showCancel: boolean }) {
  const [ticker, setTicker]   = useState('');
  const [name, setName]       = useState('');
  const [q, setQ]             = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [open, setOpen]       = useState(false);
  const [avgPrice, setAvgPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [buyDate, setBuyDate]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const search = (value: string) => {
    setQ(value); setTicker(''); setName('');
    clearTimeout(timer.current);
    if (!value.trim()) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/search?q=${encodeURIComponent(value.trim())}`);
        const data = await res.json();
        const items: SearchItem[] = Array.isArray(data)
          ? data.filter((s: { isOverseas?: boolean }) => !s.isOverseas).slice(0, 6)
          : [];
        setResults(items); setOpen(items.length > 0);
      } catch { /* noop */ }
    }, 200);
  };

  const submit = async () => {
    if (!ticker || !avgPrice || !quantity) { setFormError('기업·매입가·수량을 입력해주세요.'); return; }
    setFormError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/dashboard/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker, name,
          avgPrice: parseInt(avgPrice.replace(/,/g, ''), 10),
          quantity: parseInt(quantity, 10),
          buyDate: buyDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || '등록에 실패했습니다.'); return; }
      setTicker(''); setName(''); setQ(''); setAvgPrice(''); setQuantity(''); setBuyDate('');
      onAdded();
    } catch {
      setFormError('네트워크 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2.5">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input
            value={q}
            onChange={e => search(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="기업명 또는 종목코드 검색"
            className="bg-transparent text-sm text-white placeholder:text-slate-600 outline-none w-full"
          />
        </div>
        {open && (
          <div className="absolute z-10 mt-1 w-full bg-[#1a1f2e] border border-slate-700 rounded-xl overflow-hidden shadow-xl">
            {results.map(item => (
              <button
                key={item.ticker}
                onClick={() => { setTicker(item.ticker); setName(item.name); setQ(item.name); setResults([]); setOpen(false); }}
                className="w-full text-left px-3.5 py-2.5 text-sm text-slate-200 hover:bg-indigo-500/10 transition-colors cursor-pointer"
              >
                {item.name} <span className="text-slate-500 text-xs font-mono">{item.ticker}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[10px] text-slate-500 mb-1">매수가(원)</p>
          <input
            value={avgPrice}
            onChange={e => setAvgPrice(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="70000"
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <p className="text-[10px] text-slate-500 mb-1">수량</p>
          <input
            value={quantity}
            onChange={e => setQuantity(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="10"
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <p className="text-[10px] text-slate-500 mb-1">매수일 (선택)</p>
          <input
            type="date"
            value={buyDate}
            onChange={e => setBuyDate(e.target.value)}
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50 [color-scheme:dark]"
          />
        </div>
      </div>
      {formError && <p className="text-[12px] text-red-400">{formError}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors cursor-pointer"
        >
          {submitting ? '등록 중...' : '종목 등록'}
        </button>
        {showCancel && onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
          >
            취소
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [authChecked, setAuthChecked] = useState(false);
  const [holdings, setHoldings]       = useState<HoldingRow[] | null>(null);
  const [limit, setLimit]             = useState(2);
  const [holdingsError, setHoldingsError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [marketOpen, setMarketOpen]   = useState(true);

  const lastUpdatedRef   = useRef<Date | null>(null);
  const isRefreshingRef  = useRef(false);

  // AI 분석
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisLabel,   setAnalysisLabel]   = useState('');
  const [analysisError,   setAnalysisError]   = useState('');
  const [analysisResult,  setAnalysisResult]  = useState<StreamedDashboardResult | null>(null);
  const [isCached,        setIsCached]        = useState(false);
  const [stage1Complete,  setStage1Complete]  = useState(false);
  const [stage2Failed,    setStage2Failed]    = useState(false);
  const [streamFinished,  setStreamFinished]  = useState(false);
  const smoothText = useSmoothTypingText();

  // ── Init ──────────────────────────────────────────────────────────────────

  const loadHoldings = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    try {
      const res  = await fetch('/api/dashboard/holdings');
      const data = await res.json();
      if (res.ok && Array.isArray(data.holdings)) {
        setHoldings(data.holdings);
        setLimit(data.limit ?? 2);
        setHoldingsError('');
      } else {
        setHoldingsError(data.error || '보유 종목을 불러오지 못했습니다.');
      }
    } catch {
      setHoldingsError('네트워크 오류가 발생했습니다.');
    } finally {
      lastUpdatedRef.current = new Date();
      isRefreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace(loginUrlWithRedirect(window.location.pathname)); return; }
      setAuthChecked(true);
      loadHoldings();
    });
  }, []); // eslint-disable-line

  // 가격 5분 폴링 — app/market/domestic/page.tsx와 동일 패턴(30초 체크 틱 + 5분 경과 시 갱신,
  // 탭 복귀 시 즉시 재확인). 대시보드는 KOSPI/KOSDAQ 확정치 캐치업 로직이 필요 없어(개별
  // 종목 시세일 뿐 지수가 아님) 그 부분만 뺐다.
  useEffect(() => {
    const POLL_MS  = 5 * 60 * 1000;
    const CHECK_MS = 30 * 1000;

    const tick = () => {
      setMarketOpen(isKoreanMarketOpen());
      if (document.visibilityState !== 'visible') return;
      const last = lastUpdatedRef.current;
      if (!last || Date.now() - last.getTime() >= POLL_MS) loadHoldings();
    };

    const id = setInterval(tick, CHECK_MS);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    setMarketOpen(isKoreanMarketOpen());

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadHoldings]);

  const removeHolding = async (ticker: string) => {
    setHoldings(prev => prev ? prev.filter(h => h.ticker !== ticker) : prev);
    try {
      await fetch('/api/dashboard/holdings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
    } catch { /* noop */ }
    loadHoldings();
  };

  // ── AI 분석 ───────────────────────────────────────────────────────────────

  const runAnalysis = async () => {
    setAnalysisError('');
    setAnalysisLoading(true);
    setAnalysisLabel('분석 준비 중...');
    setAnalysisResult(null);
    setIsCached(false);
    setStage1Complete(false);
    setStage2Failed(false);
    setStreamFinished(false);
    smoothText.reset();

    let sawStage1Complete = false;

    try {
      const res = await fetch('/api/dashboard/analysis', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setAnalysisError(data.error || '분석 실패');
        return;
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      let   receivedTerminalEvent = false;

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
              setAnalysisLabel(event.label);
            } else if (event.type === 'meta') {
              const { type: _t, ...metaFields } = event;
              setAnalysisResult(prev => ({ ...prev, ...metaFields }));
            } else if (event.type === 'holding-meta') {
              setAnalysisResult(prev => ({ ...(prev ?? {}), holdings: event.holdings }));
            } else if (event.type === 'holding-field-partial') {
              const { ticker, key, value: v } = event;
              setAnalysisResult(prev => {
                if (!prev?.holdings) return prev;
                return { ...prev, holdings: prev.holdings.map(h => h.ticker === ticker ? { ...h, [key]: v } : h) };
              });
              smoothText.feed(`holding:${ticker}:${key}`, v);
            } else if (event.type === 'holding-field') {
              const { ticker, key, value: v } = event;
              setAnalysisResult(prev => {
                if (!prev?.holdings) return prev;
                return { ...prev, holdings: prev.holdings.map(h => h.ticker === ticker ? { ...h, [key]: v } : h) };
              });
              if (typeof v === 'string') smoothText.snap(`holding:${ticker}:${key}`, v);
            } else if (event.type === 'stage1-done') {
              sawStage1Complete = true;
              setStage1Complete(true);
              setAnalysisResult(prev => ({ ...(prev ?? {}), coMovementText: event.coMovementText }));
            } else if (event.type === 'portfolio-field-partial') {
              const { key, value: v } = event;
              setAnalysisResult(prev => applyPortfolioField(prev, key, v));
              smoothText.feed(key, v);
            } else if (event.type === 'portfolio-field') {
              const { key, value: v } = event;
              setAnalysisResult(prev => applyPortfolioField(prev, key, v));
              if (typeof v === 'string') smoothText.snap(key, v);
            } else if (event.type === 'stage2-error') {
              setStage2Failed(true);
              setStreamFinished(true);
              smoothText.snapAll();
            } else if (event.type === 'done') {
              receivedTerminalEvent = true;
              setIsCached(!!event.isCached);
              setStage1Complete(true);
              setStreamFinished(true);
              smoothText.snapAll();
            } else if (event.type === 'error') {
              receivedTerminalEvent = true;
              setAnalysisError(event.message || '분석 실패');
              smoothText.snapAll();
            }
          } catch { /* malformed SSE line 무시 */ }
        }
      }

      if (!receivedTerminalEvent) {
        if (sawStage1Complete) { setStage2Failed(true); setStreamFinished(true); }
        else setAnalysisError('분석 중 연결이 끊어졌습니다. 잠시 후 다시 시도해주세요.');
        smoothText.snapAll();
      }
    } catch {
      if (sawStage1Complete) { setStage2Failed(true); setStreamFinished(true); }
      else setAnalysisError('네트워크 오류가 발생했습니다.');
      smoothText.snapAll();
    } finally {
      setAnalysisLoading(false);
      smoothText.snapAll();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!authChecked || holdings === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PageBackground />
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 최초 진입(등록 종목 0개) — 입력폼 강제 노출, 취소 불가
  if (holdings.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <PageBackground />
        <div className="bg-[#1a1f2e] border border-indigo-500/20 rounded-2xl p-8 max-w-md w-full">
          <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">대시보드</p>
          <h1 className="text-lg font-bold text-white mb-1">보유 종목을 등록해주세요</h1>
          <p className="text-[12px] text-slate-500 mb-5">등록한 종목의 시세를 추적하고, 장 마감 후 AI 분석을 받아볼 수 있습니다.</p>
          {holdingsError && <p className="text-[12px] text-red-400 mb-3">{holdingsError}</p>}
          <AddHoldingForm onAdded={loadHoldings} showCancel={false} />
        </div>
      </div>
    );
  }

  const totalInvested = holdings.reduce((s, h) => s + h.avg_price * h.quantity, 0);
  const totalValue    = holdings.reduce((s, h) => s + h.currentPrice * h.quantity, 0);
  const totalProfit   = totalValue - totalInvested;
  const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const isUp = totalProfitRate >= 0;
  const atLimit = holdings.length >= limit;

  const reportReady = streamFinished && !stage2Failed;

  return (
    <div className="pb-8">
      <PageBackground />
      <div className="max-w-4xl mx-auto px-4 pt-8">

        <div className="mb-6">
          <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">대시보드</p>
          <h1 className="text-[22px] font-bold text-white">내 보유 종목</h1>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="border rounded-2xl p-4" style={{ background: '#1a1f2e', borderColor: '#334155' }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">총 투자금</p>
            <p className="text-xl font-bold font-mono text-white">{fmt(totalInvested)}원</p>
          </div>
          <div className="border rounded-2xl p-4" style={{ background: '#1a1f2e', borderColor: '#334155' }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">평가금액</p>
            <p className="text-xl font-bold font-mono text-white">{fmt(totalValue)}원</p>
          </div>
          <div className="border rounded-2xl p-4" style={{ background: isUp ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)', borderColor: isUp ? 'rgba(239,68,68,0.4)' : 'rgba(59,130,246,0.4)' }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">총 손익</p>
            <p className={`text-xl font-bold font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>{totalProfit >= 0 ? '+' : ''}{fmt(totalProfit)}원</p>
          </div>
          <div className="border rounded-2xl p-4" style={{ background: isUp ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)', borderColor: isUp ? 'rgba(239,68,68,0.4)' : 'rgba(59,130,246,0.4)' }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">수익률</p>
            <p className={`text-xl font-bold font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(totalProfitRate)}</p>
          </div>
        </div>

        {/* 보유 종목 리스트 */}
        <Card title={`보유 종목 (${holdings.length}/${limit})`} className="mb-4">
          <div className="flex flex-col divide-y divide-slate-700/40">
            {holdings.map(h => {
              const value = h.currentPrice * h.quantity;
              const invested = h.avg_price * h.quantity;
              const profitRate = h.avg_price > 0 ? ((h.currentPrice - h.avg_price) / h.avg_price) * 100 : 0;
              const up = profitRate >= 0;
              return (
                <div key={h.ticker} className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/stock/${h.ticker}`} className="text-[14px] font-semibold text-white hover:text-indigo-300 transition-colors truncate block">
                      {h.name}
                    </Link>
                    <p className="text-[11px] text-slate-500 font-mono">{h.ticker} · {h.quantity}주 · 매입가 {fmt(h.avg_price)}</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-[13px] font-mono text-slate-200">{fmt(h.currentPrice)}</p>
                      <p className={`text-[11px] font-mono ${up ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(h.changeRate)}</p>
                    </div>
                    <div className="text-right w-24">
                      <p className={`text-[13px] font-mono font-semibold ${up ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(profitRate)}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{value - invested >= 0 ? '+' : ''}{fmt(Math.round(value - invested))}원</p>
                    </div>
                    <button
                      onClick={() => removeHolding(h.ticker)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {showAddForm ? (
            <div className="mt-4 pt-4 border-t border-slate-700/40">
              <AddHoldingForm onAdded={() => { setShowAddForm(false); loadHoldings(); }} onCancel={() => setShowAddForm(false)} showCancel />
            </div>
          ) : (
            <button
              onClick={() => atLimit ? null : setShowAddForm(true)}
              disabled={atLimit}
              className="mt-4 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold
                bg-slate-800/60 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed
                text-slate-300 border border-slate-700 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> {atLimit ? `현재 플랜 등록 한도(${limit}개)에 도달했습니다` : '종목 추가'}
            </button>
          )}
          {atLimit && (
            <p className="text-[11px] text-slate-500 mt-2 text-center">
              더 많은 종목을 등록하려면 <Link href="/pricing" className="text-indigo-400 hover:underline">요금제를 업그레이드</Link>하세요.
            </p>
          )}
        </Card>

        {/* AI 분석 버튼 — 장중에는 숨김(장마감 후·거래일에만 노출) */}
        {!marketOpen && !analysisResult && (
          <Card className="mb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <div>
                  <p className="text-[13px] font-semibold text-white">오늘의 AI 분석</p>
                  <p className="text-[11px] text-slate-500">보유 종목의 오늘 뉴스·이슈·시세를 종합 해석합니다 (하루 1회 생성)</p>
                </div>
              </div>
              <button
                onClick={runAnalysis}
                disabled={analysisLoading}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold
                  bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500
                  disabled:opacity-50 text-white transition-all cursor-pointer"
              >
                {analysisLoading ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {analysisLabel || '분석 중...'}</>
                ) : (
                  <><Sparkles className="w-3.5 h-3.5" /> AI 분석 보기</>
                )}
              </button>
            </div>
            {analysisError && <p className="text-[12px] text-red-400 mt-3">{analysisError}</p>}
          </Card>
        )}
        {marketOpen && !analysisResult && (
          <Card className="mb-4">
            <div className="flex items-center gap-2.5 text-slate-500">
              <Lock className="w-4 h-4" />
              <p className="text-[12px]">AI 분석은 장 마감 후(15:30 이후) 이용할 수 있습니다.</p>
            </div>
          </Card>
        )}

        {/* AI 분석 결과 */}
        {analysisResult && (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className={`${SECTION_TITLE_CLASS} text-indigo-400 uppercase tracking-widest`}>AI 분석 결과</p>
              {isCached && <span className="text-[10px] text-slate-500">오늘 생성된 분석입니다</span>}
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 mb-4">
              <span className="text-amber-400 text-sm mt-0.5 shrink-0">ⓘ</span>
              <p className="text-[12px] text-amber-200/90 leading-relaxed">
                본 분석은 투자 판단에 참고할 수 있는 정보를 제공할 뿐, 투자자문이나 매매 권유가 아닙니다.
              </p>
            </div>

            {stage2Failed ? (
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-6 py-5 mb-4">
                <p className="text-[13px] text-amber-200/90 leading-relaxed">AI 종합 평가를 불러오지 못했습니다. 종목별 분석은 아래에서 확인하실 수 있습니다.</p>
                <button
                  onClick={runAnalysis}
                  className="flex items-center gap-1.5 shrink-0 px-4 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[12px] font-semibold transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 다시 시도
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-indigo-500/25 overflow-hidden mb-4" style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}>
                <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
                <div className="px-6 py-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <p className={`${SECTION_TITLE_CLASS} text-indigo-400/70 uppercase tracking-widest`}>AI 종합 평가</p>
                  </div>
                  {(() => {
                    const sections = analysisResult.summarySections;
                    if (!sections) return <FieldSkeleton lines={4} />;
                    const blocks = [
                      { key: 'summarySections_background',          label: '구조적 배경',   text: sections.background },
                      { key: 'summarySections_newsInterpretation',   label: '뉴스 해석',     text: sections.newsInterpretation },
                      { key: 'summarySections_historicalComparison', label: '과거 유사 이력', text: sections.historicalComparison },
                      { key: 'summarySections_judgment',             label: '종합 판단',     text: sections.judgment },
                    ];
                    return (
                      <div className="flex flex-col gap-4">
                        {blocks.map(b => (
                          b.text ? (
                            <div key={b.label}>
                              <p className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-wide mb-1">{b.label}</p>
                              <p className="text-xs text-slate-300" style={{ lineHeight: 1.8 }}>
                                {smoothText.revealed[b.key]?.text ?? b.text}{smoothText.revealed[b.key]?.active && <TypingCursor />}
                              </p>
                            </div>
                          ) : !streamFinished ? (
                            <div key={b.label}>
                              <p className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-wide mb-1">{b.label}</p>
                              <FieldSkeleton lines={2} />
                            </div>
                          ) : null
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            <Card title={stage1Complete ? '종목별 관찰 지표' : '종목별 관찰 지표 (분석 중...)'} className="mb-4">
              <div className="flex flex-col divide-y divide-slate-700/40">
                {(analysisResult.holdings ?? []).map(h => {
                  const hUp = h.profitRate >= 0;
                  const revealedSector = smoothText.revealed[`holding:${h.ticker}:sector`];
                  const revealedReason = smoothText.revealed[`holding:${h.ticker}:reason`];
                  const sectorText = revealedSector?.text ?? h.sector;
                  const reasonText = revealedReason?.text ?? h.reason;
                  return (
                    <div key={h.ticker} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-start gap-3 flex-wrap md:flex-nowrap">
                        <div className="w-full md:w-40 shrink-0">
                          <p className="text-[14px] font-semibold text-white leading-tight">{h.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            {h.ticker}{sectorText !== undefined ? ` · ${sectorText}` : ''}
                            {revealedSector?.active && <TypingCursor />}
                          </p>
                          <p className={`text-[13px] font-mono font-semibold mt-1 ${hUp ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(h.profitRate)}</p>
                        </div>
                        <div className="w-full">
                          {reasonText !== undefined ? (
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {reasonText}{revealedReason?.active && <TypingCursor />}
                            </p>
                          ) : (
                            <FieldSkeleton lines={2} />
                          )}
                          {h.newsBasis === 'estimated' && (
                            <p className="text-[10px] text-slate-600 mt-1.5">관련 뉴스 없음 — 수급·기술적 요인 기반 관찰</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {analysisResult.coMovementText && (
              <Card title="섹터 동조화 관찰" className="mb-4">
                <p className="text-[11px] text-slate-500 mb-2">{analysisResult.coMovementText}</p>
                {analysisResult.coMovementNarrative !== undefined ? (
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {smoothText.revealed.coMovementNarrative?.text ?? analysisResult.coMovementNarrative}
                    {smoothText.revealed.coMovementNarrative?.active && <TypingCursor />}
                  </p>
                ) : !stage2Failed && <FieldSkeleton lines={1} />}
              </Card>
            )}

            {(analysisResult.shortTermOutlook || analysisResult.midTermOutlook) && (
              <Card title="관찰 변수" className="mb-4">
                <div className="flex flex-col gap-3">
                  {analysisResult.shortTermOutlook && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">단기</p>
                      <p className="text-xs text-slate-300 leading-relaxed">{analysisResult.shortTermOutlook}</p>
                    </div>
                  )}
                  {analysisResult.midTermOutlook && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">중기</p>
                      <p className="text-xs text-slate-300 leading-relaxed">{analysisResult.midTermOutlook}</p>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {reportReady && (
              <button
                onClick={runAnalysis}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold
                  bg-slate-800/60 hover:bg-slate-800 text-slate-400 border border-slate-700 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 다시 불러오기 (당일 캐시)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
