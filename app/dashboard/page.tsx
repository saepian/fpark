'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import { Plus, Trash2, Search, Sparkles, EyeOff, Eye, Coins, Pencil } from 'lucide-react';
import PageBackground from '@/components/layout/PageBackground';
import AiLoadingOverlay from '@/components/common/AiLoadingOverlay';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { isKoreanMarketOpen, isKoreanMarketPreOpen } from '@/lib/market-utils';
import { useCountUp } from '@/lib/use-count-up';
import AiAnalysis from '@/components/stock/AiAnalysis';
import OverseasAiAnalysis from '@/components/stock/OverseasAiAnalysis';
import { AllocationDonutChart, ReturnBarChart, MonthlyReturnLineChart, SectorAllocationDonutChart, type RiskPoint, type MonthlyPoint } from '@/components/dashboard/DashboardCharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchItem { ticker: string; name: string }

interface HoldingRow {
  id: string; ticker: string; name: string; market: string;
  avg_price: number; buy_date: string | null; quantity: number;
  // KIS 시세 조회 실패 시 null — quoteFailed로 명시적으로 구분한다(0/''과 혼동 방지).
  currentPrice: number | null; changeRate: number | null;
  week52High: number | null; week52Low: number | null; marketCap: string | null;
  per: number | null; pbr: number | null;
  sector: string | null;
  hidden: boolean;
  quoteFailed?: boolean;
}

interface DividendInfo {
  ticker: string;
  dividendSummary: { year: string; dividendYield: number | null; dividendPerShare: number | null; payoutRatio: number | null } | null;
  latestDividend: { recordDate: string; payDate: string | null; kind: '분기' | '결산'; kindLabel: string; perShareAmount: number } | null;
}

// /api/dashboard/monthly-returns가 lib/market-day-context.ts(getDomesticMarketDayContext)로
// 계산해 내려주는 결과 그대로의 shape(서버가 이미 조회해둔 차트 데이터 재사용, 새 KIS 호출
// 없음) — "오늘의 등락" 위젯이 비거래일(주말·공휴일)에 마지막 거래일 데이터를 "오늘"인
// 것처럼 라벨링하던 문제 수정용(2026-08-31).
interface MarketDayInfo {
  isTradingDay: boolean;
  lastTradingDate: string;
  daysSinceLastTradingDate: number;
  reason: 'weekend' | 'holiday' | null;
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number)  { return n.toLocaleString(); }
function fmtR(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }
function fmtDate(d: string) { return d.replaceAll('-', '.'); }

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
// "YYYY-MM-DD" → "8월29일(금)" — "오늘의 등락" 위젯이 비거래일에 실제 기준일을 밝힐 때 사용.
function fmtMarketDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = WEEKDAY_KO[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월${d}일(${weekday})`;
}

// 종목카드 내부 통계 라벨(현재가/평가손익/52주 최고·최저/시가총액/5일변동률) — 색상
// 차이만으로는 다크테마에서 라벨과 값이 잘 구분되지 않아 옅은 배경의 배지 형태로 분리.
const STAT_LABEL_CLASS = 'inline-block text-[11px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-800/60 rounded px-1.5 py-0.5 mb-1';

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
          rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 shadow-lg
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

// initial이 있으면 "수정" 모드 — 기존 보유종목의 매입가·수량·매입일을 고치는 용도라
// 종목 자체(ticker)는 바꿀 수 없게 검색창을 잠근다(POST가 동일 ticker면 upsert하는
// 기존 서버 로직을 그대로 재사용 — app/api/dashboard/holdings/route.ts 참고).
function AddHoldingForm({ onAdded, onCancel, showCancel, initial }: {
  onAdded: () => void; onCancel?: () => void; showCancel: boolean;
  initial?: { ticker: string; name: string; avgPrice: string; quantity: string; buyDate: string };
}) {
  const isEdit = !!initial;
  const [ticker, setTicker]   = useState(initial?.ticker ?? '');
  const [name, setName]       = useState(initial?.name ?? '');
  const [q, setQ]             = useState(initial?.name ?? '');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [open, setOpen]       = useState(false);
  const [avgPrice, setAvgPrice] = useState(initial?.avgPrice ?? '');
  const [quantity, setQuantity] = useState(initial?.quantity ?? '');
  const [buyDate, setBuyDate]   = useState(initial?.buyDate ?? '');
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
      if (!res.ok) { setFormError(data.error || (isEdit ? '수정에 실패했습니다.' : '등록에 실패했습니다.')); return; }
      if (!isEdit) { setTicker(''); setName(''); setQ(''); setAvgPrice(''); setQuantity(''); setBuyDate(''); }
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
        <div className={`flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2.5 ${isEdit ? 'opacity-70' : ''}`}>
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          {isEdit ? (
            <span className="text-sm text-white">{name} <span className="text-slate-500 text-xs font-mono">{ticker}</span></span>
          ) : (
            <input
              value={q}
              onChange={e => search(e.target.value)}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder="기업명 또는 종목코드 검색"
              className="bg-transparent text-sm text-white placeholder:text-slate-600 outline-none w-full"
            />
          )}
        </div>
        {!isEdit && open && (
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
          <p className="text-[11px] text-slate-500 mb-1">매수가(원)</p>
          <input
            value={avgPrice}
            onChange={e => setAvgPrice(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="70000"
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <p className="text-[11px] text-slate-500 mb-1">수량</p>
          <input
            value={quantity}
            onChange={e => setQuantity(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="10"
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <p className="text-[11px] text-slate-500 mb-1">매수일 (선택)</p>
          <input
            type="date"
            value={buyDate}
            onChange={e => setBuyDate(e.target.value)}
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50 [color-scheme:dark]"
          />
        </div>
      </div>
      {/* buyDate 입력률이 낮아(11.6%) 벤치마크·보유기간 분석이 대부분 안 뜨던 상태였다
          (2026-08-26 조사) — 필수화 대신 이득을 짧게 안내해 자발적 입력을 유도한다. */}
      {!buyDate && (
        <p className="text-[11px] text-indigo-400/80 -mt-1.5">
          💡 입력하면 보유기간별 관점·벤치마크 비교를 함께 볼 수 있어요
        </p>
      )}
      {formError && <p className="text-[12px] text-red-400">{formError}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors cursor-pointer"
        >
          {submitting ? (isEdit ? '저장 중...' : '등록 중...') : (isEdit ? '저장' : '종목 등록')}
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
  // 종목별 AI 분석 버튼의 활성 구간을 "장마감~자정"으로 끊기 위한 추가 조건 — 자정부터
  // 다음 장이 열리기 전까지는 marketOpen이 false여도 다시 비활성화한다(2026-08-31,
  // 8/14 재열람버그 수정 때 aiAnalysisUsedToday를 없애며 marketOpen만 남아 장마감 후
  // 다음 장 열릴 때까지 계속 활성 상태로 남아있던 문제).
  const [afterMidnight, setAfterMidnight] = useState(false);

  const lastUpdatedRef   = useRef<Date | null>(null);
  const isRefreshingRef  = useRef(false);
  // 2026-08-28: isRefreshingRef가 폴링끼리 안 겹치게 막는 건 맞지만, 그 사이에 들어온
  // "진짜 새로고침이 필요한" 호출(예: 편집 모달 저장 직후 loadHoldings())까지 조용히
  // 버려지는 레이스컨디션이 있었다(8/26 buyDate 편집기능 검증 중 발견 — 저장 직후 연필
  // 아이콘 색이 안 바뀌고 새로고침해야 반영됨). 진행 중인 요청과 겹치면 무시하는 대신
  // "끝나면 한 번 더 실행"으로 큐잉해 폴링 중복 방지 목적은 그대로 유지하면서도 어떤
  // 호출도 완전히 유실되지 않게 한다.
  const refreshPendingRef = useRef(false);
  // 숨기기/다시 보이기 연타 레이스컨디션 방지용(2026-08-31 오픈 전 QA에서 실측 재현 —
  // 종목별 PATCH를 순서 보장 없이 fire-and-forget으로 쏘던 탓에, 5연타(숨김→보임→숨김→
  // 보임→숨김) 직후엔 UI가 마지막 클릭대로 "숨김"을 보여줘도 네트워크 왕복 순서가 뒤바뀌어
  // DB엔 더 이전 클릭의 값("보임")이 최종 저장되는 경우가 있었다 — 새로고침하면 되돌아감).
  // setHoldingHidden 참고.
  const hidingChainRef = useRef<Record<string, Promise<unknown>>>({});
  const hidingSeqRef   = useRef<Record<string, number>>({});

  // AI 분석
  // 종목별 AI 분석 모달 — 카드 내부 펼침 대신 모달로 띄운다(카드 그리드가 한 카드만
  // 확장되며 레이아웃이 깨지는 걸 방지).
  const [analysisModal, setAnalysisModal] = useState<{ ticker: string; name: string; market: string } | null>(null);
  const [dividendModal, setDividendModal] = useState<{ ticker: string; name: string } | null>(null);
  // 기존 보유종목의 매입가·수량·매입일을 고치는 모달 — buyDate 없이 등록한 기존 사용자가
  // 나중에 채워넣을 수 있는 유일한 경로였던 "동일 종목 재등록 시 upsert"(서버 로직은 이미
  // 있었음)를 UI로 노출한 것뿐, 새 엔드포인트 없음(2026-08-26).
  const [editModal, setEditModal] = useState<HoldingRow | null>(null);

  // ── Init ──────────────────────────────────────────────────────────────────

  const loadHoldings = useCallback(async () => {
    if (isRefreshingRef.current) {
      // 이미 요청이 진행 중 — 이 호출을 버리지 않고 큐에 표시만 해둔다. 진행 중인
      // 요청이 끝나면 finally에서 이 표시를 보고 한 번 더 실행한다.
      refreshPendingRef.current = true;
      return;
    }
    isRefreshingRef.current = true;
    refreshPendingRef.current = false;
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
      if (refreshPendingRef.current) {
        refreshPendingRef.current = false;
        loadHoldings();
      }
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
  // "오늘의 등락" 위젯의 거래일 판정 — 실패해도 null로 남겨 기존 "오늘의 등락" 표기로
  // 안전하게 폴백한다(과거엔 이 정보 자체가 없었으므로 실패 시 동작은 수정 전과 동일).
  const [marketDay,   setMarketDay]   = useState<MarketDayInfo | null>(null);
  const loadMonthly = useCallback(async () => {
    try {
      const res  = await fetch('/api/dashboard/monthly-returns');
      const data = await res.json();
      if (res.ok && Array.isArray(data.monthly)) setMonthlyData(data.monthly);
      if (res.ok && Array.isArray(data.daily)) setDailyData(data.daily);
      if (res.ok && data.marketDay) setMarketDay(data.marketDay);
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
      setAfterMidnight(isKoreanMarketPreOpen());
      if (document.visibilityState !== 'visible') return;
      const last = lastUpdatedRef.current;
      if (!last || Date.now() - last.getTime() >= POLL_MS) loadHoldings();
    };

    const id = setInterval(tick, CHECK_MS);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    setMarketOpen(isKoreanMarketOpen());
    setAfterMidnight(isKoreanMarketPreOpen());

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
  //
  // 같은 종목에 대한 PATCH를 티커별로 체인(직렬화)한다 — 병렬로 쏘면 네트워크 왕복
  // 순서가 뒤바뀌어(먼저 보낸 요청이 나중에 도착) 최종 클릭과 다른 값이 DB에 남는
  // 레이스컨디션이 있었다(2026-08-31 실측 재현: 5연타 후 새로고침하면 값이 되돌아감).
  // seq로 "가장 최근 클릭"만 리스크/월별 갱신을 담당하게 해 연타 중 중복 API 호출도 줄인다.
  const setHoldingHidden = async (ticker: string, hidden: boolean) => {
    setHoldings(prev => prev ? prev.map(h => h.ticker === ticker ? { ...h, hidden } : h) : prev);

    const seq = (hidingSeqRef.current[ticker] ?? 0) + 1;
    hidingSeqRef.current[ticker] = seq;

    const prevChain = hidingChainRef.current[ticker] ?? Promise.resolve();
    const thisChain = prevChain.catch(() => {}).then(() =>
      fetch('/api/dashboard/holdings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, hidden }),
      }).catch(() => {}),
    );
    hidingChainRef.current[ticker] = thisChain;
    await thisChain;

    if (hidingSeqRef.current[ticker] !== seq) return; // 그 사이 더 최신 클릭이 있으면 그쪽이 갱신을 담당
    loadRisk();
    loadMonthly();
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
  // 시세 조회 실패 종목(currentPrice === null)은 실제 가치를 모르는 상태다 — 0으로
  // 치면 "전량 손실"로 잘못 집계되므로, 포트폴리오 합계는 조회 성공한 종목만으로
  // 계산한다(실패 종목은 카드에 "시세 조회 실패"로 개별 표시됨).
  const quotedHoldings = visibleHoldings.filter(
    (h): h is HoldingRow & { currentPrice: number; changeRate: number; sector: string } =>
      h.currentPrice != null && h.changeRate != null && h.sector != null,
  );
  const totalInvestedRaw   = quotedHoldings.reduce((s, h) => s + h.avg_price * h.quantity, 0);
  const totalValueRaw      = quotedHoldings.reduce((s, h) => s + h.currentPrice * h.quantity, 0);
  const totalProfitRaw     = totalValueRaw - totalInvestedRaw;
  const totalProfitRateRaw = totalInvestedRaw > 0 ? (totalProfitRaw / totalInvestedRaw) * 100 : 0;

  // "오늘의 등락" — 상단 "총 손익"(매입가 대비 누적)과 다른 지표임을 분명히 하기 위해
  // 오늘 하루치만 별도 계산한다. changeRate(오늘 등락률)만으로 전일 종가를 역산해
  // (currentPrice = prevClose × (1+changeRate/100)) 새 API 호출 없이 구한다.
  const todayCounts = quotedHoldings.reduce(
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
  for (const h of quotedHoldings) {
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
    return <AiLoadingOverlay title="대시보드를 불러오고 있습니다..." subtitle="보유 종목과 시세 정보를 확인하는 중입니다" />;
  }

  // 최초 진입(등록 종목 0개) — 입력폼 강제 노출, 취소 불가
  if (holdings.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <PageBackground />
        <div className="bg-[#1a1f2e] border border-indigo-500/20 rounded-2xl p-8 max-w-md w-full">
          <p className="text-[11px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">대시보드</p>
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

  return (
    <div className="pb-8">
      <PageBackground />
      <div className="max-w-[1200px] mx-auto px-4 pt-8">

        <div className="mb-6">
          <p className="text-[11px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">대시보드</p>
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
          <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2.5">
            {marketDay && !marketDay.isTradingDay
              ? `${fmtMarketDay(marketDay.lastTradingDate)} 마감 기준 · 전일 종가 대비`
              : '오늘의 등락 · 전일 종가 대비'}
          </p>
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
          <AllocationDonutChart holdings={quotedHoldings} />
          <SectorAllocationDonutChart holdings={quotedHoldings} />
          <div className="md:col-span-2">
            <ReturnBarChart holdings={quotedHoldings} />
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
            <span className="text-[11px] text-slate-600">(숨김 {hiddenHoldings.length}개 포함)</span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {orderedHoldings.map(h => {
            const hasQuote = h.currentPrice != null;
            const value = hasQuote ? h.currentPrice! * h.quantity : null;
            const invested = h.avg_price * h.quantity;
            const profitRate = hasQuote && h.avg_price > 0 ? ((h.currentPrice! - h.avg_price) / h.avg_price) * 100 : null;
            const up = profitRate != null && profitRate >= 0;
            const todayUp = h.changeRate != null && h.changeRate >= 0;
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
                      <span className="text-[11px] font-semibold text-slate-500 border border-slate-700 rounded px-1.5 py-0.5 shrink-0">
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
                        <IconTip label={
                          marketOpen ? 'AI 분석은 장 마감 후 이용할 수 있습니다'
                          : afterMidnight ? '자정 이후엔 다음 장 마감 후 다시 이용 가능합니다'
                          : 'AI 분석'
                        }>
                          <button
                            onClick={() => setAnalysisModal({ ticker: h.ticker, name: h.name, market: h.market })}
                            disabled={marketOpen || afterMidnight}
                            aria-label="AI 분석"
                            className="p-1.5 rounded-lg text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </button>
                        </IconTip>
                        <IconTip label={h.buy_date ? '매입정보 수정' : '매입일 추가 · 벤치마크·보유기간 분석 활성화'}>
                          <button
                            onClick={() => setEditModal(h)}
                            aria-label="매입정보 수정"
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              h.buy_date
                                ? 'text-slate-600 hover:text-slate-300 hover:bg-slate-500/10'
                                : 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10'
                            }`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
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
                    {hasQuote ? (
                      <>
                        <p className="text-[13px] font-mono text-slate-200">{fmt(h.currentPrice!)}</p>
                        <p className={`text-[11px] font-mono ${todayUp ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(h.changeRate!)}</p>
                      </>
                    ) : (
                      <p className="text-[11px] font-mono text-amber-400" title="KIS 시세 조회에 실패했습니다. 잠시 후 새로고침해 주세요.">시세 조회 실패</p>
                    )}
                  </div>
                  <div>
                    <span className={STAT_LABEL_CLASS}>평가손익</span>
                    {value != null && profitRate != null ? (
                      <>
                        <p className={`text-[13px] font-mono font-semibold ${up ? 'text-red-400' : 'text-blue-400'}`}>{value - invested >= 0 ? '+' : ''}{fmt(Math.round(value - invested))}원</p>
                        <p className={`text-[11px] font-mono ${up ? 'text-red-400' : 'text-blue-400'}`}>{fmtR(profitRate)}</p>
                      </>
                    ) : (
                      <p className="text-[11px] font-mono text-amber-400">시세 조회 실패</p>
                    )}
                  </div>
                </div>

                {((h.week52High != null && h.week52High > 0) || h.marketCap || fiveDayChange != null) && (
                  <div className="grid grid-cols-4 gap-3 mb-4 pt-3 border-t border-slate-700/40">
                    {/* 52주 최고/최저는 값이 길어서(최대 7자리 두 개) 4열 중 2열을 차지하게 해서
                        항상 한 줄에 들어가게 함 — 시가총액/5일변동률은 나머지 1열씩. */}
                    {h.week52High != null && h.week52High > 0 && (
                      <div className="col-span-2">
                        <span className={STAT_LABEL_CLASS}>52주 최고/최저</span>
                        <p className="text-[12px] font-mono text-slate-300 whitespace-nowrap">{fmt(h.week52High)} / {fmt(h.week52Low!)}</p>
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

        {editModal && (
          <Modal title={`${editModal.name} · 매입정보 수정`} onClose={() => setEditModal(null)} maxWidth="max-w-md">
            <AddHoldingForm
              initial={{
                ticker: editModal.ticker, name: editModal.name,
                avgPrice: String(editModal.avg_price), quantity: String(editModal.quantity),
                buyDate: editModal.buy_date ?? '',
              }}
              onAdded={() => { setEditModal(null); loadHoldings(); loadRisk(); loadMonthly(); loadDividend(); }}
              onCancel={() => setEditModal(null)}
              showCancel
            />
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
                    <p className="text-[11px] text-slate-500 mb-1">배당수익률({s.year})</p>
                    <p className="text-[14px] font-bold font-mono text-slate-200">{s.dividendYield != null ? `${s.dividendYield.toFixed(1)}%` : '-'}</p>
                  </div>
                  <div className="bg-slate-800/40 rounded-xl p-3 text-center">
                    <p className="text-[11px] text-slate-500 mb-1">주당배당금</p>
                    <p className="text-[14px] font-bold font-mono text-slate-200">{s.dividendPerShare != null ? `${fmt(s.dividendPerShare)}원` : '-'}</p>
                  </div>
                  <div className="bg-slate-800/40 rounded-xl p-3 text-center">
                    <p className="text-[11px] text-slate-500 mb-1">배당성향</p>
                    <p className="text-[14px] font-bold font-mono text-slate-200">{s.payoutRatio != null ? `${s.payoutRatio.toFixed(1)}%` : '-'}</p>
                  </div>
                </div>
              )}
              {latest && (
                <div className="bg-amber-500/[0.06] border border-amber-500/20 rounded-xl p-4">
                  <p className="text-[11px] font-bold text-amber-400 uppercase tracking-wide mb-2.5">최근 배당</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2.5 gap-y-3">
                    <div>
                      <span className="text-[11px] text-slate-500 block mb-0.5">기준일</span>
                      <p className="text-[12px] font-mono text-slate-200 font-semibold">{fmtDate(latest.recordDate)}</p>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500 block mb-0.5">지급일</span>
                      <p className="text-[12px] font-mono text-slate-200 font-semibold">{latest.payDate ? fmtDate(latest.payDate) : '미정'}</p>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500 block mb-0.5">종류</span>
                      <p className="text-[12px] font-mono text-slate-200 font-semibold">{latest.kindLabel}</p>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500 block mb-0.5">주당금액</span>
                      <p className="text-[12px] font-mono text-slate-200 font-semibold">{fmt(latest.perShareAmount)}원</p>
                    </div>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-slate-600 mt-3.5 leading-relaxed">
                가장 최근 지급된 배당 기준입니다. 향후 지급을 예측하거나 보장하지 않습니다.
              </p>
            </Modal>
          );
        })()}
      </div>
    </div>
  );
}
