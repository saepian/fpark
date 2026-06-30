'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import {
  Sparkles, Plus, Trash2, Search, ChevronLeft,
  Printer, TrendingUp, TrendingDown, BookMarked, Lock,
} from 'lucide-react';
import DiagnosisSidebar from '@/components/diagnosis/DiagnosisSidebar';
import ShareDropdown from '@/components/ShareDropdown';
import PageBackground from '@/components/layout/PageBackground';

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
    if (!isPro) { setShowUpgradeModal(true); return; }
    if (remaining === 0) { setError('이번 달 사용 한도(30회)를 초과했습니다.'); return; }

    const valid = holdings.filter(h => h.ticker && h.avgPrice && h.quantity);
    if (valid.length === 0) { setError('종목·매수가·수량을 하나 이상 입력해주세요.'); return; }

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
              setResult(event.data);
              setGeneratedAt(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
              setRemaining(prev => Math.max(0, (prev ?? 1) - 1));
            } else if (event.type === 'error') {
              if (event.message === 'PRO_REQUIRED') setShowUpgradeModal(true);
              else setError(event.message || '분석 실패');
            }
          } catch { /* malformed SSE line 무시 */ }
        }
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
            onClick={() => { setShowUpgradeModal(false); router.push('/pricing'); }}
            className="w-full py-3 rounded-xl text-[13px] font-semibold
              bg-gradient-to-r from-indigo-600 to-violet-600
              hover:from-indigo-500 hover:to-violet-500
              text-white transition-all cursor-pointer"
          >
            요금제 보기 →
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
      <div className="pb-8">
        <PageBackground />
        {showUpgradeModal && <UpgradeModal />}
        <div className="max-w-5xl mx-auto px-4 pt-8">

          {/* Header */}
          <div className="flex items-start justify-between mb-6 gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">
                AI 포트폴리오 진단 리포트
              </p>
              <h1 className="text-[22px] font-bold text-white">포트폴리오 진단 리포트</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">리포트 생성: {generatedAt}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 mt-1 no-print">
              <ShareDropdown
                title="AI 포트폴리오 진단 리포트"
                description={`총 수익률 ${result.totalProfitRate >= 0 ? '+' : ''}${result.totalProfitRate.toFixed(2)}% | ${result.holdings.length}개 종목 AI 분석`}
                hashtags="fpark,주식,포트폴리오,AI진단"
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
              sub={`${result.holdings.length}개 종목`}
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

          {/* 5행: 포트폴리오 개선 제안 (전체 펼침) */}
          <Card title="포트폴리오 개선 제안" className="mb-4" data-suggestions-section>
            <div className="flex flex-col gap-3" data-suggestions-list>
              {(result.suggestions ?? []).filter(Boolean).map((s, i) => (
                <div key={i} data-suggestions-item className="flex items-start gap-3 bg-slate-800/40 rounded-xl px-4 py-3">
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
                    <div className="px-4 py-3 text-[12px] text-slate-500">관심종목이 없습니다</div>
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
