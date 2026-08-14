'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import { Plus, Trash2, Search, Sparkles, RefreshCw, Lock, EyeOff, Eye, Coins } from 'lucide-react';
import PageBackground from '@/components/layout/PageBackground';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { isKoreanMarketOpen } from '@/lib/market-utils';
import { useSmoothTypingText } from '@/lib/useSmoothTypingText';
import { useCountUp } from '@/lib/use-count-up';
import AiAnalysis from '@/components/stock/AiAnalysis';
import OverseasAiAnalysis from '@/components/stock/OverseasAiAnalysis';
import { AllocationDonutChart, ReturnBarChart, MonthlyReturnLineChart, SectorAllocationDonutChart, type RiskPoint, type MonthlyPoint } from '@/components/dashboard/DashboardCharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchItem { ticker: string; name: string }

interface HoldingRow {
  id: string; ticker: string; name: string; market: string;
  avg_price: number; buy_date: string | null; quantity: number;
  currentPrice: number; changeRate: number;
  week52High: number; week52Low: number; marketCap: string; per: number; pbr: number;
  sector: string;
  hidden: boolean;
}

interface DividendInfo {
  ticker: string;
  dividendSummary: { year: string; dividendYield: number | null; dividendPerShare: number | null; payoutRatio: number | null } | null;
  latestDividend: { recordDate: string; payDate: string | null; kind: '분기' | '결산'; kindLabel: string; perShareAmount: number } | null;
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
  coMovementText?: string | null; coMovementNarrative?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number)  { return n.toLocaleString(); }
function fmtR(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }
function fmtDate(d: string) { return d.replaceAll('-', '.'); }

// 종목카드 내부 통계 라벨(현재가/평가손익/52주 최고·최저/시가총액/5일변동률) — 색상
// 차이만으로는 다크테마에서 라벨과 값이 잘 구분되지 않아 옅은 배경의 배지 형태로 분리.
const STAT_LABEL_CLASS = 'inline-block text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-800/60 rounded px-1.5 py-0.5 mb-1';

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

// 종목카드 아이콘 버튼(배당·AI분석·숨기기·삭제) 호버 툴팁 — 브라우저 기본 title
// 툴팁은 지연이 크고 다크테마와 안 어울려서, group-hover만으로 동작하는 순수 CSS
// 툴팁으로 대체한다(별도 라이브러리·JS 상태 불필요). 모바일은 hover 자체가 없어
// 탭해도 안 뜨는데, 아이콘 색상만으로도 종류가 구분되니(호박색=배당·인디고=AI 등)
// 별도 터치 대응 없이 그대로 둔다 — hover 전용 점진적 향상으로 취급.
function IconTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative group/tip">
      {children}
      <span
        className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 z-20 whitespace-nowrap
          rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-200 shadow-lg
          opacity-0 scale-95 transition-all duration-150 group-hover/tip:opacity-100 group-hover/tip:scale-100"
      >
        {label}
        <span className="absolute left-1/2 top-full -translate-x-1/2 -mt-px h-1.5 w-1.5 rotate-45 border-b border-r border-slate-700 bg-slate-900" />
      </span>
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

// ── 모달 ──────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, maxWidth = 'max-w-lg' }: {
  title: string; onClose: () => void; children: React.ReactNode; maxWidth?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl w-full ${maxWidth} shadow-2xl max-h-[85vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <p className="text-[13px] font-semibold text-white">{title}</p>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer text-[13px]"
          >
            닫기
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
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
  // 종목별 AI 분석 모달 — 카드 내부 펼침 대신 모달로 띄운다(카드 그리드가 한 카드만
  // 확장되며 레이아웃이 깨지는 걸 방지).
  const [analysisModal, setAnalysisModal] = useState<{ ticker: string; name: string; market: string } | null>(null);
  const [dividendModal, setDividendModal] = useState<{ ticker: string; name: string } | null>(null);

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

  // 위험도(변동성) — 1년치 일봉이 필요한 무거운 조회라 5분 시세폴링에는 얹지 않고
  // 페이지 진입 시 1회만 부른다(서버가 티커 단위로 1시간 캐시).
  const [riskData, setRiskData] = useState<RiskPoint[]>([]);
  const loadRisk = useCallback(async () => {
    try {
      const res  = await fetch('/api/dashboard/risk');
      const data = await res.json();
      if (res.ok && Array.isArray(data.risk)) setRiskData(data.risk);
    } catch { /* 산점도는 부가 정보라 실패해도 조용히 무시 */ }
  }, []);

  // 월별 수익률 추이(6개월) — 위험도와 같은 이유로 시세폴링과 분리해 1회만 부른다.
  // 종목당 연쇄 백필 조회라 위험도보다도 무거울 수 있어 서버가 1일 캐시(market_cache
  // 테이블, chart-near 라우트와 공유)를 건다.
  const [monthlyData, setMonthlyData] = useState<MonthlyPoint[]>([]);
  const [dailyData,   setDailyData]   = useState<MonthlyPoint[]>([]);
  const loadMonthly = useCallback(async () => {
    try {
      const res  = await fetch('/api/dashboard/monthly-returns');
      const data = await res.json();
      if (res.ok && Array.isArray(data.monthly)) setMonthlyData(data.monthly);
      if (res.ok && Array.isArray(data.daily)) setDailyData(data.daily);
    } catch { /* 라인차트는 부가 정보라 실패해도 조용히 무시 */ }
  }, []);

  // 배당현황 — DART/KIS 조회라 무거워 위험도·수익률추이와 같은 이유로 5분 시세폴링과
  // 분리해 페이지 진입 시 1회만 부른다. 서버가 티커 단위로 이미 DART 7일/KIS 24시간
  // 캐시를 걸어두므로 여기엔 별도 캐시가 필요 없다.
  const [dividendData, setDividendData] = useState<Record<string, DividendInfo>>({});
  const loadDividend = useCallback(async () => {
    try {
      const res  = await fetch('/api/dashboard/dividend');
      const data = await res.json();
      if (res.ok && Array.isArray(data.dividends)) {
        const map: Record<string, DividendInfo> = {};
        for (const d of data.dividends as DividendInfo[]) map[d.ticker] = d;
        setDividendData(map);
      }
    } catch { /* 배당현황은 부가 정보라 실패해도 조용히 무시 */ }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace(loginUrlWithRedirect(window.location.pathname)); return; }
      setAuthChecked(true);
      loadHoldings();
      loadRisk();
      loadMonthly();
      loadDividend();
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

  // 숨기기/다시 보이기 — row는 유지하고 표시 플래그만 바꾼다. 낙관적으로 즉시
  // 반영하고, 카드그리드/스탯카드/차트가 전부 다시 계산되게 리스크·추이도 새로 부른다
  // (숨김 전환 직후 투자원금 합계가 바뀌므로 월별·일별 추이·위험도도 갱신 필요).
  const setHoldingHidden = async (ticker: string, hidden: boolean) => {
    setHoldings(prev => prev ? prev.map(h => h.ticker === ticker ? { ...h, hidden } : h) : prev);
    try {
      await fetch('/api/dashboard/holdings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, hidden }),
      });
    } catch { /* noop */ }
    loadRisk();
    loadMonthly();
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

  // 스탯카드 롤링 애니메이션용 훅은 조건부 return보다 위에서 항상 호출해야 한다(React
  // hooks 규칙) — holdings가 아직 null인 로딩 상태에서는 0으로 계산해두고, 아래
  // early return을 통과한 뒤에야 실제 화면에 쓰인다.
  const visibleHoldings = (holdings ?? []).filter(h => !h.hidden);
  const hiddenHoldings  = (holdings ?? []).filter(h => h.hidden);
  // 카드 그리드는 숨긴 종목도 흐리게 그대로 보여주되(제자리에서 사라지지 않음),
  // 활성 종목을 먼저 스캔할 수 있도록 숨긴 종목만 뒤로 정렬한다.
  const orderedHoldings = [...visibleHoldings, ...hiddenHoldings];
  const totalInvestedRaw   = visibleHoldings.reduce((s, h) => s + h.avg_price * h.quantity, 0);
  const totalValueRaw      = visibleHoldings.reduce((s, h) => s + h.currentPrice * h.quantity, 0);
  const totalProfitRaw     = totalValueRaw - totalInvestedRaw;
  const totalProfitRateRaw = totalInvestedRaw > 0 ? (totalProfitRaw / totalInvestedRaw) * 100 : 0;

  // "오늘의 등락" — 상단 "총 손익"(매입가 대비 누적)과 다른 지표임을 분명히 하기 위해
  // 오늘 하루치만 별도 계산한다. changeRate(오늘 등락률)만으로 전일 종가를 역산해
  // (currentPrice = prevClose × (1+changeRate/100)) 새 API 호출 없이 구한다.
  const todayCounts = visibleHoldings.reduce(
    (acc, h) => {
      if (h.changeRate > 0) acc.up++;
      else if (h.changeRate < 0) acc.down++;
      else acc.flat++;
      return acc;
    },
    { up: 0, flat: 0, down: 0 },
  );
  let todayChangeAmount = 0;
  let todayPrevValue = 0;
  for (const h of visibleHoldings) {
    const denom = 1 + h.changeRate / 100;
    if (denom === 0) continue; // 이론상 하한가(-100%)는 없지만 0나눗셈 방어
    todayChangeAmount += (h.currentPrice * h.quantity * (h.changeRate / 100)) / denom;
    todayPrevValue    += (h.currentPrice * h.quantity) / denom;
  }
  const todayChangeRate = todayPrevValue > 0 ? (todayChangeAmount / todayPrevValue) * 100 : 0;

  const totalInvestedAnim   = useCountUp(totalInvestedRaw);
  const totalValueAnim      = useCountUp(totalValueRaw);
  const totalProfitAnim     = useCountUp(totalProfitRaw);
  const totalProfitRateAnim = useCountUp(totalProfitRateRaw);

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

  const isUp = totalProfitRateRaw >= 0;
  const atLimit = holdings.length >= limit;

  const reportReady = streamFinished && !stage2Failed;

  return (
    <div className="pb-8">
      <PageBackground />
      <div className="max-w-[1200px] mx-auto px-4 pt-8">

        <div className="mb-6">
          <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">대시보드</p>
          <h1 className="text-[22px] font-bold text-white">내 보유 종목</h1>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="border rounded-2xl p-4" style={{ background: '#1a1f2e', borderColor: '#334155' }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">총 투자금</p>
            <p className="text-xl font-bold font-mono text-white">{fmt(Math.round(totalInvestedAnim))}원</p>
          </div>
          <div className="border rounded-2xl p-4" style={{ background: '#1a1f2e', borderColor: '#334155' }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">평가금액</p>
            <p className="text-xl font-bold font-mono text-white">{fmt(Math.round(totalValueAnim))}원</p>
          </div>
          <div className="border rounded-2xl p-4" style={{ background: isUp ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)', borderColor: isUp ? 'rgba(239,68,68,0.4)' : 'rgba(59,130,246,0.4)' }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">총 손익</p>
            <p className={`text-xl font-bold font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>{totalProfitAnim >= 0 ? '+' : ''}{fmt(Math.round(totalProfitAnim))}원</p>
          </div>
          <div className="border rounded-2xl p-4" style={{ background: isUp ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)', borderColor: isUp ? 'rgba(239,68,68,0.4)' : 'rgba(59,130,246,0.4)' }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">수익률</p>
            <p className={`text-xl font-bold font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(totalProfitRateAnim)}</p>
          </div>
        </div>

        {/* 오늘의 등락 — 위 "총 손익"(매입가 대비 누적)과 다른 지표임을 라벨·캡션으로
            분명히 구분한다. 얇은 가로 스트립 하나로만 두고 별도 큰 카드는 만들지 않는다.
            다른 카드들과 톤이 같아 눈에 안 띄는 문제를 오늘 등락 부호에 반응하는 은은한
            색 글로우로 해결(상승=빨강/하락=파랑, 앱의 기존 손익 컨벤션과 그대로 연결) —
            하락 쪽은 사용자 피드백으로 강도를 더 올렸다(배경 0.07→0.14, 테두리 0.22→0.4).
            "AI 종합평가" 카드의 대각선 그라데이션 어휘를 재사용하되 톱바 등은 빼서 톤 다운. */}
        <div
          className="rounded-2xl px-5 py-4 mb-4"
          style={
            todayChangeAmount >= 0
              ? { background: 'linear-gradient(135deg, rgba(248,113,113,0.07) 0%, #171b28 55%)', border: '1px solid rgba(248,113,113,0.22)' }
              : { background: 'linear-gradient(135deg, rgba(96,165,250,0.14) 0%, #171b28 60%)', border: '1px solid rgba(96,165,250,0.4)' }
          }
        >
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2.5">오늘의 등락 · 전일 종가 대비</p>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-baseline gap-2">
              <span className={`text-xl font-bold font-mono ${todayChangeAmount >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                {todayChangeAmount >= 0 ? '+' : ''}{fmt(Math.round(todayChangeAmount))}원
              </span>
              <span className={`text-[13px] font-bold font-mono ${todayChangeAmount >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                {fmtR(todayChangeRate)}
              </span>
            </div>
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <span className="text-[14px] font-bold font-mono text-red-400">{todayCounts.up}</span>
                <span className="text-[11px] text-slate-400">상승</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                <span className="text-[14px] font-bold font-mono text-slate-400">{todayCounts.flat}</span>
                <span className="text-[11px] text-slate-400">보합</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <span className="text-[14px] font-bold font-mono text-blue-400">{todayCounts.down}</span>
                <span className="text-[11px] text-slate-400">하락</span>
              </div>
            </div>
          </div>
        </div>

        {/* 투자 분석 요약 */}
        <div className="mb-2">
          <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest`}>투자 분석 요약</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <AllocationDonutChart holdings={visibleHoldings} />
          <SectorAllocationDonutChart holdings={visibleHoldings} />
          <div className="md:col-span-2">
            <ReturnBarChart holdings={visibleHoldings} />
          </div>
          <div className="md:col-span-2">
            <MonthlyReturnLineChart monthly={monthlyData} daily={dailyData} />
          </div>
        </div>

        {/* 보유 종목 카드 그리드 — 숨긴 종목은 여기서 빠지지만 등록 한도(N/한도)는
            숨김 여부와 무관하게 전체 등록 개수 기준이라 holdings.length를 그대로 쓴다. */}
        <div className="mb-2 flex items-center gap-2">
          <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest`}>보유 종목 ({holdings.length}/{limit})</p>
          {hiddenHoldings.length > 0 && (
            <span className="text-[10px] text-slate-600">(숨김 {hiddenHoldings.length}개 포함)</span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {orderedHoldings.map(h => {
            const value = h.currentPrice * h.quantity;
            const invested = h.avg_price * h.quantity;
            const profitRate = h.avg_price > 0 ? ((h.currentPrice - h.avg_price) / h.avg_price) * 100 : 0;
            const up = profitRate >= 0;
            const todayUp = h.changeRate >= 0;
            const fiveDayChange = riskData.find(r => r.ticker === h.ticker)?.fiveDayChange ?? null;
            return (
              <div
                key={h.ticker}
                className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${h.hidden ? 'opacity-50 grayscale' : ''}`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/stock/${h.ticker}`} className="text-[14px] font-semibold text-white hover:text-indigo-300 transition-colors truncate">
                        {h.name}
                      </Link>
                      <span className="text-[10px] font-semibold text-slate-500 border border-slate-700 rounded px-1.5 py-0.5 shrink-0">
                        {h.market === 'kr' ? '국내' : '해외'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">{h.ticker} · {h.quantity}주 · 매입가 {fmt(h.avg_price)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {h.hidden ? (
                      <button
                        onClick={() => setHoldingHidden(h.ticker, false)}
                        title="다시 보이기"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        다시 보이기
                      </button>
                    ) : (
                      <>
                        {dividendData[h.ticker]?.latestDividend && (
                          <IconTip label="배당현황">
                            <button
                              onClick={() => setDividendModal({ ticker: h.ticker, name: h.name })}
                              aria-label="배당현황"
                              className="p-1.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors cursor-pointer"
                            >
                              <Coins className="w-3.5 h-3.5" />
                            </button>
                          </IconTip>
                        )}
                        <IconTip label={marketOpen ? 'AI 분석은 장 마감 후 이용할 수 있습니다' : 'AI 분석'}>
                          <button
                            onClick={() => setAnalysisModal({ ticker: h.ticker, name: h.name, market: h.market })}
                            disabled={marketOpen}
                            aria-label="AI 분석"
                            className="p-1.5 rounded-lg text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </button>
                        </IconTip>
                        <IconTip label="숨기기">
                          <button
                            onClick={() => setHoldingHidden(h.ticker, true)}
                            aria-label="숨기기 (삭제되지 않고 목록·통계에서만 제외됩니다)"
                            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-500/10 transition-colors cursor-pointer"
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                          </button>
                        </IconTip>
                      </>
                    )}
                    <IconTip label="삭제">
                      <button
                        onClick={() => removeHolding(h.ticker)}
                        aria-label="삭제"
                        className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </IconTip>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <span className={STAT_LABEL_CLASS}>현재가</span>
                    <p className="text-[13px] font-mono text-slate-200">{fmt(h.currentPrice)}</p>
                    <p className={`text-[11px] font-mono ${todayUp ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(h.changeRate)}</p>
                  </div>
                  <div>
                    <span className={STAT_LABEL_CLASS}>평가손익</span>
                    <p className={`text-[13px] font-mono font-semibold ${up ? 'text-red-400' : 'text-blue-400'}`}>{value - invested >= 0 ? '+' : ''}{fmt(Math.round(value - invested))}원</p>
                    <p className={`text-[11px] font-mono ${up ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(profitRate)}</p>
                  </div>
                </div>

                {(h.week52High > 0 || h.marketCap || fiveDayChange != null) && (
                  <div className="grid grid-cols-4 gap-3 mb-4 pt-3 border-t border-slate-700/40">
                    {/* 52주 최고/최저는 값이 길어서(최대 7자리 두 개) 4열 중 2열을 차지하게 해서
                        항상 한 줄에 들어가게 함 — 시가총액/5일변동률은 나머지 1열씩. */}
                    {h.week52High > 0 && (
                      <div className="col-span-2">
                        <span className={STAT_LABEL_CLASS}>52주 최고/최저</span>
                        <p className="text-[12px] font-mono text-slate-300 whitespace-nowrap">{fmt(h.week52High)} / {fmt(h.week52Low)}</p>
                      </div>
                    )}
                    {h.marketCap && (
                      <div>
                        <span className={STAT_LABEL_CLASS}>시가총액</span>
                        <p className="text-[12px] font-mono text-slate-300 whitespace-nowrap">{h.marketCap} <span className="text-slate-500">KRW</span></p>
                      </div>
                    )}
                    {fiveDayChange != null && (
                      <div>
                        <span className={STAT_LABEL_CLASS}>5일 변동률</span>
                        <p className={`text-[12px] font-mono font-semibold whitespace-nowrap ${fiveDayChange >= 0 ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(fiveDayChange)}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={() => atLimit ? null : setShowAddForm(true)}
            disabled={atLimit}
            className="flex flex-col items-center justify-center gap-1.5 min-h-[168px] rounded-2xl border border-dashed border-slate-700
              hover:border-indigo-500/40 hover:bg-indigo-500/[0.03] disabled:opacity-40 disabled:cursor-not-allowed
              text-slate-400 hover:text-indigo-300 transition-colors cursor-pointer"
          >
            <Plus className="w-5 h-5" />
            <span className="text-[13px] font-semibold">{atLimit ? `등록 한도(${limit}개) 도달` : '종목 추가'}</span>
          </button>
        </div>
        {atLimit && (
          <p className="text-[11px] text-slate-500 mb-4 text-center">
            더 많은 종목을 등록하려면 <Link href="/pricing" className="text-indigo-400 hover:underline">요금제를 업그레이드</Link>하세요.
          </p>
        )}

        {showAddForm && (
          <Modal title="종목 추가" onClose={() => setShowAddForm(false)} maxWidth="max-w-md">
            <AddHoldingForm onAdded={() => { setShowAddForm(false); loadHoldings(); loadRisk(); loadMonthly(); loadDividend(); }} onCancel={() => setShowAddForm(false)} showCancel />
          </Modal>
        )}

        {analysisModal && (
          <Modal title={`${analysisModal.name} · AI 분석`} onClose={() => setAnalysisModal(null)} maxWidth="max-w-xl">
            {analysisModal.market === 'kr'
              ? <AiAnalysis ticker={analysisModal.ticker} compact />
              : <OverseasAiAnalysis ticker={analysisModal.ticker} market={analysisModal.market} />}
          </Modal>
        )}

        {dividendModal && (() => {
          const info = dividendData[dividendModal.ticker];
          const s = info?.dividendSummary;
          const latest = info?.latestDividend;
          return (
            <Modal title={`${dividendModal.name} · 배당 정보`} onClose={() => setDividendModal(null)} maxWidth="max-w-md">
              {s && (
                <div className="grid grid-cols-3 gap-2.5 mb-4">
                  <div className="bg-slate-800/40 rounded-xl p-3 text-center">
                    <p className="text-[9.5px] text-slate-500 mb-1">배당수익률({s.year})</p>
                    <p className="text-[14px] font-bold font-mono text-slate-200">{s.dividendYield != null ? `${s.dividendYield.toFixed(1)}%` : '-'}</p>
                  </div>
                  <div className="bg-slate-800/40 rounded-xl p-3 text-center">
                    <p className="text-[9.5px] text-slate-500 mb-1">주당배당금</p>
                    <p className="text-[14px] font-bold font-mono text-slate-200">{s.dividendPerShare != null ? `${fmt(s.dividendPerShare)}원` : '-'}</p>
                  </div>
                  <div className="bg-slate-800/40 rounded-xl p-3 text-center">
                    <p className="text-[9.5px] text-slate-500 mb-1">배당성향</p>
                    <p className="text-[14px] font-bold font-mono text-slate-200">{s.payoutRatio != null ? `${s.payoutRatio.toFixed(1)}%` : '-'}</p>
                  </div>
                </div>
              )}
              {latest && (
                <div className="bg-amber-500/[0.06] border border-amber-500/20 rounded-xl p-4">
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wide mb-2.5">최근 배당</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2.5 gap-y-3">
                    <div>
                      <span className="text-[9.5px] text-slate-500 block mb-0.5">기준일</span>
                      <p className="text-[12px] font-mono text-slate-200 font-semibold">{fmtDate(latest.recordDate)}</p>
                    </div>
                    <div>
                      <span className="text-[9.5px] text-slate-500 block mb-0.5">지급일</span>
                      <p className="text-[12px] font-mono text-slate-200 font-semibold">{latest.payDate ? fmtDate(latest.payDate) : '미정'}</p>
                    </div>
                    <div>
                      <span className="text-[9.5px] text-slate-500 block mb-0.5">종류</span>
                      <p className="text-[12px] font-mono text-slate-200 font-semibold">{latest.kindLabel}</p>
                    </div>
                    <div>
                      <span className="text-[9.5px] text-slate-500 block mb-0.5">주당금액</span>
                      <p className="text-[12px] font-mono text-slate-200 font-semibold">{fmt(latest.perShareAmount)}원</p>
                    </div>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-slate-600 mt-3.5 leading-relaxed">
                가장 최근 지급된 배당 기준입니다. 향후 지급을 예측하거나 보장하지 않습니다.
              </p>
            </Modal>
          );
        })()}

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
                <p className="text-[13px] text-amber-200/90 leading-relaxed">AI 종합 평가를 불러오지 못했습니다. 종목별 분석은 위에서 확인하실 수 있습니다.</p>
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
                    if (!sections) return <FieldSkeleton lines={3} />;
                    const blocks = [
                      { key: 'summarySections_background',        label: '구조적 배경', text: sections.background },
                      { key: 'summarySections_newsInterpretation', label: '뉴스 해석',   text: sections.newsInterpretation },
                      { key: 'summarySections_judgment',           label: '종합 판단',   text: sections.judgment },
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
