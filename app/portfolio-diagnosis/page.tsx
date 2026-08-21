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
import DividendMatrix, { type DividendMatrixRow } from '@/components/diagnosis/DividendMatrix';
import ShareDropdown from '@/components/ShareDropdown';
import PageBackground from '@/components/layout/PageBackground';
import AiLoadingOverlay from '@/components/common/AiLoadingOverlay';
import PortfolioPeriodChangeTable from '@/components/stock/PortfolioPeriodChangeTable';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import { formatExcludedHoldingsNote } from '@/lib/dividend-aggregation';
import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { useSmoothTypingText, type RevealedField } from '@/lib/useSmoothTypingText';

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

// 섹터별 최근 뉴스 논조(2단계 UI 노출, 2026-08-21) — news_sentiment_daily는 CURATED_TICKERS_MKT
// (대형주 100종목) 한정이라 보유종목 전체가 아니라 일부만 반영될 수 있다. coveredCount/totalCount로
// "N종목 중 M종목만 반영" 각주를 달고, 데이터 있는 종목이 0개인 섹터는 서버가 애초에 제외한다.
interface SectorSentimentEntry {
  sector:        string;
  label:         '긍정 비중 우세' | '중립·혼조' | '부정 비중 우세';
  coveredCount:  number;
  totalCount:    number;
  positiveCount: number; // 라벨 근거 수치 — "최근 14일 호재성 기사 O건 · 악재성 O건"
  negativeCount: number;
}

// 2026-08-21: "섹터별 최근 뉴스 논조" 카드가 정보 전달력 재검토 대상이 되어 프론트
// 렌더링만 잠시 끈다 — 백엔드(app/api/portfolio-diagnosis/route.ts의 fetchSectorSentiment,
// news_sentiment 크론)는 그대로 유지해 데이터는 계속 쌓인다. 재설계 완료되면 이 플래그만
// true로 되돌릴 것.
const SHOW_SECTOR_SENTIMENT_CARD = false;

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

interface PortfolioSummarySections {
  background: string; newsInterpretation: string; historicalComparison: string; judgment: string;
}

// 2026-08-04: riskFactors가 {text,category} 객체 배열로 구조화됨 — category 없는 옛 문자열
// 항목(과거 리포트/공유 스냅샷)도 그대로 렌더링할 수 있도록 string도 함께 허용.
type RiskFactorEntry = string | { text: string; category?: 'macro' | 'company' };

// 2026-08-04: 배당 정보(합산 배당률 + 월별 캘린더) — lib/dividend-aggregation.ts와 동일 shape.
// 2026-08-05: matrix(종목×월 상세) 추가 — calendar는 과거 공유 리포트 호환용으로 유지.
// 2026-08-05: payingHoldings 필터를 dividendHistory 기준으로 통일하며 excludedHoldings 추가
// — DART 요약만 있고 실제 지급이력 없는 종목(미래에셋증권 사례)도 이제 행에서 제외되므로
// 캡션에 제외 종목명을 보여줄 수 있어야 한다.
interface DividendCalendarEntry { month: number; holdings: { ticker: string; name: string }[] }
interface PortfolioDividendSummary {
  expectedAnnualDividend: number;
  portfolioDividendYield: number | null;
  payingCount: number;
  totalCount: number;
  excludedHoldings: { ticker: string; name: string }[];
  calendar: DividendCalendarEntry[];
  matrix: DividendMatrixRow[];
}

interface PortfolioResult {
  totalInvested:    number;
  totalValue:       number;
  totalProfit:      number;
  totalProfitRate:  number;
  summary:          string;
  summarySections?: PortfolioSummarySections; // 있으면 소제목별 렌더링, 없으면(과거 레코드) summary 문자열로 폴백
  sectors:          Sector[];
  sectorSentiment?: SectorSentimentEntry[];
  holdings:         HoldingResult[];
  riskFactors?:        RiskFactorEntry[];
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
  dividend?: PortfolioDividendSummary | null;
}

// 스트리밍 중 부분적으로만 채워진 상태 — Stage1(종목별)/Stage2(종합) AI 필드는
// 도착 전까지 undefined, meta/holding-meta로 서버가 즉시 계산해 보내는 수치 필드는
// result가 non-null이 되는 시점에 이미 채워져 있다.
type StreamedHolding = Omit<HoldingResult, 'reason' | 'sector'> & {
  reason?: string;
  sector?: string;
};

type StreamedHistory = Omit<PortfolioHistory, 'narrative'> & { narrative?: string };

type StreamedHoldingPeriod = {
  longest: HoldingPeriodEntry | null;
  mostRecent: HoldingPeriodEntry | null;
  narrative?: string;
};

type StreamedResult = Omit<Partial<PortfolioResult>, 'holdings' | 'history' | 'holdingPeriod'> & {
  holdings?: StreamedHolding[];
  history?: StreamedHistory;
  holdingPeriod?: StreamedHoldingPeriod;
};

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

// summarySections_background/newsInterpretation/historicalComparison/judgment 4개
// top-level 키(lib/streaming-json-fields.ts PORTFOLIO_SUMMARY_FIELD_SPECS 참고,
// 2026-08-12 스키마 분리)를 summarySections 하위 필드명으로 되돌리는 매핑 — 이 키로
// 도착한 값(partial 포함)을 prev.summarySections 객체 안에 merge한다
// (app/diagnosis/page.tsx의 MAIN_ANALYSIS_SECTION_KEYS와 동일 패턴).
const SUMMARY_SECTION_KEYS: Record<string, keyof PortfolioSummarySections> = {
  summarySections_background: 'background',
  summarySections_newsInterpretation: 'newsInterpretation',
  summarySections_historicalComparison: 'historicalComparison',
  summarySections_judgment: 'judgment',
};

// Stage2 'portfolio-field(-partial)' 이벤트의 key를 PortfolioResult 형태로 매핑.
// historyNarrative/holdingPeriodNarrative는 중첩 객체 안으로 들어가고, summarySections_*
// 4개는 summarySections 객체 안으로 merge하며, 나머지는 최상위 그대로.
function applyPortfolioField(prev: StreamedResult | null, key: string, value: unknown): StreamedResult {
  const base = prev ?? {};
  if (key === 'historyNarrative') {
    return {
      ...base,
      history: { ...(base.history ?? { daysSince: null, compositionChanged: false, addedTickers: [], removedTickers: [] }), narrative: value as string },
    };
  }
  if (key === 'holdingPeriodNarrative') {
    return {
      ...base,
      holdingPeriod: { ...(base.holdingPeriod ?? { longest: null, mostRecent: null }), narrative: value as string },
    };
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

// ── Sub-components ─────────────────────────────────────────────────────────────

function Card({ title, children, className = '', ...rest }: { title?: string; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`} {...rest}>
      {title && <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-4`}>{title}</p>}
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

// 아직 도착하지 않은 필드 자리에 보여줄 스켈레톤 — components/stock/AiAnalysis.tsx의
// FieldSkeleton과 동일한 패턴.
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

// 문자 단위로 자라나는 중인 필드 끝에 붙는 타이핑 커서
function TypingCursor() {
  return <span className="ml-0.5 text-indigo-300 animate-pulse font-light">▌</span>;
}

// "직전 진단 대비" 카드 — components/diagnosis/DiagnosisReport.tsx의 HistoryCompareCard와
// 동일한 시각 언어 재사용. 델타 수치는 서버가 계산해 넘긴 값을 그대로 표시.
// history 자체는 meta 이벤트로 즉시 오지만 narrative는 Stage2 스트리밍으로 늦게 채워진다.
function PortfolioHistoryCard({ result, revealed, stage2Failed }: { result: StreamedResult; revealed: Record<string, RevealedField>; stage2Failed: boolean }) {
  const h = result.history;
  if (!h) return null;
  const isFirst = h.daysSince === null;
  const label = isFirst
    ? '🔄 첫 포트폴리오 진단'
    : h.daysSince === 1
      ? '🔄 어제 대비'
      : h.daysSince! <= 6
        ? `🔄 ${h.daysSince}일 전 진단 대비`
        : '🔄 오랜만에 재조회';

  const rateDelta   = !isFirst && typeof h.prevTotalProfitRate === 'number' && typeof result.totalProfitRate === 'number' ? result.totalProfitRate - h.prevTotalProfitRate : null;
  const amountDelta = !isFirst && !h.compositionChanged && typeof h.prevTotalProfit === 'number' && typeof result.totalProfit === 'number' ? result.totalProfit - h.prevTotalProfit : null;

  return (
    <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-2xl px-5 py-4 mb-4">
      <p className={`${SECTION_TITLE_CLASS} text-indigo-400 uppercase tracking-wide mb-2`}>{label}</p>
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
      {h.narrative !== undefined ? (
        <p className="text-xs text-slate-300 leading-relaxed">
          {revealed.historyNarrative?.text ?? h.narrative}{revealed.historyNarrative?.active && <TypingCursor />}
        </p>
      ) : (
        !stage2Failed && <FieldSkeleton lines={2} />
      )}
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
  const [error,               setError]               = useState('');
  const [result,      setResult]      = useState<StreamedResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [stage1Complete, setStage1Complete] = useState(false); // 종목별 개별 분석(Stage1) 전부 완료 여부
  const [stage2Failed,   setStage2Failed]   = useState(false); // Stage1은 끝났는데 종합분석(Stage2)만 실패/끊김
  const [streamFinished, setStreamFinished] = useState(false); // done 수신 또는 stage2 실패 확정 — 공유/인쇄 활성화 기준
  // 2026-08-12 클라이언트 측 smooth streaming — Stage1(종목별 reason/sector, 종목마다
  // 병렬 스트리밍이라 `holding:{ticker}:{key}` 키로 종목별 독립 애니메이션)·Stage2
  // (summarySections_* 등) 공통으로 사용. lib/useSmoothTypingText.ts 참고.
  const smoothText = useSmoothTypingText();

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
    setResult(null);
    setStage1Complete(false);
    setStage2Failed(false);
    setStreamFinished(false);
    smoothText.reset();

    // catch 블록에서도 참조해야 해서(네트워크 예외로 스트림 도중 끊긴 경우) try 밖에서 선언
    let sawStage1Complete = false;

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
            } else if (event.type === 'meta') {
              const { type: _t, ...metaFields } = event;
              setLoading(false);
              setResult(prev => ({ ...prev, ...metaFields }));
            } else if (event.type === 'holding-meta') {
              setResult(prev => ({ ...(prev ?? {}), holdings: event.holdings }));
            } else if (event.type === 'holding-field-partial') {
              const { ticker, key, value: v } = event;
              setResult(prev => {
                if (!prev?.holdings) return prev;
                return { ...prev, holdings: prev.holdings.map(h => h.ticker === ticker ? { ...h, [key]: v } : h) };
              });
              smoothText.feed(`holding:${ticker}:${key}`, v);
            } else if (event.type === 'holding-field') {
              const { ticker, key, value: v } = event;
              setResult(prev => {
                if (!prev?.holdings) return prev;
                return { ...prev, holdings: prev.holdings.map(h => h.ticker === ticker ? { ...h, [key]: v } : h) };
              });
              if (typeof v === 'string') smoothText.snap(`holding:${ticker}:${key}`, v);
            } else if (event.type === 'stage1-done') {
              sawStage1Complete = true;
              setStage1Complete(true);
              setResult(prev => ({ ...(prev ?? {}), coMovementText: event.coMovementText }));
            } else if (event.type === 'portfolio-field-partial') {
              const { key, value: v } = event;
              setResult(prev => applyPortfolioField(prev, key, v));
              smoothText.feed(key, v);
            } else if (event.type === 'portfolio-field') {
              const { key, value: v } = event;
              setResult(prev => applyPortfolioField(prev, key, v));
              if (typeof v === 'string') smoothText.snap(key, v);
            } else if (event.type === 'stage2-error') {
              setStage2Failed(true);
              setStreamFinished(true);
              smoothText.snapAll();
            } else if (event.type === 'done') {
              receivedTerminalEvent = true;
              setGeneratedAt(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
              setRemaining(prev => Math.max(0, (prev ?? 1) - 1));
              setStreamFinished(true);
              smoothText.snapAll();
            } else if (event.type === 'error') {
              receivedTerminalEvent = true;
              if (event.message === 'PRO_REQUIRED') setShowUpgradeModal(true);
              else setError(event.message || '분석 실패');
              smoothText.snapAll();
            }
          } catch { /* malformed SSE line 무시 */ }
        }
      }

      if (!receivedTerminalEvent) {
        if (sawStage1Complete) {
          // Stage1은 다 끝났는데 done 없이 스트림만 끊김 — Stage2만 실패한 것으로 보고
          // 종합평가 카드 자리에 배너+재시도를 띄운다(Stage1 결과는 그대로 유지).
          setStage2Failed(true);
          setStreamFinished(true);
        } else {
          setError('분석 중 연결이 끊어졌습니다. 잠시 후 다시 시도해주세요.');
        }
        smoothText.snapAll();
      }
    } catch {
      if (sawStage1Complete) {
        setStage2Failed(true);
        setStreamFinished(true);
      } else {
        setError('네트워크 오류가 발생했습니다.');
      }
      smoothText.snapAll();
    } finally {
      setLoading(false);
      // 위 각 종료 분기에서 이미 snapAll을 호출하지만, 예상 못한 종료 경로가 생기더라도
      // 화면이 타이핑 애니메이션 중간에 멈춰있지 않도록 여기서 한 번 더 보장한다.
      smoothText.snapAll();
    }
  };

  const handleRetry = () => { handleSubmit(); };

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
      <AiLoadingOverlay
        title="AI가 포트폴리오를 분석하고 있습니다..."
        subtitle={loadingLabel || '예상 소요 시간: 30~60초'}
      />
    );
  }

  // ── 초기 실패 (loading도 끝났고 result도 없음) ─────────────────────────────
  // Stage0 실패나 meta 도착 전 연결 끊김 등 스트림이 아무 데이터도 못 준 채
  // 끝난 경우 — 이 분기가 없으면 아래 입력 폼으로 그냥 떨어져 "화면이
  // 이유 없이 되돌아간" 것처럼 보였다(2026-07-27 실사용 버그 리포트).
  if (!loading && !result && error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <PageBackground />
        <div className="bg-[#1a1f2e] border border-red-500/20 rounded-2xl p-8 max-w-sm w-full text-center">
          <p className="text-white font-semibold text-lg mb-2">분석에 실패했습니다</p>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button
            onClick={handleRetry}
            className="w-full py-3 rounded-xl text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-500
              text-white transition-colors cursor-pointer"
          >
            다시 시도
          </button>
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
    // meta 이벤트로 즉시 채워지는 필드들 — result가 non-null이 된 시점에 항상 존재하지만
    // 타입은 Partial이라 폴백을 둔다(실제로 undefined인 경우는 없음).
    const totalInvested   = result.totalInvested ?? 0;
    const totalValue      = result.totalValue ?? 0;
    const totalProfit     = result.totalProfit ?? 0;
    const totalProfitRate = result.totalProfitRate ?? 0;
    const holdingsList    = result.holdings ?? [];
    const topContributors = result.topContributors ?? { n: 0, positive: [], negative: [] };
    const isUp = totalProfitRate >= 0;
    // sectors는 Stage2 완료 시 한 번에 도착 — 그 전엔 undefined
    const sortedSectors = result.sectors ? [...result.sectors].sort((a, b) => b.weight - a.weight) : null;
    const reportReady = streamFinished && !stage2Failed;
    const excludedDividendNote = result.dividend ? formatExcludedHoldingsNote(result.dividend.excludedHoldings) : null;

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
              {reportReady ? (
                <>
                  <ShareDropdown
                    title="AI 포트폴리오 분석 리포트"
                    description={`총 수익률 ${totalProfitRate >= 0 ? '+' : ''}${totalProfitRate.toFixed(2)}% | ${holdingsList.length}개 기업 AI 분석`}
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
                </>
              ) : (
                <span className="text-[11px] text-slate-500">리포트 생성 중...</span>
              )}
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
              value={`${fmt(totalInvested)}원`}
            />
            <MetricCard
              label="평가금액"
              value={`${fmt(totalValue)}원`}
            />
            <MetricCard
              label="총 손익"
              value={`${totalProfit >= 0 ? '+' : ''}${fmt(totalProfit)}원`}
              up={isUp}
              highlight
            />
            <MetricCard
              label="수익률"
              value={fmtR(totalProfitRate)}
              sub={`${holdingsList.length}개 기업`}
              up={isUp}
              highlight
            />
          </div>

          {/* 2행: AI 요약 — 2026-07-27엔 stage1Complete 전까지 이 카드 전체를 숨겼으나(빈
              스켈레톤이 방치된 것처럼 보이는 걸 막기 위함), 그러면서 배당정보·기업별 관찰
              지표처럼 더 빨리 채워지는 아래쪽 섹션들과 "위는 텅 비어있는데 아래는 이미
              끝났다"는 역전 인상이 오히려 남았다(2026-08-11 재조사). 아래 IIFE에 이미
              "데이터 없으면 스켈레톤" 폴백이 있으므로 처음부터 항상 마운트해 다른 AI
              필드 섹션들과 동일한 원칙(제목+스켈레톤을 먼저 그려두고 도착하면 그 자리에서
              채움)을 따르게 한다. Stage2 필드는 백엔드에서 stage1-done 이후에만 전송되므로
              (route.ts — Promise.all(analyzeOneStock) 완료 후 Stage2 시작) 이 게이트를
              없애도 Stage1 완료 전에 Stage2 내용이 새어 보일 위험은 없다. */}
          {(stage2Failed ? (
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-6 py-5 mb-4">
              <div className="flex items-start gap-2.5">
                <span className="text-amber-400 text-sm mt-0.5 shrink-0">ⓘ</span>
                <p className="text-[13px] text-amber-200/90 leading-relaxed">
                  AI 종합 평가를 불러오지 못했습니다. 기업별 개별 분석 결과는 아래에서 확인하실 수 있습니다.
                </p>
              </div>
              <button
                onClick={handleRetry}
                className="flex items-center gap-1.5 shrink-0 px-4 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25
                  border border-amber-500/30 text-amber-300 text-[12px] font-semibold transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 다시 시도
              </button>
            </div>
          ) : (
            <div
              className="rounded-2xl border border-indigo-500/25 overflow-hidden mb-4"
              style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}
            >
              <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
              <div className="px-8 py-6">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <p className={`${SECTION_TITLE_CLASS} text-indigo-400/70 uppercase tracking-widest`}>AI 종합 평가</p>
                </div>
                {(() => {
                  const sections = result.summarySections;
                  const hasSections = sections && Object.values(sections).some(Boolean);
                  if (hasSections) {
                    // 2026-08-12: summarySections를 4개의 독립 string 필드로 스키마 분리(서버가
                    // summarySections_background 등 4개 top-level 필드를 스트리밍하고, 클라이언트가
                    // 다시 이 객체로 merge — applyPortfolioField 참고)한 덕분에 institutionalFlow와
                    // 동일한 패턴(글자 있으면 표시+커서, 아직 생성 중이면 스켈레톤, 완료 후에도
                    // 비어있으면(선택 필드) 숨김)으로 4블록을 각각 독립적으로 타이핑 렌더링한다.
                    const blocks = [
                      { key: 'summarySections_background',          label: '구조적 배경',   text: sections.background },
                      { key: 'summarySections_newsInterpretation',   label: '뉴스 해석',     text: sections.newsInterpretation },
                      { key: 'summarySections_historicalComparison', label: '과거 유사 이력', text: sections.historicalComparison },
                      { key: 'summarySections_judgment',             label: '종합 판단',     text: sections.judgment },
                    ];
                    return (
                      <div className="flex flex-col gap-4">
                        {blocks.map((b) => (
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
                  }
                  if (result.summary !== undefined) {
                    // 2026-08-03 이전 방식 폴백 — summarySections가 없을 때(예상 밖 실패
                    // 케이스 등)만 예전처럼 문장 2개씩 묶어 단락처럼 보여준다.
                    return (
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
                            <p key={i} className="text-xs text-slate-300" style={{ lineHeight: 1.8 }}>
                              {group.join(' ')}
                            </p>
                          ))
                        }
                      </div>
                    );
                  }
                  return <FieldSkeleton lines={4} />;
                })()}
              </div>
            </div>
          ))}

          {/* 2-1행: 직전 진단 대비 (신설) */}
          <PortfolioHistoryCard result={result} revealed={smoothText.revealed} stage2Failed={stage2Failed} />

          {/* 2-2행: 기간별 포트폴리오 평가금액 변동 (신설, 종목분석 PriceChangeTable과
              동일 lib 함수 재사용) — AI 텍스트를 기다리지 않고 holdings/totalValue가
              도착하는 즉시 독립적으로 로딩된다 */}
          <PortfolioPeriodChangeTable
            holdings={(result.holdings ?? []).map(h => ({ ticker: h.ticker, name: h.name, quantity: h.quantity }))}
            currentTotalValue={result.totalValue ?? 0}
          />

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

          {/* 3행: 섹터 편중도 — Stage2 완료 시 한 번에 도착(부분 표시 없음) */}
          {sortedSectors === null ? (
            !stage2Failed && (
              <Card title="섹터 편중도 분석" className="mb-4">
                <FieldSkeleton lines={4} />
              </Card>
            )
          ) : (
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
          )}

          {/* 3-0-1행: 섹터별 최근 뉴스 논조(2026-08-21 신설) — news_sentiment_daily가
              CURATED_TICKERS_MKT(대형주 100종목) 한정이라 보유종목 전체가 아니라 일부만
              반영될 수 있어 "섹터 편중도 분석"과 카드를 분리했다(그 카드 바 색상이 이미
              "과집중" 경고로 쓰이고 있어 같은 카드에 얹으면 혼동 위험). 데이터 있는 섹터가
              하나도 없으면 카드 자체를 생략한다. */}
          {SHOW_SECTOR_SENTIMENT_CARD && result.sectorSentiment && result.sectorSentiment.length > 0 && (
            <Card title="섹터별 최근 뉴스 논조" className="mb-4">
              <div className="flex flex-col gap-3">
                {result.sectorSentiment.map((s) => (
                  <div key={s.sector} className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[13px] text-slate-300 font-medium">{s.sector}</span>
                      <span className="text-[10.5px] text-slate-600 mt-0.5">
                        보유 {s.totalCount}종목 중 {s.coveredCount}종목 데이터 반영
                      </span>
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-3">
                      <span className="text-[12px] font-semibold text-indigo-300">{s.label}</span>
                      {/* 라벨만으로는 구분이 안 된다는 실사용 피드백(2026-08-21) 대응 —
                          최근 14일 기사 건수를 근거로 함께 노출 */}
                      <span className="text-[10.5px] text-slate-600 mt-0.5">
                        호재성 {s.positiveCount}건 · 악재성 {s.negativeCount}건
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 mt-4">
                보유 종목이 속한 섹터의 최근 뉴스 논조 참고 수치이며, 비중 조정을 권유하는 지표가 아닙니다.
              </p>
            </Card>
          )}

          {/* 3-1행: 배당 정보(합산 배당률 + 월별 캘린더, 2026-08-04 신설) — meta 이벤트로
              즉시 도착하는 서버 계산값(AI 아님), 전체 무배당이면 result.dividend가 null이라
              섹션 자체를 렌더링하지 않는다. */}
          {result.dividend && (
            <Card title="배당 정보" className="mb-4">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-4">
                <div className="bg-slate-800/40 rounded-xl p-3 text-center sm:min-w-[140px]">
                  <p className="text-[10px] text-slate-500 mb-1">합산 배당률</p>
                  <p className="text-[17px] font-bold font-mono text-slate-200">
                    {result.dividend.portfolioDividendYield !== null
                      ? `${result.dividend.portfolioDividendYield.toFixed(2)}%`
                      : '-'}
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="text-[10px] text-slate-600 leading-relaxed">
                    최근 확정 배당 기준 · 예상 연간 배당금 {result.dividend.expectedAnnualDividend.toLocaleString()}원
                  </p>
                  <p className="text-[10.5px] text-slate-400 leading-relaxed mt-1">
                    {result.dividend.totalCount}개 종목 중 {result.dividend.payingCount}개만 배당 이력 있음
                    {excludedDividendNote && ` (${excludedDividendNote} 제외)`}
                    {' '}(미래 지급을 보장하지 않음)
                  </p>
                </div>
              </div>

              <DividendMatrix rows={result.dividend.matrix} />
              <p className="text-[10px] text-slate-600 mt-2">
                최근 5년 배당 지급 이력 기준 — 칸을 클릭하면 해당 종목·월의 연도별 지급일과 금액을 볼 수 있습니다. 향후 지급을 예측하거나 보장하지 않습니다
              </p>
            </Card>
          )}

          {/* 3-2행: 오늘 손익 기여도 + 섹터 co-movement (신설, 데이터 있을 때만) */}
          {((topContributors.positive.length ?? 0) > 0 || (topContributors.negative.length ?? 0) > 0 || result.coMovementText) && (
            <div className={`grid grid-cols-1 ${result.coMovementText ? 'md:grid-cols-2' : ''} gap-4 mb-4`}>
              {(topContributors.positive.length > 0 || topContributors.negative.length > 0) && (
                <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
                  <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-1`}>
                    오늘 손익 영향이 가장 큰 {topContributors.n}종목
                  </p>
                  <p className="text-[10px] text-slate-600 mb-3">전체 종목의 누적 수익률은 아래 &quot;기업별 관찰 지표&quot;를 참고하세요 — 여기는 오늘 하루 변화만 다룹니다</p>
                  {/* 금액은 서버 계산값을 그대로 표시(AI가 옮겨 적지 않음) — 아래 문장은 해석만 */}
                  <div className="flex flex-col gap-1.5 mb-3">
                    {topContributors.positive.map(c => (
                      <div key={c.ticker} className="flex items-center justify-between">
                        <span className="text-[12px] text-slate-400">{c.name}</span>
                        <span className="text-[13px] font-bold font-mono text-red-400">{c.amount >= 0 ? '+' : ''}{fmt(c.amount)}원</span>
                      </div>
                    ))}
                    {topContributors.negative.map(c => (
                      <div key={c.ticker} className="flex items-center justify-between">
                        <span className="text-[12px] text-slate-400">{c.name}</span>
                        <span className="text-[13px] font-bold font-mono text-blue-400">{fmt(c.amount)}원</span>
                      </div>
                    ))}
                  </div>
                  {result.contributionNarrative !== undefined ? (
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {smoothText.revealed.contributionNarrative?.text ?? result.contributionNarrative}{smoothText.revealed.contributionNarrative?.active && <TypingCursor />}
                    </p>
                  ) : (
                    !stage2Failed && <FieldSkeleton lines={1} />
                  )}
                </div>
              )}
              {result.coMovementText && (
                <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
                  <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-3`}>섹터 동조화 관찰</p>
                  <p className="text-[11px] text-slate-500 mb-2">{result.coMovementText}</p>
                  {result.coMovementNarrative !== undefined ? (
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {smoothText.revealed.coMovementNarrative?.text ?? result.coMovementNarrative}{smoothText.revealed.coMovementNarrative?.active && <TypingCursor />}
                    </p>
                  ) : (
                    !stage2Failed && <FieldSkeleton lines={1} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4행: 기업별 관찰 지표 — 카드 위치는 입력 순서 고정, 내용(섹터/사유)은 완료되는 대로 채움 */}
          <Card title={stage1Complete ? '기업별 관찰 지표' : '기업별 관찰 지표 (분석 중...)'} className="mb-4">
            <div className="flex flex-col divide-y divide-slate-700/40">
              {holdingsList.map(h => {
                const hUp = h.profitRate >= 0;
                // 종목별로 병렬 스트리밍되므로 holding:{ticker}:{key} 키로 서로 독립적으로 애니메이션.
                const revealedSector = smoothText.revealed[`holding:${h.ticker}:sector`];
                const revealedReason = smoothText.revealed[`holding:${h.ticker}:reason`];
                const sectorText = revealedSector?.text ?? h.sector;
                const reasonText = revealedReason?.text ?? h.reason;
                const sectorTyping = revealedSector?.active ?? false;
                const reasonTyping = revealedReason?.active ?? false;
                return (
                  <div key={h.ticker} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3 flex-wrap md:flex-nowrap">
                      {/* 종목 */}
                      <div className="w-full md:w-40 shrink-0">
                        <p className="text-[14px] font-semibold text-white leading-tight">{h.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono">
                          {h.ticker}{sectorText !== undefined ? ` · ${sectorText}` : ''}
                          {sectorTyping && <TypingCursor />}
                        </p>
                        <Link
                          href={`/stock/${h.ticker}`}
                          className="mt-1.5 w-fit inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-400/30 rounded-full px-4 py-1.5 whitespace-nowrap transition-colors"
                        >
                          자세히 보기 →
                        </Link>
                      </div>
                      {/* 종목 */}
                      {/* 내용 */}
                      <div className="w-full">
                        <div className="flex w-full">
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
                      
                      {h.reason !== undefined ? (
                        h.reason && (
                          <div className="mt-2 pl-0 w-full">
                            <p className="text-xs  text-sky-100/60 leading-relaxed">
                              {reasonText}{reasonTyping && <TypingCursor />}
                            </p>
                            {!reasonTyping && (
                              <p className="mt-2 text-[11px] text-slate-500">
                                더 자세한 분석은 자세히 보기에서 확인하세요
                              </p>
                            )}
                          </div>
                        )
                      ) : (
                        <div className="mt-1 pl-0 md:pl-44"><FieldSkeleton lines={2} /></div>
                      )}
                      {h.mdd != null && (
                        <p className="text-[11px] text-slate-500 pl-0">
                          최근 3개월 최대 {h.mdd.toFixed(1)}% 하락 이력
                        </p>
                      )}
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 4-1행: 포트폴리오 Risk Factors + Opportunity Factors (대칭 구조) — 둘 다
              Stage2 필드라 도착 전엔 undefined. 미도착(pending)이면 스켈레톤으로 자리를
              잡아두고, 도착했는데 빈 배열이면(진짜로 없음) 그 카드만 조용히 생략한다 —
              배당정보처럼 "확정된 부재"로 취급(2026-08-11). */}
          {(result.riskFactors !== undefined || result.opportunityFactors !== undefined || !stage2Failed) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {(result.riskFactors === undefined ? !stage2Failed : result.riskFactors.length > 0) && (
                <div className="bg-[#1a1f2e] border border-red-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
                      Risk Factors
                    </span>
                  </div>
                  {result.riskFactors === undefined ? (
                    <FieldSkeleton lines={3} />
                  ) : (
                    <div className="flex flex-col gap-2">
                      {result.riskFactors.map((item, i) => {
                        const text = typeof item === 'string' ? item : item.text;
                        const category = typeof item === 'string' ? undefined : item.category;
                        return (
                          <div key={i} className="flex gap-2">
                            <span className="text-red-500/60 text-[10px] mt-1 shrink-0">▶</span>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {category && (
                                <span className="mr-1.5 inline-block px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-400 text-[9px] font-bold uppercase tracking-wide align-middle">
                                  {category === 'macro' ? '매크로' : '기업'}
                                </span>
                              )}
                              {text}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {(result.opportunityFactors === undefined ? !stage2Failed : result.opportunityFactors.length > 0) && (
                <div className="bg-[#1a1f2e] border border-emerald-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
                      Opportunity Factors
                    </span>
                  </div>
                  {result.opportunityFactors === undefined ? (
                    <FieldSkeleton lines={3} />
                  ) : (
                    <div className="flex flex-col gap-2">
                      {result.opportunityFactors.map((line, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="text-emerald-500/60 text-[10px] mt-1 shrink-0">▶</span>
                          <p className="text-xs text-slate-300 leading-relaxed">{line}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4-2행: 포트폴리오 단기/중기 전망 — Risk/Opportunity와 동일한 3분기 패턴
              (미도착=스켈레톤, 도착+내용있음=텍스트, 도착+빈 문자열=조용히 생략). */}
          {(result.shortTermOutlook !== undefined || result.midTermOutlook !== undefined || !stage2Failed) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {(result.shortTermOutlook === undefined ? !stage2Failed : !!result.shortTermOutlook) && (
                <div className="bg-[#1a1f2e] border border-indigo-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
                      단기 관찰 변수
                    </span>
                  </div>
                  {result.shortTermOutlook === undefined ? (
                    <FieldSkeleton lines={2} />
                  ) : (
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {smoothText.revealed.shortTermOutlook?.text ?? result.shortTermOutlook}{smoothText.revealed.shortTermOutlook?.active && <TypingCursor />}
                    </p>
                  )}
                </div>
              )}
              {(result.midTermOutlook === undefined ? !stage2Failed : !!result.midTermOutlook) && (
                <div className="bg-[#1a1f2e] border border-violet-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
                      중기 관찰 변수
                    </span>
                  </div>
                  {result.midTermOutlook === undefined ? (
                    <FieldSkeleton lines={2} />
                  ) : (
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {smoothText.revealed.midTermOutlook?.text ?? result.midTermOutlook}{smoothText.revealed.midTermOutlook?.active && <TypingCursor />}
                    </p>
                  )}
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
              {result.holdingPeriod.narrative !== undefined ? (
                <p className="text-xs text-slate-300 leading-relaxed">
                  {smoothText.revealed.holdingPeriodNarrative?.text ?? result.holdingPeriod.narrative}{smoothText.revealed.holdingPeriodNarrative?.active && <TypingCursor />}
                </p>
              ) : (
                !stage2Failed && <FieldSkeleton lines={2} />
              )}
            </Card>
          )}

          {/* 면책 */}
          <p className="text-[11px] text-slate-600 text-center leading-relaxed mb-6 px-4">
            본 리포트는 투자 판단에 참고할 수 있는 정보를 제공할 뿐, 투자자문이나 매매 권유가 아닙니다.
            투자 결정과 그 결과에 대한 책임은 투자자 본인에게 있습니다.
          </p>

          <button
            onClick={() => {
              setResult(null);
              setStage1Complete(false);
              setStage2Failed(false);
              setStreamFinished(false);
              smoothText.reset();
            }}
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
