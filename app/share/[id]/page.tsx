import { Metadata } from 'next';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { TrendingUp, TrendingDown, Sparkles, AlertCircle } from 'lucide-react';
import { INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';

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

interface SectorComparison {
  peerAvgChangeRate: number;
  deltaVsPeer: number;
}

interface AnnualFinancialRow {
  year: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  roe: number | null;
}

interface DiagnosisData {
  stockName: string;
  ticker: string;
  generatedAt: string;
  mainAnalysis: string;
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
  shortTermOutlook?: string;
  midTermOutlook?: string;
  news: { title: string; description: string; url?: string }[];
  history: DiagnosisHistory;
  // 2026-07-13 신설 — 이전에 저장된 공유 리포트에는 없을 수 있어 optional로 둠
  sectorComparison?: SectorComparison | null;
  sectorNarrative?: string;
  annualFinancials?: AnnualFinancialRow[];
  financialsNarrative?: string;
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
}

interface Sector {
  name: string;
  tickers: string[];
  weight: number;
  warning: boolean;
}

interface PortfolioData {
  generatedAt: string;
  totalInvested: number;
  totalValue: number;
  totalProfit: number;
  totalProfitRate: number;
  summary: string;
  sectors: Sector[];
  holdings: HoldingResult[];
  suggestions: string[];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const SECTOR_COLORS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500',
  'bg-amber-500',  'bg-pink-500',   'bg-teal-500', 'bg-orange-500',
];

function fmt(n: number) { return n.toLocaleString(); }
function fmtRate(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

function DonutChart({ percent, type }: { percent: number; type: 'BUY' | 'SELL' | 'NEUTRAL' }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const filled = circ * (percent / 100);
  const color = type === 'BUY' ? '#10b981' : type === 'SELL' ? '#f87171' : '#94a3b8';
  const label = type === 'BUY' ? '자금 유입' : type === 'SELL' ? '자금 유출' : '중립';
  return (
    <svg width="148" height="148" viewBox="0 0 148 148">
      <circle cx="74" cy="74" r={r} fill="none" stroke="#1e293b" strokeWidth="14" />
      <circle cx="74" cy="74" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`} transform="rotate(-90 74 74)"
        style={{ filter: `drop-shadow(0 0 6px ${color}66)` }} />
      <text x="74" y="69" textAnchor="middle" fill={color} fontSize="22" fontWeight="800" fontFamily="monospace">{percent}%</text>
      <text x="74" y="88" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600" letterSpacing="1">{label}</text>
    </svg>
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

// components/diagnosis/DiagnosisReport.tsx의 HistoryCompareCard와 동일한 로직 —
// 이 파일은 그 컴포넌트를 재사용하지 않고 손복제된 구조라 함께 갱신해야 한다.
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

  const rateDelta   = !isFirst && typeof h.prevProfitRate === 'number' ? d.profitRate - h.prevProfitRate : null;
  const amountDelta = !isFirst && !h.holdingsChanged && typeof h.prevProfitAmount === 'number' ? d.profitAmount - h.prevProfitAmount : null;
  const priceDelta  = !isFirst && typeof h.prevCurrentPrice === 'number' ? d.currentPrice - h.prevCurrentPrice : null;

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

// components/diagnosis/DiagnosisReport.tsx의 FinancialsTrendCard와 동일 로직 —
// 이 파일은 그 컴포넌트를 재사용하지 않고 손복제된 구조라 함께 갱신해야 한다.
function FinancialsTrendCard({ rows, narrative }: { rows: AnnualFinancialRow[]; narrative?: string }) {
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
      {narrative && (
        <p className="text-[13px] text-slate-300 leading-relaxed">{narrative}</p>
      )}
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
      <p className="text-[10px] font-bold tracking-[0.2em] text-indigo-400 uppercase mb-2">AI 기업 분석 서비스</p>
      <p className="text-white font-bold text-lg mb-1">나도 AI 기업 분석 받기</p>
      <p className="text-slate-400 text-[13px] mb-4">하루 1회 무료 · AI가 내 기업을 실시간으로 분석해드립니다</p>
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
  const isProfit = d.profitRate >= 0;
  const resistanceUpRate = d.resistance > 0 ? ((d.resistance - d.currentPrice) / d.currentPrice * 100) : 0;
  const supportDownRate  = d.support    > 0 ? ((d.support    - d.currentPrice) / d.currentPrice * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0d1117] pb-16">
      <div className="max-w-5xl mx-auto px-4 pt-8">

        <ShareBanner message={`AI가 분석한 ${d.stockName} 리포트입니다`} />

        {/* Header */}
        <div className="mb-6">
          <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">AI 상세 분석 리포트</p>
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

        {/* 1행: 오늘의 기업 분석 + Performance Snapshot */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 mb-4">
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
              <p className="text-[13px] text-slate-300 leading-relaxed">{d.mainAnalysis}</p>
            </div>
          </div>

          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 pt-4 pb-2 border-b border-slate-700/50">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Performance Snapshot</p>
            </div>
            <div className="divide-y divide-slate-700/40">
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">현재가</span>
                <span className="text-[15px] font-bold text-white font-mono">{fmt(d.currentPrice)} <span className="text-[11px] text-slate-500 font-normal">KRW</span></span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">기업 수익률</span>
                <span className={`text-[15px] font-bold font-mono flex items-center gap-1 ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
                  {isProfit ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {fmtRate(d.profitRate)}
                </span>
              </div>
              {d.benchmark && (
                <>
                  <div className="flex items-center justify-between px-5 py-3.5">
                    <span className="text-[12px] text-slate-400">같은 기간 {d.benchmark.indexName} 등락률</span>
                    <span className={`text-[13px] font-bold font-mono ${d.benchmark.indexChangeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {fmtRate(d.benchmark.indexChangeRate)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-5 py-3.5">
                    <span className="text-[12px] text-slate-400">시장 대비</span>
                    {(() => {
                      const diff = d.benchmark.stockProfitRate - d.benchmark.indexChangeRate;
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
                  {d.profitAmount > 0 ? '+' : ''}{fmt(d.profitAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">매입평균가</span>
                <span className="text-[13px] text-slate-300 font-mono">{fmt(d.avgPrice)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">보유수량</span>
                <span className="text-[13px] text-slate-300 font-mono">{fmt(d.quantity)}주</span>
              </div>
            </div>
            {d.benchmark && (
              <p className="px-5 py-2.5 text-[10px] text-slate-600 border-t border-slate-700/40">
                비교 기간: {d.benchmark.fromDate} ~ {d.benchmark.toDate} (매입일 기준) · 판단이 아닌 수치 비교 정보입니다.
              </p>
            )}
          </div>
        </div>

        {/* 2행: 직전 기업분석 대비 (신설) */}
        <HistoryCompareCard d={d} />

        {/* 3행: 저항선 관찰 / 지지선 관찰 (목표가·손절가 아님, 참고용 수치 카드) */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="rounded-2xl border border-slate-700/50 overflow-hidden bg-slate-800/40">
            <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-slate-700/40">
              <div className="w-7 h-7 rounded-lg bg-slate-700/40 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">52주 최고가</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-2xl font-black text-slate-200 font-mono mb-1">{fmt(d.resistance)} <span className="text-sm font-normal text-slate-500">KRW</span></p>
              <p className="text-[12px] text-slate-500">현재가 대비 {resistanceUpRate >= 0 ? '+' : ''}{resistanceUpRate.toFixed(1)}%</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700/50 overflow-hidden bg-slate-800/40">
            <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-slate-700/40">
              <div className="w-7 h-7 rounded-lg bg-slate-700/40 flex items-center justify-center">
                <TrendingDown className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">52주 최저가</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-2xl font-black text-slate-200 font-mono mb-1">{fmt(d.support)} <span className="text-sm font-normal text-slate-500">KRW</span></p>
              <p className="text-[12px] text-slate-500">현재가 대비 {supportDownRate.toFixed(1)}%</p>
            </div>
          </div>
        </div>

        {/* 4행: 기관/외국인 동향 도넛 + 업종 대비 + 리스크 요인 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">기관/외국인 동향</p>
            </div>
            <div className="flex flex-col items-center py-2">
              <DonutChart percent={d.flowPercentage ?? 50} type={d.flowType ?? 'NEUTRAL'} />
            </div>
            <div className="flex flex-col gap-1.5 mt-3">
              {d.institutionalFlow && (
                <p className="text-center text-[12px] text-slate-400 leading-relaxed">{d.institutionalFlow}</p>
              )}
              {d.foreignFlow && (
                <p className="text-center text-[12px] text-slate-400 leading-relaxed">{d.foreignFlow}</p>
              )}
            </div>
          </div>

          {d.sectorComparison && (
            <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">업종 대비</p>
              </div>
              <div className="flex flex-col divide-y divide-slate-700/40 mb-3">
                <div className="flex items-center justify-between py-2 first:pt-0">
                  <span className="text-[12px] text-slate-400">업종 평균 등락률</span>
                  <span className="text-[13px] font-bold font-mono text-slate-300">{fmtRate(d.sectorComparison.peerAvgChangeRate)}</span>
                </div>
                <div className="flex items-center justify-between py-2 last:pb-0">
                  <span className="text-[12px] text-slate-400">업종 대비 차이</span>
                  <span className={`text-[13px] font-bold font-mono ${d.sectorComparison.deltaVsPeer >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {d.sectorComparison.deltaVsPeer >= 0 ? '+' : ''}{d.sectorComparison.deltaVsPeer.toFixed(2)}%p
                  </span>
                </div>
              </div>
              {d.sectorNarrative && (
                <p className="text-[12px] text-slate-400 leading-relaxed">{d.sectorNarrative}</p>
              )}
            </div>
          )}

          <div className="bg-[#1a1f2e] border border-red-500/20 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-[10px] font-bold text-red-400 uppercase tracking-wider">Risk Factors</span>
            </div>
            <div className="flex flex-col gap-2">
              {(d.riskFactors ?? []).map((line, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-red-500/60 text-[10px] mt-1 shrink-0">▶</span>
                  <p className="text-[12px] text-slate-300 leading-relaxed">{line}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 5행: 단기/중기 전망 */}
        {(d.shortTermOutlook || d.midTermOutlook) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {d.shortTermOutlook && (
              <div className="bg-[#1a1f2e] border border-indigo-500/20 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">단기 관찰 변수</span>
                </div>
                <p className="text-[13px] text-slate-300 leading-relaxed">{d.shortTermOutlook}</p>
              </div>
            )}
            {d.midTermOutlook && (
              <div className="bg-[#1a1f2e] border border-violet-500/20 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-[10px] font-bold text-violet-400 uppercase tracking-wider">중기 관찰 변수</span>
                </div>
                <p className="text-[13px] text-slate-300 leading-relaxed">{d.midTermOutlook}</p>
              </div>
            )}
          </div>
        )}

        {/* 5-1행: 실적 추이 (최근 3개년 확정 연간, 데이터 없으면 카드 생략) */}
        {d.annualFinancials && d.annualFinancials.length > 0 && (
          <FinancialsTrendCard rows={d.annualFinancials} narrative={d.financialsNarrative} />
        )}

        {/* 6행: 참고 기사 (본문에서 이미 해석했으므로 출처 링크만) */}
        {d.news?.length > 0 && (
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">참고 기사</p>
            <div className="flex flex-col divide-y divide-slate-700/40">
              {d.news.map((n, i) => {
                const href = n.url || `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(n.title)}`;
                return (
                  <a key={i} href={href} target="_blank" rel="noopener noreferrer"
                    className="py-2.5 first:pt-0 last:pb-0 group cursor-pointer flex items-center gap-2.5">
                    <span className="text-[10px] font-bold text-slate-600 shrink-0 w-4">{i + 1}</span>
                    <p className="text-[13px] text-slate-300 leading-snug group-hover:text-indigo-300 group-hover:underline transition-colors">{n.title}</p>
                  </a>
                );
              })}
            </div>
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

// ── Portfolio View ─────────────────────────────────────────────────────────────

function PortfolioView({ d }: { d: PortfolioData }) {
  const isUp = d.totalProfitRate >= 0;
  const sortedSectors = [...(d.sectors ?? [])].sort((a, b) => b.weight - a.weight);

  return (
    <div className="min-h-screen bg-[#0d1117] pb-16">
      <div className="max-w-5xl mx-auto px-4 pt-8">

        <ShareBanner message="AI가 분석한 포트폴리오 분석 리포트입니다" />

        {/* Header */}
        <div className="mb-6">
          <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">AI 포트폴리오 분석 리포트</p>
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
              <p className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-widest">AI 종합 평가</p>
            </div>
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
          </div>
        </div>

        {/* 섹터 편중도 */}
        <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">섹터 편중도 분석</p>
          <div className="flex flex-col gap-3">
            {sortedSectors.map((s, i) => (
              <div key={s.name}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${SECTOR_COLORS[i % SECTOR_COLORS.length]}`} />
                    <span className="text-[13px] text-slate-300 font-medium">{s.name}</span>
                    {s.warning && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 font-semibold">과집중</span>
                    )}
                  </div>
                  <span className="text-[13px] font-mono text-slate-400">{s.weight}%</span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${s.warning ? 'bg-red-500' : SECTOR_COLORS[i % SECTOR_COLORS.length]}`}
                    style={{ width: `${s.weight}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

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
                    </div>
                    <div className="flex gap-4 shrink-0">
                      <div>
                        <p className="text-[10px] text-slate-600 mb-0.5">현재가</p>
                        <p className="text-[13px] font-mono text-slate-300">{fmt(h.currentPrice)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 mb-0.5">수익률</p>
                        <p className={`text-[13px] font-mono font-semibold ${hUp ? 'text-red-400' : 'text-blue-400'}`}>
                          {fmtRate(h.profitRate)}
                        </p>
                      </div>
                    </div>
                  </div>
                  {h.reason && (
                    <p className="mt-2 text-[12px] text-slate-500 leading-relaxed pl-0 md:pl-44">{h.reason}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 참고할 만한 관찰 포인트 (전체 펼침) */}
        <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">참고할 만한 관찰 포인트</p>
          <div className="flex flex-col gap-3">
            {(d.suggestions ?? []).map((s, i) => (
              <div key={i} className="flex items-start gap-3 bg-slate-800/40 rounded-xl px-4 py-3">
                <span className="text-indigo-400 text-[10px] mt-0.5 shrink-0 font-bold">{String(i + 1).padStart(2, '0')}</span>
                <p className="text-[13px] text-slate-300 leading-relaxed">{s}</p>
              </div>
            ))}
          </div>
        </div>

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
