import { Metadata } from 'next';
import AiSummarySections, { type AiSummarySectionsData } from '@/components/portfolio/AiSummarySections';
import ReferenceNewsList from '@/components/diagnosis/ReferenceNewsList';
import WeightDriftCard from '@/components/portfolio/WeightDriftCard';
import { StructureChartsRow } from '@/components/portfolio/StructureCharts';
import HoldingPositionLine from '@/components/portfolio/HoldingPositionLine';
import { IssueFactorsCard, WatchVariablesCard } from '@/components/portfolio/FactorCards';
import { computeWeightDrift, computePnlSums, buildHoldingPositionSummary, type WeightDriftRow } from '@/lib/portfolio-position';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Sparkles, AlertCircle } from 'lucide-react';
import { INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';
import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';
import { formatExcludedHoldingsNote } from '@/lib/dividend-aggregation';
import DividendMatrix, { type DividendMatrixRow } from '@/components/diagnosis/DividendMatrix';
import type { SurgeHistory, TradingValueMultiple } from '@/components/diagnosis/SurgeHistoryCard';
import {
  MainAnalysisCard, InstitutionalFlowCard, RiskFactorsCard, SurgeTradingRow, DisclosuresCard, FxCorrelationCard, LayerHeading,
  type MainAnalysisSectionsData,
} from '@/components/diagnosis/DiagnosisCards';
import HoldingPositionCard from '@/components/diagnosis/HoldingPositionCard';
import FinancialsTrendCard from '@/components/diagnosis/FinancialsTrendCard';
import type { HoldingPosition } from '@/lib/holding-position';
import type { QuarterlyFinancialRow } from '@/lib/kis-api';
import { PerformanceSnapshotCard } from '@/components/diagnosis/PerformanceSnapshotCard';
import { SectorComparisonCard, type SectorComparison as SectorComparisonData } from '@/components/diagnosis/SectorComparisonCard';
import DividendInfo, { type DartDividendSummary, type DividendHistoryRow } from '@/components/diagnosis/DividendInfo';
import PriceChangeTable from '@/components/stock/PriceChangeTable';
import { buildStateSentence } from '@/lib/diagnosis-history-sentence';
import PortfolioPeriodChangeTable from '@/components/stock/PortfolioPeriodChangeTable';

export const dynamic = 'force-dynamic';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DiagnosisHistory {
  daysSince: number | null;
  prevDate?: string;
  prevProfitRate?: number | null;
  prevProfitAmount?: number | null;
  prevCurrentPrice?: number | null;
  prevFlowType?: 'BUY' | 'SELL' | 'NEUTRAL' | null;
  prevFlowPercentage?: number | null;
  holdingsChanged?: boolean;
  narrative: string;
}

interface AnnualFinancialRow {
  year: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  roe: number | null;
}

interface DartDisclosure {
  title: string;
  date: string;
  url: string;
  filer: string;
}

type MainAnalysisSections = MainAnalysisSectionsData;

interface DiagnosisData {
  stockName: string;
  ticker: string;
  generatedAt: string;
  mainAnalysis: string;
  // 2026-08-03 신설 — 이전에 저장된 공유 리포트에는 없어 optional. 있으면 소제목별로
  // 렌더링하고, 없으면(과거 레코드) mainAnalysis 문자열을 그대로 한 문단으로 렌더링한다.
  mainAnalysisSections?: MainAnalysisSections;
  currentPrice: number;
  avgPrice: number;
  quantity: number;
  profitRate: number;
  profitAmount: number;
  resistance: number; // 52주 고점 기준 저항선 관찰 (목표가 아님)
  support: number;    // 52주 저가 기준 지지선 관찰 (손절가 아님)
  benchmark?: {
    indexName: 'KOSPI' | 'KOSDAQ';
    indexChangeRate: number;
    stockProfitRate: number;
    fromDate: string;
    toDate: string;
  } | null;
  riskFactors: string[];
  institutionalFlow: string;
  foreignFlow: string;
  flowType?: 'BUY' | 'SELL' | 'NEUTRAL';
  flowPercentage?: number;
  // 2026-08-27 신설, 2026-08-28 이식 — 옛 공유 리포트(그 이전 생성분)에는 없어 optional.
  surgeHistory?: SurgeHistory | null;
  tradingValueMultiple?: TradingValueMultiple | null;
  shortTermOutlook?: string;
  midTermOutlook?: string;
  finalVerdict?: string; // 2026-08-05 신설 — 이전에 저장된 공유 리포트에는 없어 optional
  news: { title: string; description: string; url?: string }[];
  newsBasis?: 'news' | 'estimated';
  newsIssueClusters?: { label: string; articleIndexes: number[] }[];
  fxCorrelation?: { correlation: number; sampleSize: number } | null; // 2026-09-01 공유 페이지 드리프트 해소
  history: DiagnosisHistory;
  // 2026-07-13 신설 — 이전에 저장된 공유 리포트에는 없을 수 있어 optional로 둠
  sectorComparison?: SectorComparisonData | null;
  sectorNarrative?: string;
  annualFinancials?: AnnualFinancialRow[];
  quarterlyFinancials?: QuarterlyFinancialRow[]; // 2026-09-01 신설(옛 공유 리포트엔 없음)
  financialsYearEndMonth?: string;
  holdingPosition?: HoldingPosition | null;     // 2026-09-01 신설 — 없으면 내 포지션 카드 생략
  flowInsight?: string;                          // 2026-09-01 신설 — 기관/외국인 카드 해석 1문장
  financialsNarrative?: string;
  disclosures?: DartDisclosure[];
  disclosureNarrative?: string;
  // 배당 정보 — 2026-08-31 QA에서 공유 페이지에 아예 빠져있던 것을 발견해 추가(메인
  // 페이지 DiagnosisReport.tsx는 이미 갖고 있던 필드, DividendInfo.tsx와 동일 shape).
  dividendSummary?: DartDividendSummary | null;
  dividendHistory?: DividendHistoryRow[];
}

interface HoldingResult {
  ticker: string;
  name: string;
  currentPrice: number;
  avgPrice: number;
  quantity: number;
  value: number;
  invested: number;
  profit: number;
  profitRate: number;
  signal: '순유입 우위' | '중립·관망' | '차익실현 관찰' | '순유출 우위';
  reason: string;
  sector: string;
  mdd?: number | null;
  volatility?: number | null;
  todayContribution?: number | null;
}

interface Sector {
  name: string;
  tickers: string[];
  weight: number;
  warning: boolean;
}

// 정량 지표 3종(2026-08-28 신설) — app/portfolio-diagnosis/page.tsx와 동일 shape(손복제).
interface SectorConcentration { hhi: number; effectiveCount: number; grade: '고집중' | '보통' | '분산' }
interface RiskContributionItem { ticker: string; name: string; pct: number }
interface PortfolioCorrelation { correlation: number; sampleSize: number; bucket: '강한 동조화' | '보통 동조화' | '약한 동조화' }

interface HoldingPeriodEntry { ticker: string; name: string; holdDays: number; profitRate: number }

interface PortfolioHistory {
  daysSince: number | null;
  prevDate?: string;
  prevTotalProfitRate?: number | null;
  prevTotalProfit?: number | null;
  compositionChanged: boolean;
  addedTickers: { ticker: string; name: string }[];
  removedTickers: { ticker: string; name: string }[];
  narrative: string;
}

// app/portfolio-diagnosis/page.tsx의 RiskFactorEntry와 동일 — 손복제 구조라 함께 갱신.
// category 없는 옛 문자열 항목(과거 리포트/공유 스냅샷)도 그대로 렌더링할 수 있도록 string도 허용.
type RiskFactorEntry = string | { text: string; category?: 'macro' | 'company' };

// app/portfolio-diagnosis/page.tsx의 PortfolioDividendSummary와 동일 — 손복제 구조.
// matrix는 2026-08-05 신설이라 그 이전에 생성된 공유 리포트에는 없을 수 있어 optional —
// 없으면 아래 렌더링에서 옛 calendar 그리드로 폴백한다. excludedHoldings도 같은 날 추가된
// 필드라 optional — 없으면 캡션에서 제외 종목명 없이 기본 문구만 보여준다.
interface DividendCalendarEntry { month: number; holdings: { ticker: string; name: string }[] }
interface PortfolioDividendSummary {
  expectedAnnualDividend: number;
  portfolioDividendYield: number | null;
  payingCount: number;
  totalCount: number;
  excludedHoldings?: { ticker: string; name: string }[];
  calendar: DividendCalendarEntry[];
  matrix?: DividendMatrixRow[];
}

interface PortfolioData {
  generatedAt: string;
  totalInvested: number;
  totalValue: number;
  totalProfit: number;
  totalProfitRate: number;
  summary: string;
  // 2026-08-12 메인 페이지에 신설된 4개 소제목 분리 — 있으면 이걸로 렌더링하고, 없으면
  // (그 이전 공유 리포트) summary 문자열 폴백을 그대로 쓴다(메인 페이지와 동일 정책).
  // 2026-08-31 QA 발견: 공유 페이지가 이 필드 자체를 몰라서 새 리포트를 공유해도 항상
  // 옛 폴백(문장 2개씩 기계적으로 묶기)만 보여주고 있었음.
  // 2026-09-01: v2(포트폴리오 구조 중심) structure/concentration/pnlStructure 추가 — 메인 페이지와
  // 동일하게 v1 필드가 채워져 있으면 옛 소제목, 아니면 v2 소제목으로 렌더링한다.
  summarySections?: AiSummarySectionsData;
  sectors: Sector[];
  sectorConcentration?: SectorConcentration | null;
  riskContribution?:    RiskContributionItem[] | null;
  correlation?:         PortfolioCorrelation | null;
  weightDrift?:         WeightDriftRow[] | null;
  holdings: HoldingResult[];
  riskFactors?: RiskFactorEntry[];
  opportunityFactors?: string[];
  shortTermOutlook?: string;
  midTermOutlook?: string;
  benchmark?: {
    portfolioProfitRate: number;
    kospiChangeRate: number;
    fromDate: string;
    toDate: string;
  } | null;
  // 2026-07-13 신설 — 이전에 저장된 공유 리포트에는 없을 수 있어 optional로 둠
  history?: PortfolioHistory;
  topContributors?: {
    n: number;
    positive: { ticker: string; name: string; amount: number }[];
    negative: { ticker: string; name: string; amount: number }[];
  };
  contributionNarrative?: string;
  coMovementText?: string | null;
  coMovementNarrative?: string;
  holdingPeriod?: {
    longest: HoldingPeriodEntry | null;
    mostRecent: HoldingPeriodEntry | null;
    narrative: string;
  };
  dividend?: PortfolioDividendSummary | null;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString(); }
function fmtRate(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

function StatDelta({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[13px] font-bold font-mono ${positive ? 'text-red-400' : 'text-blue-400'}`}>{value}</span>
    </div>
  );
}

// "YYYY-MM-DD" → "8/18"
function fmtShortDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

// components/diagnosis/DiagnosisReport.tsx의 StateBlock과 동일 — 손복제.
function StateBlock({ label, rate, amount, emphasize }: { label: string; rate: number; amount: number; emphasize: boolean }) {
  const color = rate >= 0 ? 'text-red-400' : 'text-blue-400';
  return (
    <div className={`min-w-0 flex flex-col justify-center rounded-xl px-3.5 py-2.5 ${emphasize ? 'bg-slate-800/40 border border-slate-700/40' : 'bg-slate-800/20 border border-transparent opacity-70'}`}>
      <p className="text-[11px] text-slate-500 mb-0.5 truncate">{label}</p>
      <p className={`font-mono ${color} flex items-baseline gap-1.5 whitespace-nowrap`}>
        <span className={`font-bold ${emphasize ? 'text-[18px]' : 'text-[13px]'}`}>{fmtRate(rate)}</span>
        <span className={`text-slate-600 ${emphasize ? 'text-[12px]' : 'text-[11px]'}`}>·</span>
        <span className={emphasize ? 'text-[12px]' : 'text-[11px]'}>
          {amount >= 0 ? '+' : ''}{fmt(Math.round(amount))}원
        </span>
      </p>
    </div>
  );
}


// components/diagnosis/DiagnosisReport.tsx의 HistoryCompareCard와 동일한 로직(2026-08-28
// 재설계 — 그때/지금 절대 상태를 먼저 보여주고 변화량은 보조 문구로) —
// 이 파일은 그 컴포넌트를 재사용하지 않고 손복제된 구조라 함께 갱신해야 한다.
// (겸사겸사 수정: 기존 이 파일 버전은 rateDelta에 holdingsChanged 게이팅이 빠져있던
// 드리프트 버그가 있었음 — amountDelta는 이미 게이팅돼 있었는데 rateDelta만 누락됨.
// 이번에 canCompareState 하나로 통일하며 같이 바로잡았다.)
function HistoryCompareCard({ d }: { d: DiagnosisData }) {
  const h = d.history;
  const isFirst = h.daysSince === null;
  const label = isFirst
    ? '🔄 첫 기업분석'
    : h.daysSince === 1
      ? '🔄 어제 대비'
      : h.daysSince! <= 6
        ? `🔄 ${h.daysSince}일 전 진단 대비`
        : '🔄 오랜만에 재조회';

  const canCompareState = !isFirst && !h.holdingsChanged && typeof h.prevProfitRate === 'number' && typeof h.prevProfitAmount === 'number';
  const rateDelta   = canCompareState ? d.profitRate - h.prevProfitRate! : null;
  const amountDelta = canCompareState ? d.profitAmount - h.prevProfitAmount! : null;
  const priceDelta  = !isFirst && typeof h.prevCurrentPrice === 'number' ? d.currentPrice - h.prevCurrentPrice : null;
  const prevDateLabel = h.prevDate ? fmtShortDate(h.prevDate) : null;

  return (
    <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-2xl p-4">
      <p className="text-[11px] text-indigo-400 font-bold uppercase tracking-wide mb-2">{label}</p>
      {!isFirst && (
        <div className="mb-2.5">
          {canCompareState ? (
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 mb-2">
              <StateBlock label={prevDateLabel ? `직전 진단(${prevDateLabel})` : '직전 진단'} rate={h.prevProfitRate!} amount={h.prevProfitAmount!} emphasize={false} />
              <span className="self-center justify-self-center text-slate-600 text-[13px] rotate-90 sm:rotate-0">→</span>
              <StateBlock label="오늘" rate={d.profitRate} amount={d.profitAmount} emphasize />
            </div>
          ) : (
            <div className="mb-2">
              <StateBlock label="오늘" rate={d.profitRate} amount={d.profitAmount} emphasize />
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
            {canCompareState && (
              <span className="text-[11.5px] text-slate-400">
                {buildStateSentence(h.prevProfitRate!, rateDelta!, amountDelta!)}
              </span>
            )}
            {priceDelta !== null && (
              <StatDelta label="주가" value={`${priceDelta >= 0 ? '+' : ''}${fmt(Math.round(priceDelta))}원`} positive={priceDelta >= 0} />
            )}
            {h.holdingsChanged && (
              <span className="text-[11px] text-amber-500/80">보유정보 변경으로 수익률·손익 금액 비교 제외</span>
            )}
          </div>
        </div>
      )}
      <p className="text-[13px] text-slate-300 leading-relaxed">{h.narrative}</p>
    </div>
  );
}

function ShareBanner({ message }: { message: string }) {
  return (
    <div className="bg-gradient-to-r from-indigo-600/20 to-violet-600/20 border border-indigo-500/30 rounded-2xl px-5 py-3 mb-6 flex items-center gap-3">
      <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
      <p className="text-[13px] text-slate-300">{message}</p>
    </div>
  );
}

function ShareCTA() {
  return (
    <div className="mt-8 bg-gradient-to-r from-indigo-600/15 to-violet-600/15 border border-indigo-500/30 rounded-2xl p-6 text-center">
      <p className="text-[11px] font-bold tracking-[0.2em] text-indigo-400 uppercase mb-2">AI 기업 분석 서비스</p>
      <p className="text-white font-bold text-lg mb-1">나도 AI 기업 분석 받기</p>
      <p className="text-slate-400 text-[13px] mb-4">월 {PLAN_USAGE_LIMITS.free.diagnosis}회 무료 · AI가 내 기업을 실시간으로 분석해드립니다</p>
      <Link
        href="/auth/login"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-[14px] text-white transition-all hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #0ea5e9 50%, #10b981 100%)' }}
      >
        <Sparkles className="w-4 h-4" />
        fpark.com 가입하고 무료 분석받기 →
      </Link>
    </div>
  );
}

// ── Diagnosis View ─────────────────────────────────────────────────────────────

function DiagnosisView({ d }: { d: DiagnosisData }) {

  return (
    <div className="min-h-screen bg-[#0d1117] pb-16">
      <div className="max-w-5xl mx-auto px-4 pt-8">

        <ShareBanner message={`AI가 분석한 ${d.stockName} 리포트입니다`} />

        {/* Header */}
        <div className="mb-6">
          <p className="text-[11px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">AI 상세 분석 리포트</p>
          <h1 className="text-[22px] font-bold text-white tracking-wide">
            {d.stockName.toUpperCase()}{' '}
            <span className="text-slate-500 font-mono text-base font-normal">({d.ticker})</span>
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">리포트 생성 시각: {d.generatedAt}</p>
        </div>

        {/* 상단 면책 안내 */}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 mb-5">
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[12px] text-amber-200/90 leading-relaxed">{INVESTMENT_DISCLAIMER}</p>
        </div>

        {/* 2026-09-01 4층 재배치 — components/diagnosis/DiagnosisReport.tsx와 같은 공용 카드
            (DiagnosisCards.tsx 등)로 조립. 스트리밍 상태만 없을 뿐 카드 순서·구성은 메인과 동일. */}
        {/* 1층: 한눈에 */}
        <LayerHeading no={1} title="한눈에" sub="주가 배경 · 밸류에이션 · AI 종합 진단" />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] md:items-start gap-3 mb-5">
          <div className="flex flex-col gap-3 min-w-0">
            <MainAnalysisCard sections={d.mainAnalysisSections} mainAnalysis={d.mainAnalysis} finalVerdict={d.finalVerdict} />
            <HistoryCompareCard d={d} />
          </div>
          <PerformanceSnapshotCard
            currentPrice={d.currentPrice}
            profitRate={d.profitRate}
            profitAmount={d.profitAmount}
            avgPrice={d.avgPrice}
            quantity={d.quantity}
            resistance={d.resistance}
            support={d.support}
            benchmark={d.benchmark}
          />
        </div>

        {/* 2층: 내 포지션 */}
        <LayerHeading no={2} title="내 포지션" sub="매입가 · 보유기간 기준" />
        <HoldingPositionCard
          position={d.holdingPosition}
          className="mb-3"
          narrative={d.mainAnalysisSections?.watchPoint ? <p className="text-xs text-slate-300 leading-relaxed">{d.mainAnalysisSections.watchPoint}</p> : null}
        />
        <div className="mb-5">
          <PriceChangeTable ticker={d.ticker} />
        </div>

        {/* 3층: 종목 구조 — components/diagnosis/DiagnosisReport.tsx와 동일한 2열 묶음(2026-09-02) */}
        <LayerHeading no={3} title="종목 구조" sub="수급 · 업종 · 실적 · 거래 · 배당" />
        <div className={`grid grid-cols-1 ${d.sectorComparison ? 'md:grid-cols-2 md:items-start' : ''} gap-3 mb-3`}>
          <InstitutionalFlowCard
            flowType={d.flowType}
            flowPercentage={d.flowPercentage}
            flowInsight={d.flowInsight}
            institutionalFlow={d.institutionalFlow}
            foreignFlow={d.foreignFlow}
          />
          {d.sectorComparison && (
            <SectorComparisonCard
              data={d.sectorComparison}
              narrative={d.sectorNarrative ? <p className="text-[12px] text-slate-400 leading-relaxed">{d.sectorNarrative}</p> : null}
            />
          )}
        </div>
        <FinancialsTrendCard
          annual={d.annualFinancials ?? []}
          quarterly={d.quarterlyFinancials ?? []}
          yearEndMonth={d.financialsYearEndMonth}
          narrative={d.financialsNarrative ? <p className="text-xs text-slate-300 leading-relaxed">{d.financialsNarrative}</p> : null}
          className="mb-3"
        />
        <SurgeTradingRow surgeHistory={d.surgeHistory} tradingValueMultiple={d.tradingValueMultiple} className="mb-3" />
        <div className={`grid grid-cols-1 ${d.fxCorrelation ? 'md:grid-cols-2' : ''} gap-3 mb-5`}>
          <DividendInfo summary={d.dividendSummary ?? null} history={d.dividendHistory ?? []} />
          <FxCorrelationCard fx={d.fxCorrelation} />
        </div>

        {/* 4층: 참고 자료 */}
        <LayerHeading no={4} title="참고 자료" sub="공시 · 종목 고유 리스크 · 확인할 이벤트 · 기사" />
        <DisclosuresCard
          disclosures={d.disclosures ?? []}
          narrative={d.disclosureNarrative ? <p className="text-xs text-slate-300 leading-relaxed">{d.disclosureNarrative}</p> : null}
          className="mb-3"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 md:items-start gap-3 mb-3">
          <RiskFactorsCard riskFactors={d.riskFactors ?? []} />
          <WatchVariablesCard
            shortTermOutlook={d.shortTermOutlook}
            midTermOutlook={d.midTermOutlook}
            title="확인할 이벤트·지표"
            caption="이 종목 고유의 일정·공시·지표만 — 예측이 아니라 확인 목록입니다."
            dense
          />
        </div>
        {d.news?.length > 0 && (
          <ReferenceNewsList news={d.news} clusters={d.newsIssueClusters} newsBasis={d.newsBasis} className="mb-3" />
        )}

        <p className="text-[11px] text-slate-600 text-center leading-relaxed mb-4 px-4">
          {INVESTMENT_DISCLAIMER}
        </p>

        <ShareCTA />
      </div>
    </div>
  );
}

// ── Portfolio View ─────────────────────────────────────────────────────────────

function PortfolioView({ d }: { d: PortfolioData }) {
  const isUp = d.totalProfitRate >= 0;
  const sortedSectors = [...(d.sectors ?? [])].sort((a, b) => b.weight - a.weight);
  const excludedDividendNote = d.dividend?.excludedHoldings ? formatExcludedHoldingsNote(d.dividend.excludedHoldings) : null;
  // 정량 지표 3종 공통 게이트 — app/portfolio-diagnosis/page.tsx의 quantMetricsSuppressed와
  // 동일 원칙. 옛 공유 리포트(신설 이전 저장분)는 holdings는 있지만 이 필드들이 아예
  // 없을 수 있어(undefined) 그 경우도 "값 없음"으로 자연스럽게 처리된다.
  const quantMetricsSuppressed = d.holdings.length > 0 && d.holdings.length < 2;

  return (
    <div className="min-h-screen bg-[#0d1117] pb-16">
      <div className="max-w-5xl mx-auto px-4 pt-8">

        <ShareBanner message="AI가 분석한 포트폴리오 분석 리포트입니다" />

        {/* Header */}
        <div className="mb-6">
          <p className="text-[11px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">AI 포트폴리오 분석 리포트</p>
          <h1 className="text-[22px] font-bold text-white">포트폴리오 분석 리포트</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">리포트 생성: {d.generatedAt}</p>
        </div>

        {/* 수익률 요약 (절대 금액 제외) */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="border rounded-2xl p-4" style={{ background: '#1a1f2e', borderColor: '#334155' }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">기업 수</p>
            <p className="text-xl font-bold font-mono text-white">{d.holdings?.length ?? 0}개</p>
          </div>
          <div className="border rounded-2xl p-4" style={{
            background: isUp ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            borderColor: isUp ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
          }}>
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">총 수익률</p>
            <p className={`text-xl font-bold font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
              {fmtRate(d.totalProfitRate)}
            </p>
          </div>
        </div>

        {/* AI 종합 평가 */}
        <div className="rounded-2xl border border-indigo-500/25 overflow-hidden mb-4"
          style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}>
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
          <div className="px-8 py-6">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <p className="text-[11px] font-bold text-indigo-400/70 uppercase tracking-widest">AI 종합 평가</p>
            </div>
            {/* 메인 페이지(app/portfolio-diagnosis/page.tsx)와 동일 정책 — 소제목 4분리
                (summarySections)가 있으면 그걸로, 없으면(옛 공유 리포트) 문장 2개씩
                기계적으로 묶는 옛 폴백을 쓴다. 2026-08-31까지는 이 필드 자체를 몰라서
                새 리포트를 공유해도 항상 폴백만 보여주고 있었다. */}
            {d.summarySections && Object.values(d.summarySections).some(Boolean) ? (
              /* 2026-09-01: 메인·대시보드와 같은 공용 컴포넌트 — 정적 렌더링(revealed 없음) */
              <AiSummarySections sections={d.summarySections} />
            ) : (
              <div className="flex flex-col gap-3">
                {d.summary
                  .replace(/([.!?])\s+/g, '$1\n')
                  .split('\n')
                  .filter(Boolean)
                  .reduce<string[][]>((acc, s, i) => {
                    if (i % 2 === 0) acc.push([s]);
                    else acc[acc.length - 1].push(s);
                    return acc;
                  }, [])
                  .map((group, i) => (
                    <p key={i} className="text-[14px] text-slate-300" style={{ lineHeight: 1.8 }}>{group.join(' ')}</p>
                  ))
                }
              </div>
            )}
          </div>
        </div>

        {/* 2층 · 구조 — 매입 비중 vs 현재 비중(2026-09-01 신설, 공용 컴포넌트; 옛 스냅샷은 holdings로 폴백 계산) */}
        {(() => { const rows = d.weightDrift ?? computeWeightDrift(d.holdings ?? []); return rows.length >= 2 ? <WeightDriftCard rows={rows} className="mb-4" /> : null; })()}

        {/* 섹터 편중도 + 변동성 기여도 — 2026-09-01 도넛 전환(메인·대시보드와 같은 StructureChartsRow) */}
        <StructureChartsRow
          sectors={sortedSectors}
          concentration={d.sectorConcentration}
          riskContribution={d.riskContribution}
          suppressed={quantMetricsSuppressed}
          className="mb-4"
        />

        {/* 기간별 포트폴리오 평가금액 변동 — 메인 페이지(app/portfolio-diagnosis/page.tsx)와
            동일 컴포넌트 재사용. 2026-08-31 QA 발견: 공유 페이지엔 이 카드가 아예 없었음. */}
        <div className="mb-4">
          <PortfolioPeriodChangeTable
            holdings={(d.holdings ?? []).map(h => ({ ticker: h.ticker, name: h.name, quantity: h.quantity }))}
            currentTotalValue={d.totalValue ?? 0}
          />
        </div>

        {/* 벤치마크 비교 (사실 수치만, 판단 없음) */}
        {d.benchmark && (
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">벤치마크 비교 (참고용 수치)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-800/40 px-4 py-3">
                <p className="text-[11px] text-slate-500 mb-1">귀하의 포트폴리오 수익률</p>
                <p className={`text-lg font-mono font-bold ${d.benchmark.portfolioProfitRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {fmtRate(d.benchmark.portfolioProfitRate)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-800/40 px-4 py-3">
                <p className="text-[11px] text-slate-500 mb-1">같은 기간 KOSPI 등락률</p>
                <p className={`text-lg font-mono font-bold ${d.benchmark.kospiChangeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {fmtRate(d.benchmark.kospiChangeRate)}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-slate-600 mt-3">
              비교 기간: {d.benchmark.fromDate} ~ {d.benchmark.toDate} (편입 기업 평균 매입일 기준) · 판단이 아닌 수치 비교 정보입니다.
            </p>
          </div>
        )}

        {/* 보유 기간별 관점 (신설, 매입일 데이터로 비교 가능할 때만) */}
        {(d.holdingPeriod?.longest && d.holdingPeriod?.mostRecent) && (
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">보유 기간별 관점</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-xl bg-slate-800/40 px-4 py-3">
                <p className="text-[11px] text-slate-500 mb-1">가장 오래 보유 · {d.holdingPeriod.longest.name} ({d.holdingPeriod.longest.holdDays}일 전 매입)</p>
                <p className={`text-lg font-mono font-bold ${d.holdingPeriod.longest.profitRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {fmtRate(d.holdingPeriod.longest.profitRate)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-800/40 px-4 py-3">
                <p className="text-[11px] text-slate-500 mb-1">가장 최근 편입 · {d.holdingPeriod.mostRecent.name} ({d.holdingPeriod.mostRecent.holdDays}일 전 매입)</p>
                <p className={`text-lg font-mono font-bold ${d.holdingPeriod.mostRecent.profitRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {fmtRate(d.holdingPeriod.mostRecent.profitRate)}
                </p>
              </div>
            </div>
            {d.holdingPeriod.narrative && (
              <p className="text-[13px] text-slate-300 leading-relaxed">{d.holdingPeriod.narrative}</p>
            )}
          </div>
        )}

        {/* 2층 · 보조 — 종목별 개별 이슈 + 앞으로 확인할 이벤트·지표(공용 컴포넌트, 정적) */}
        <IssueFactorsCard riskFactors={d.riskFactors} opportunityFactors={d.opportunityFactors} className="mb-4" />
        <WatchVariablesCard shortTermOutlook={d.shortTermOutlook} midTermOutlook={d.midTermOutlook} className="mb-4" />

        {/* 종목별 관찰 지표 (절대 금액 제외) */}
        <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">기업별 관찰 지표</p>
          <div className="flex flex-col divide-y divide-slate-700/40">
            {(d.holdings ?? []).map(h => {
              const hUp = h.profitRate >= 0;
              return (
                <div key={h.ticker} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3 flex-wrap md:flex-nowrap">
                    <div className="w-full md:w-40 shrink-0">
                      <p className="text-[14px] font-semibold text-white leading-tight">{h.name}</p>
                      <p className="text-[11px] text-slate-500 font-mono">{h.ticker} · {h.sector}</p>
                      <Link href={`/stock/${h.ticker}`} className="text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline mt-0.5 inline-block">
                        자세히 보기 →
                      </Link>
                    </div>
                    <div className="flex gap-4 shrink-0">
                      <div>
                        <p className="text-[11px] text-slate-600 mb-0.5">현재가</p>
                        <p className="text-[13px] font-mono text-slate-300">{fmt(h.currentPrice)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-600 mb-0.5">수익률</p>
                        <p className={`text-[13px] font-mono font-semibold ${hUp ? 'text-red-400' : 'text-blue-400'}`}>
                          {fmtRate(h.profitRate)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <HoldingPositionLine
                    s={buildHoldingPositionSummary(h, { totalValue: d.totalValue, pnl: computePnlSums(d.holdings ?? []), riskByTicker: new Map((d.riskContribution ?? []).map(r => [r.ticker, r.pct])) })}
                    className="mt-2 pl-0 md:pl-44"
                  />
                  {h.reason && (
                    <p className="mt-2 text-[12px] text-slate-500 leading-relaxed pl-0 md:pl-44">{h.reason}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 배당 정보(합산 배당률 + 월별 캘린더, 2026-08-04 신설) — app/portfolio-diagnosis/page.tsx와
            동일 구조(손복제). 전체 무배당이면 d.dividend가 null이라 섹션 자체를 렌더링하지 않는다. */}
        {d.dividend && (
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">배당 정보</p>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-4">
              <div className="bg-slate-800/40 rounded-xl p-3 text-center sm:min-w-[140px]">
                <p className="text-[11px] text-slate-500 mb-1">합산 배당률</p>
                <p className="text-[17px] font-bold font-mono text-slate-200">
                  {d.dividend.portfolioDividendYield !== null ? `${d.dividend.portfolioDividendYield.toFixed(2)}%` : '-'}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  최근 확정 배당 기준 · 예상 연간 배당금 {d.dividend.expectedAnnualDividend.toLocaleString()}원
                </p>
                <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
                  {d.dividend.totalCount}개 종목 중 {d.dividend.payingCount}개만 배당 이력 있음
                  {excludedDividendNote && ` (${excludedDividendNote} 제외)`}
                  {' '}(미래 지급을 보장하지 않음)
                </p>
              </div>
            </div>

            {d.dividend.matrix && d.dividend.matrix.length > 0 ? (
              <>
                <DividendMatrix rows={d.dividend.matrix} />
                <p className="text-[11px] text-slate-600 mt-2">
                  최근 5년 배당 지급 이력 기준 — 칸을 클릭하면 해당 종목·월의 연도별 지급일과 금액을 볼 수 있습니다. 향후 지급을 예측하거나 보장하지 않습니다
                </p>
              </>
            ) : (
              // matrix 없는 옛 공유 리포트(2026-08-05 이전 생성분) 호환 폴백 — 기존 12칸 캘린더 그리드.
              <>
                <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
                  {d.dividend.calendar.map((c) => (
                    <div
                      key={c.month}
                      className={`rounded-lg p-2 text-center min-h-[52px] ${
                        c.holdings.length > 0
                          ? 'bg-indigo-500/10 border border-indigo-500/25'
                          : 'bg-slate-800/30 border border-slate-800/40'
                      }`}
                    >
                      <p className="text-[11px] text-slate-500 mb-1">{c.month}월</p>
                      {c.holdings.length > 0 && (
                        <p className="text-[11px] text-indigo-300 font-medium leading-tight break-keep">
                          {c.holdings.slice(0, 2).map(h => h.name).join(', ')}
                          {c.holdings.length > 2 ? ` 외 ${c.holdings.length - 2}` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-600 mt-2">
                  최근 5년 배당 지급 이력 기준 — 몇 월에 배당이 몰려있는지 관찰한 결과이며 향후 지급을 예측하거나 보장하지 않습니다
                </p>
              </>
            )}
          </div>
        )}

        <p className="text-[11px] text-slate-600 text-center leading-relaxed mb-4 px-4">
          {INVESTMENT_DISCLAIMER}
        </p>

        <ShareCTA />
      </div>
    </div>
  );
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { data: row } = await supabase
    .from('shared_reports')
    .select('type, data')
    .eq('id', id)
    .single();

  if (!row) return { title: 'FINANCE PARK' };

  if (row.type === 'diagnosis') {
    const d = row.data as DiagnosisData;
    const title = `AI 기업 분석 - ${d.stockName}`;
    const desc = `수익률 ${fmtRate(d.profitRate)} | ${d.mainAnalysis?.slice(0, 80) ?? ''}`;
    return {
      title,
      description: desc,
      openGraph: {
        title,
        description: desc,
        images: ['https://fpark.com/og-image.png'],
        url: `https://fpark.com/share/${id}`,
        type: 'website',
      },
    };
  }

  const d = row.data as PortfolioData;
  const title = `AI 포트폴리오 분석 리포트 | FINANCE PARK`;
  const desc = `총 수익률 ${fmtRate(d.totalProfitRate)} | ${d.holdings?.length ?? 0}개 기업 AI 분석`;
  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      images: ['https://fpark.com/og-image.png'],
      url: `https://fpark.com/share/${id}`,
      type: 'website',
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: row, error } = await supabase
    .from('shared_reports')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !row) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-center px-4">
          <p className="text-2xl mb-3">🔍</p>
          <p className="text-white font-semibold text-lg mb-2">리포트를 찾을 수 없습니다</p>
          <p className="text-slate-500 text-[13px] mb-6">링크가 잘못되었거나 이미 삭제된 리포트입니다</p>
          <Link href="/" className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold transition-colors">
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  if (new Date(row.expires_at) < new Date()) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-center px-4">
          <p className="text-2xl mb-3">⏱️</p>
          <p className="text-white font-semibold text-lg mb-2">만료된 리포트입니다</p>
          <p className="text-slate-500 text-[13px] mb-6">공유 링크는 생성 후 7일간만 유효합니다</p>
          <Link href="/diagnosis" className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold transition-colors">
            새 분석 받기
          </Link>
        </div>
      </div>
    );
  }

  if (row.type === 'diagnosis') return <DiagnosisView d={row.data as DiagnosisData} />;
  return <PortfolioView d={row.data as PortfolioData} />;
}
