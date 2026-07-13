'use client';

import { Sparkles, ChevronLeft, Printer, TrendingUp, TrendingDown, AlertCircle, RefreshCw } from 'lucide-react';
import ShareDropdown from '@/components/ShareDropdown';
import PageBackground from '@/components/layout/PageBackground';
import { INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';

export interface DiagnosisHistory {
  daysSince: number | null; // null = 첫 기업분석(비교 대상 없음)
  prevDate?: string;
  prevProfitRate?: number | null;
  prevProfitAmount?: number | null;
  prevCurrentPrice?: number | null;
  prevFlowType?: 'BUY' | 'SELL' | 'NEUTRAL' | null;
  prevFlowPercentage?: number | null;
  holdingsChanged?: boolean; // 매입평균가/보유수량이 직전 진단과 달라짐 — 손익 금액 비교 제외
  narrative: string; // AI가 해석한 "직전 진단 대비" 서술
}

export interface SectorComparison {
  peerAvgChangeRate: number;
  deltaVsPeer: number;
}

export interface AnnualFinancialRow {
  year: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  roe: number | null;
}

export interface DartDisclosure {
  title: string;
  date: string;
  url: string;
  filer: string;
}

export interface DiagnosisResult {
  mainAnalysis: string; // 현재 상태·밸류에이션·수급·뉴스 해석을 하나로 합친 서술형 본문
  currentPrice: number;
  avgPrice: number;
  quantity: number;
  profitRate: number;
  profitAmount: number;
  news: { title: string; description: string; url?: string }[];
  newsBasis?: 'news' | 'estimated';
  institutionalFlow: string; // 도넛 옆 한 줄 캡션
  foreignFlow: string;       // 도넛 옆 한 줄 캡션
  riskFactors: string[];
  sectorComparison: SectorComparison | null; // 동종업계 peer 없으면 null — 카드 자체 생략
  sectorNarrative: string;   // 업종 대비 해석 (1~3문장), 데이터 없으면 빈 문자열
  annualFinancials: AnnualFinancialRow[]; // 최근 3개년 확정 연간 실적, 없으면 빈 배열 — 카드 생략
  financialsNarrative: string; // 실적 추이 해석, 데이터 없으면 빈 문자열
  disclosures: DartDisclosure[]; // DART 최근 14일 주요 공시, 없으면 빈 배열 — 카드 생략
  disclosureNarrative: string; // 공시 해석, 데이터 없으면 빈 문자열
  resistance: number; // 52주 고점 기준 저항선 관찰 (목표가 아님)
  support: number;    // 52주 저가 기준 지지선 관찰 (손절가 아님)
  benchmark?: {
    indexName: 'KOSPI' | 'KOSDAQ';
    indexChangeRate: number;
    stockProfitRate: number;
    fromDate: string;
    toDate: string;
  } | null;
  flowType?: 'BUY' | 'SELL' | 'NEUTRAL';
  flowPercentage?: number;
  shortTermOutlook?: string;
  midTermOutlook?: string;
  isCached?: boolean; // 휴장일 등 실시간 조회 실패 시 마지막 거래일 기준 값
  cachedAt?: string;
  history: DiagnosisHistory;
}

function DonutChart({ percent, type }: { percent: number; type: 'BUY' | 'SELL' | 'NEUTRAL' }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const filled = circ * (percent / 100);
  const color = type === 'BUY' ? '#10b981' : type === 'SELL' ? '#f87171' : '#94a3b8';
  const label = type === 'BUY' ? '자금 유입' : type === 'SELL' ? '자금 유출' : '중립';

  return (
    <svg width="148" height="148" viewBox="0 0 148 148">
      {/* 배경 링 */}
      <circle cx="74" cy="74" r={r} fill="none" stroke="#1e293b" strokeWidth="14" />
      {/* 컬러 아크 */}
      <circle
        cx="74" cy="74" r={r}
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
        transform="rotate(-90 74 74)"
        style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
      />
      {/* 퍼센트 */}
      <text x="74" y="69" textAnchor="middle" fill={color} fontSize="22" fontWeight="800" fontFamily="monospace">
        {percent}%
      </text>
      {/* 라벨 */}
      <text x="74" y="88" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600" letterSpacing="1">
        {label}
      </text>
    </svg>
  );
}

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

// "직전 기업분석 대비" 카드 — 종목 리포트(components/stock/AiAnalysis.tsx)의 "🔄 어제 대비"
// 카드와 동일한 시각 언어를 재사용. 델타 수치는 서버가 계산해 넘긴 값을 그대로 표시하고
// (AI가 지어낸 숫자가 아님), narrative만 AI 해석 문장이다.
function HistoryCompareCard({ result }: { result: DiagnosisResult }) {
  const h = result.history;
  const isFirst = h.daysSince === null;
  const label = isFirst
    ? '🔄 첫 기업분석'
    : h.daysSince === 1
      ? '🔄 어제 대비'
      : h.daysSince! <= 6
        ? `🔄 ${h.daysSince}일 전 진단 대비`
        : '🔄 오랜만에 재조회';

  const rateDelta   = !isFirst && typeof h.prevProfitRate === 'number' ? result.profitRate - h.prevProfitRate : null;
  const amountDelta = !isFirst && !h.holdingsChanged && typeof h.prevProfitAmount === 'number' ? result.profitAmount - h.prevProfitAmount : null;
  const priceDelta  = !isFirst && typeof h.prevCurrentPrice === 'number' ? result.currentPrice - h.prevCurrentPrice : null;

  return (
    <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-2xl px-5 py-4 mb-4">
      <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-wide mb-2">{label}</p>
      {!isFirst && (
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 mb-2.5">
          {rateDelta !== null && (
            <StatDelta label="수익률" value={`${rateDelta >= 0 ? '+' : ''}${rateDelta.toFixed(2)}%p`} positive={rateDelta >= 0} />
          )}
          {amountDelta !== null && (
            <StatDelta label="평가손익" value={`${amountDelta >= 0 ? '+' : ''}${fmt(Math.round(amountDelta))}원`} positive={amountDelta >= 0} />
          )}
          {priceDelta !== null && (
            <StatDelta label="주가" value={`${priceDelta >= 0 ? '+' : ''}${fmt(Math.round(priceDelta))}원`} positive={priceDelta >= 0} />
          )}
          {h.holdingsChanged && (
            <span className="text-[11px] text-amber-500/80">보유정보 변경으로 손익 금액 비교 제외</span>
          )}
        </div>
      )}
      <p className="text-[13px] text-slate-300 leading-relaxed">{h.narrative}</p>
    </div>
  );
}

// 매출(항상 양수, 크기 비교 — 순차형 단일 색상 바)과 영업이익(부호가 바뀔 수 있음 —
// 0 기준선 중심의 발산형 바)을 연도별로 한눈에 비교할 수 있게 표시. 2026-07-13
// "숫자를 읽어야만 알 수 있다"는 피드백으로, 텍스트 나열에서 막대 시각화로 전환.
// 색상은 페이지 전체가 이미 쓰고 있는 관례(상승/이익=red, 하락/손실=blue)를 그대로 따름.
function FinancialsTrendCard({ result }: { result: DiagnosisResult }) {
  const rows = result.annualFinancials;
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue ?? 0));
  const maxAbsOpProfit = Math.max(1, ...rows.map((r) => Math.abs(r.operatingProfit ?? 0)));

  return (
    <div className="bg-[#1a1f2e] border border-violet-500/20 rounded-2xl p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-[10px] font-bold text-violet-400 uppercase tracking-wider">
          실적 추이 (연간 확정치)
        </span>
      </div>
      <div className="flex flex-col gap-3.5 mb-3">
        {rows.map((r) => (
          <div key={r.year}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-400">{r.year}년</span>
              {r.roe !== null && <span className="text-[10px] text-slate-500 font-mono">ROE {r.roe}%</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              {/* 매출 — 순차형(단일 색) 바, 0 기준 좌측 정렬 */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-600 w-14 shrink-0">매출</span>
                <div className="flex-1 h-2 rounded-full bg-slate-800/60 overflow-hidden">
                  {r.revenue !== null && (
                    <div className="h-full rounded-full bg-indigo-400/70" style={{ width: `${Math.max(2, (r.revenue / maxRevenue) * 100)}%` }} />
                  )}
                </div>
                <span className="text-[11px] font-mono text-slate-300 tabular-nums w-20 text-right shrink-0">
                  {r.revenue !== null ? `${fmt(r.revenue)}억` : '-'}
                </span>
              </div>
              {/* 영업이익 — 발산형 바(0 기준선 중심), 흑자=red/적자=blue (페이지 전체 관례) */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-600 w-14 shrink-0">영업이익</span>
                <div className="relative flex-1 h-2 rounded-full bg-slate-800/60 overflow-hidden">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600/80" />
                  {r.operatingProfit !== null && (
                    r.operatingProfit >= 0 ? (
                      <div className="absolute inset-y-0 left-1/2 rounded-r-full bg-red-400/80" style={{ width: `${Math.max(2, (r.operatingProfit / maxAbsOpProfit) * 50)}%` }} />
                    ) : (
                      <div className="absolute inset-y-0 right-1/2 rounded-l-full bg-blue-400/80" style={{ width: `${Math.max(2, (Math.abs(r.operatingProfit) / maxAbsOpProfit) * 50)}%` }} />
                    )
                  )}
                </div>
                <span className={`text-[11px] font-mono tabular-nums w-20 text-right shrink-0 ${
                  r.operatingProfit === null ? 'text-slate-300' : r.operatingProfit >= 0 ? 'text-red-400' : 'text-blue-400'
                }`}>
                  {r.operatingProfit !== null ? `${r.operatingProfit >= 0 ? '+' : ''}${fmt(r.operatingProfit)}억` : '-'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {result.financialsNarrative && (
        <p className="text-[13px] text-slate-300 leading-relaxed">{result.financialsNarrative}</p>
      )}
    </div>
  );
}

interface DiagnosisReportProps {
  result: DiagnosisResult;
  stockName: string;
  ticker: string;
  generatedAt: string;
  onReset?: () => void;
  actions?: boolean;        // 공유·인쇄·다시진단 버튼 노출 여부 (기본 true)
  showBackground?: boolean; // PageBackground(파티클 캔버스) 렌더 여부 (기본 true)
}

// app/diagnosis/page.tsx의 결과 리포트 뷰를 그대로 추출한 컴포넌트.
// 실제 종목진단 페이지와 랜딩페이지(ai-portfolio) 예시 카드가 이 컴포넌트를 공유하므로
// 리포트 UI가 바뀌면 두 곳 모두 자동으로 최신 상태를 유지한다.
// (app/share/[id]/page.tsx의 DiagnosisView는 별도로 손복제돼 있어 이 파일과 함께 갱신할 것)
export default function DiagnosisReport({
  result, stockName, ticker, generatedAt, onReset, actions = true, showBackground = true,
}: DiagnosisReportProps) {
  const isProfit = result.profitRate >= 0;
  const resistanceUpRate = result.resistance > 0 ? ((result.resistance - result.currentPrice) / result.currentPrice * 100) : 0;
  const supportDownRate  = result.support    > 0 ? ((result.support    - result.currentPrice) / result.currentPrice * 100) : 0;

  return (
    <div className="pb-8">
      {showBackground && <PageBackground />}
      <div className="max-w-5xl mx-auto px-4 pt-8">

        {/* ── 헤더 ── */}
        <div className="flex justify-between mb-6 gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">AI 상세 분석 리포트</p>
            <h1 className="text-[22px] font-bold text-white tracking-wide">
              {stockName.toUpperCase()}{' '}
              <span className="text-slate-500 font-mono text-base font-normal">({ticker})</span>
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">리포트 생성 시각: {generatedAt}</p>
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0 mt-1 no-print">
              <ShareDropdown
                title={`AI 기업 분석 - ${stockName}`}
                description={`수익률 ${result.profitRate >= 0 ? '+' : ''}${result.profitRate.toFixed(2)}% | ${result.mainAnalysis?.slice(0, 80) ?? ''}`}
                hashtags="fpark,기업분석,AI분석"
                reportType="diagnosis"
                reportData={{ ...result, stockName, ticker, generatedAt }}
              />
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30
                  border border-indigo-500/40 text-indigo-300 text-[11px] font-semibold tracking-wide transition-colors cursor-pointer"
              >
                <Printer className="w-3 h-3" /> PRINT REPORT
              </button>
            </div>
          )}
        </div>

        {/* ── 상단 면책 안내 (눈에 띄게) ── */}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 mb-5">
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[12px] text-amber-200/90 leading-relaxed">{INVESTMENT_DISCLAIMER}</p>
        </div>

        {/* ── 1행: 오늘의 기업 분석 (65%) + PERFORMANCE SNAPSHOT (35%) ── */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 mb-4">

          {/* 오늘의 기업 분석 (서술형, 매수/매도/홀딩 의견 아님) */}
          <div className="rounded-2xl border border-slate-700/50 overflow-hidden" style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}>
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black bg-indigo-500/10 border border-indigo-500/30">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">오늘의 기업 분석</p>
                </div>
              </div>
              <p className="text-[13px] text-slate-300 leading-relaxed">{result.mainAnalysis}</p>
            </div>
          </div>

          {/* PERFORMANCE SNAPSHOT */}
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 pt-4 pb-2 border-b border-slate-700/50">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Performance Snapshot</p>
            </div>
            {result.isCached && (
              <div className="flex items-center gap-1.5 px-5 pt-3 text-[11px] text-amber-500">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>
                  최근 거래일 종가 기준
                  {result.cachedAt && ` · ${new Date(result.cachedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                </span>
              </div>
            )}
            <div className="divide-y divide-slate-700/40">
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">현재가</span>
                <span className="text-[15px] font-bold text-white font-mono">{fmt(result.currentPrice)} <span className="text-[11px] text-slate-500 font-normal">KRW</span></span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">기업 수익률</span>
                <span className={`text-[15px] font-bold font-mono flex items-center gap-1 ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
                  {isProfit ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {fmtRate(result.profitRate)}
                </span>
              </div>
              {result.benchmark && (
                <>
                  <div className="flex items-center justify-between px-5 py-3.5">
                    <span className="text-[12px] text-slate-400">같은 기간 {result.benchmark.indexName} 등락률</span>
                    <span className={`text-[13px] font-bold font-mono ${result.benchmark.indexChangeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {fmtRate(result.benchmark.indexChangeRate)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-5 py-3.5">
                    <span className="text-[12px] text-slate-400">시장 대비</span>
                    {(() => {
                      const diff = result.benchmark.stockProfitRate - result.benchmark.indexChangeRate;
                      return (
                        <span className={`text-[13px] font-bold font-mono ${diff >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                          {diff >= 0 ? '+' : ''}{diff.toFixed(2)}%p
                        </span>
                      );
                    })()}
                  </div>
                </>
              )}
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">평가손익</span>
                <span className={`text-[14px] font-bold font-mono ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
                  {result.profitAmount > 0 ? '+' : ''}{fmt(result.profitAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">매입평균가</span>
                <span className="text-[13px] text-slate-300 font-mono">{fmt(result.avgPrice)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">보유수량</span>
                <span className="text-[13px] text-slate-300 font-mono">{fmt(result.quantity)}주</span>
              </div>
            </div>
            {result.benchmark && (
              <p className="px-5 py-2.5 text-[10px] text-slate-600 border-t border-slate-700/40">
                비교 기간: {result.benchmark.fromDate} ~ {result.benchmark.toDate} (매입일 기준) · 판단이 아닌 수치 비교 정보입니다.
              </p>
            )}
          </div>
        </div>

        {/* ── 2행: 직전 기업분석 대비 (신설) ── */}
        <HistoryCompareCard result={result} />

        {/* ── 2-1행: 주요 공시 (DART, 있을 때만 — 눈에 띄게 강조) ── */}
        {result.disclosures.length > 0 && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">주요 공시 (DART)</span>
            </div>
            <div className="flex flex-col gap-2 mb-3">
              {result.disclosures.map((d, i) => (
                <a
                  key={i}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/30 px-3 py-2 hover:bg-slate-900/50 transition-colors group"
                >
                  <span className="text-[13px] text-amber-100/90 group-hover:text-amber-200 group-hover:underline leading-snug">{d.title}</span>
                  <span className="text-[11px] text-amber-400/70 font-mono shrink-0">{d.date}</span>
                </a>
              ))}
            </div>
            {result.disclosureNarrative && (
              <p className="text-[13px] text-slate-300 leading-relaxed">{result.disclosureNarrative}</p>
            )}
          </div>
        )}

        {/* ── 3행: 저항선 관찰 / 지지선 관찰 (목표가·손절가 아님, 참고용 수치 카드) ── */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* 저항선 관찰 */}
          <div className="rounded-2xl border border-slate-700/50 overflow-hidden bg-slate-800/40">
            <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-slate-700/40">
              <div className="w-7 h-7 rounded-lg bg-slate-700/40 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">52주 최고가</p>
            </div>
            <div className="px-5 py-4">
              {result.resistance > 0 ? (
                <>
                  <p className="text-2xl font-black text-slate-200 font-mono mb-1">{fmt(result.resistance)} <span className="text-sm font-normal text-slate-500">KRW</span></p>
                  <p className="text-[12px] text-slate-500">
                    현재가 대비 {resistanceUpRate >= 0 ? '+' : ''}{resistanceUpRate.toFixed(1)}%
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-slate-500">휴장일 - 데이터 갱신 예정</p>
              )}
            </div>
          </div>

          {/* 지지선 관찰 */}
          <div className="rounded-2xl border border-slate-700/50 overflow-hidden bg-slate-800/40">
            <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-slate-700/40">
              <div className="w-7 h-7 rounded-lg bg-slate-700/40 flex items-center justify-center">
                <TrendingDown className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">52주 최저가</p>
            </div>
            <div className="px-5 py-4">
              {result.support > 0 ? (
                <>
                  <p className="text-2xl font-black text-slate-200 font-mono mb-1">{fmt(result.support)} <span className="text-sm font-normal text-slate-500">KRW</span></p>
                  <p className="text-[12px] text-slate-500">
                    현재가 대비 {supportDownRate.toFixed(1)}%
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-slate-500">휴장일 - 데이터 갱신 예정</p>
              )}
            </div>
          </div>
        </div>

        {/* ── 4행: 기관/외국인 동향 도넛 + 업종 대비 + 리스크 요인 ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

          {/* 기관/외국인 동향 — 도넛 차트 (설명 텍스트는 본문에 흡수, 여기는 캡션 한 줄만) */}
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">기관/외국인 동향</p>
            </div>

            {/* 도넛 차트 */}
            <div className="flex flex-col items-center py-2">
              <DonutChart
                percent={result.flowPercentage ?? 50}
                type={result.flowType ?? 'NEUTRAL'}
              />
            </div>

            {/* 캡션 (기관/외국인 각 한 줄) */}
            <div className="flex flex-col gap-1.5 mt-3">
              {result.institutionalFlow && (
                <p className="text-center text-[12px] text-slate-400 leading-relaxed">{result.institutionalFlow}</p>
              )}
              {result.foreignFlow && (
                <p className="text-center text-[12px] text-slate-400 leading-relaxed">{result.foreignFlow}</p>
              )}
            </div>
          </div>

          {/* 업종 대비 (동종업계 peer 없으면 카드 자체 생략) */}
          {result.sectorComparison && (
            <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">업종 대비</p>
              </div>
              <div className="flex flex-col divide-y divide-slate-700/40 mb-3">
                <div className="flex items-center justify-between py-2 first:pt-0">
                  <span className="text-[12px] text-slate-400">업종 평균 등락률</span>
                  <span className="text-[13px] font-bold font-mono text-slate-300">{fmtRate(result.sectorComparison.peerAvgChangeRate)}</span>
                </div>
                <div className="flex items-center justify-between py-2 last:pb-0">
                  <span className="text-[12px] text-slate-400">업종 대비 차이</span>
                  <span className={`text-[13px] font-bold font-mono ${result.sectorComparison.deltaVsPeer >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {result.sectorComparison.deltaVsPeer >= 0 ? '+' : ''}{result.sectorComparison.deltaVsPeer.toFixed(2)}%p
                  </span>
                </div>
              </div>
              {result.sectorNarrative && (
                <p className="text-[12px] text-slate-400 leading-relaxed">{result.sectorNarrative}</p>
              )}
            </div>
          )}

          {/* 리스크 요인 */}
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
        </div>

        {/* ── 5행: 단기/중기 관찰 변수 ── */}
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

        {/* ── 5-1행: 실적 추이 (최근 3개년 확정 연간, 데이터 없으면 카드 생략) ── */}
        {result.annualFinancials.length > 0 && <FinancialsTrendCard result={result} />}

        {/* ── 6행: 참고 기사 (본문에서 이미 해석했으므로 출처 링크만) ── */}
        <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">참고 기사</p>
            {result.newsBasis === 'news' ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                📰 뉴스 기반 분석
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-400 border border-slate-600/40">
                🔍 수급·기술적 추정
              </span>
            )}
          </div>
          {result.news?.length > 0 ? (
            <div className="flex flex-col divide-y divide-slate-700/40">
              {result.news.map((n, i) => {
                const href = n.url || `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(n.title)}`;
                return (
                  <a
                    key={i}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2.5 first:pt-0 last:pb-0 group cursor-pointer flex items-center gap-2.5"
                  >
                    <span className="text-[10px] font-bold text-slate-600 shrink-0 w-4">{i + 1}</span>
                    <p className="text-[13px] text-slate-300 leading-snug group-hover:text-indigo-300 group-hover:underline transition-colors">
                      {n.title}
                    </p>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-slate-500 leading-relaxed">
              관련도 높은 뉴스가 확인되지 않아, 수급·기술적 지표를 근거로 분석했습니다.
            </p>
          )}
        </div>

        {/* 면책 */}
        <p className="text-[11px] text-slate-600 text-center leading-relaxed mb-6 px-4">
          {INVESTMENT_DISCLAIMER}
        </p>

        {/* 다시 진단받기 */}
        {actions && onReset && (
          <button onClick={onReset}
            className="flex items-center gap-2 mx-auto px-6 py-3 rounded-xl
              bg-slate-800 hover:bg-slate-700 border border-slate-700
              text-slate-300 text-[13px] transition-colors cursor-pointer">
            <ChevronLeft className="w-4 h-4" /> 다시 기업 분석 받기
          </button>
        )}
      </div>
    </div>
  );
}
