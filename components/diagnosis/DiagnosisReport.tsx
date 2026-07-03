'use client';

import { Sparkles, ChevronLeft, Printer, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import ShareDropdown from '@/components/ShareDropdown';
import PageBackground from '@/components/layout/PageBackground';
import { INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';

export interface DiagnosisResult {
  summary: string;
  currentPrice: number;
  avgPrice: number;
  quantity: number;
  profitRate: number;
  profitAmount: number;
  news: { title: string; description: string; url?: string }[];
  newsBasis?: 'news' | 'estimated';
  institutionalFlow: string;
  foreignFlow: string;
  reasons: string[];
  technicalAnalysis: string[];
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
  opportunityFactors: string[];
  flowType?: 'BUY' | 'SELL' | 'NEUTRAL';
  flowPercentage?: number;
  shortTermOutlook?: string;
  midTermOutlook?: string;
}

function DonutChart({ percent, type }: { percent: number; type: 'BUY' | 'SELL' | 'NEUTRAL' }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const filled = circ * (percent / 100);
  const color = type === 'BUY' ? '#10b981' : type === 'SELL' ? '#f87171' : '#94a3b8';
  const label = type === 'BUY' ? 'BUY FLOW' : type === 'SELL' ? 'SELL FLOW' : 'NEUTRAL';

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
export default function DiagnosisReport({
  result, stockName, ticker, generatedAt, onReset, actions = true, showBackground = true,
}: DiagnosisReportProps) {
  const isProfit = result.profitRate >= 0;
  const resistanceUpRate = result.resistance > 0 ? ((result.resistance - result.currentPrice) / result.currentPrice * 100) : 0;
  const supportDownRate  = result.support    > 0 ? ((result.support    - result.currentPrice) / result.currentPrice * 100) : 0;

  const reasonBullets   = result.reasons          ?? [];
  const technicalLines  = result.technicalAnalysis ?? [];

  return (
    <div className="pb-8">
      {showBackground && <PageBackground />}
      <div className="max-w-5xl mx-auto px-4 pt-8">

        {/* ── 헤더 ── */}
        <div className="flex justify-between mb-6 gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">AI 상세 진단 리포트</p>
            <h1 className="text-[22px] font-bold text-white tracking-wide">
              {stockName.toUpperCase()}{' '}
              <span className="text-slate-500 font-mono text-base font-normal">({ticker})</span>
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">리포트 생성 시각: {generatedAt}</p>
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0 mt-1 no-print">
              <ShareDropdown
                title={`AI 종목진단 - ${stockName}`}
                description={`수익률 ${result.profitRate >= 0 ? '+' : ''}${result.profitRate.toFixed(2)}% | ${result.summary?.slice(0, 80) ?? ''}`}
                hashtags="fpark,주식,AI종목진단"
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

        {/* ── 1행: 현재 상태 요약 (65%) + PERFORMANCE SNAPSHOT (35%) ── */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 mb-4">

          {/* 현재 상태 요약 (관찰형, 매수/매도/홀딩 의견 아님) */}
          <div className="rounded-2xl border border-slate-700/50 overflow-hidden" style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}>
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black bg-indigo-500/10 border border-indigo-500/30">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">현재 상태 요약</p>
                </div>
              </div>
              <p className="text-[13px] text-slate-300 leading-relaxed">{result.summary}</p>
            </div>
          </div>

          {/* PERFORMANCE SNAPSHOT */}
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 pt-4 pb-2 border-b border-slate-700/50">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Performance Snapshot</p>
            </div>
            <div className="divide-y divide-slate-700/40">
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">현재가</span>
                <span className="text-[15px] font-bold text-white font-mono">{fmt(result.currentPrice)} <span className="text-[11px] text-slate-500 font-normal">KRW</span></span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">종목 수익률</span>
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
                <span className="text-[12px] text-slate-400">매수평균가</span>
                <span className="text-[13px] text-slate-300 font-mono">{fmt(result.avgPrice)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[12px] text-slate-400">보유수량</span>
                <span className="text-[13px] text-slate-300 font-mono">{fmt(result.quantity)}주</span>
              </div>
            </div>
            {result.benchmark && (
              <p className="px-5 py-2.5 text-[10px] text-slate-600 border-t border-slate-700/40">
                비교 기간: {result.benchmark.fromDate} ~ {result.benchmark.toDate} (매수일 기준) · 판단이 아닌 수치 비교 정보입니다.
              </p>
            )}
          </div>
        </div>

        {/* ── 2행: 저항선 관찰 / 지지선 관찰 (목표가·손절가 아님) ── */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* 저항선 관찰 */}
          <div className="rounded-2xl border border-slate-700/50 overflow-hidden bg-slate-800/40">
            <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-slate-700/40">
              <div className="w-7 h-7 rounded-lg bg-slate-700/40 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">저항선 관찰 (52주 고점 기준)</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-2xl font-black text-slate-200 font-mono mb-1">{fmt(result.resistance)} <span className="text-sm font-normal text-slate-500">KRW</span></p>
              <p className="text-[12px] text-slate-500">
                현재가 대비 {resistanceUpRate >= 0 ? '+' : ''}{resistanceUpRate.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* 지지선 관찰 */}
          <div className="rounded-2xl border border-slate-700/50 overflow-hidden bg-slate-800/40">
            <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-slate-700/40">
              <div className="w-7 h-7 rounded-lg bg-slate-700/40 flex items-center justify-center">
                <TrendingDown className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">지지선 관찰 (52주 저가 기준)</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-2xl font-black text-slate-200 font-mono mb-1">{fmt(result.support)} <span className="text-sm font-normal text-slate-500">KRW</span></p>
              <p className="text-[12px] text-slate-500">
                현재가 대비 {supportDownRate.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>

        {/* ── 3행: 주요 관찰 데이터 ── */}
        <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">주요 관찰 데이터</p>
          <div className="flex flex-col gap-2.5">
            {reasonBullets.map((line, i) => (
              <div key={i} className="flex gap-3">
                <span className="mt-1 w-4 h-4 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
                  <svg className="w-2 h-2 text-indigo-400" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="2"/></svg>
                </span>
                <p className="text-[13px] text-slate-300 leading-relaxed">{line}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 4행: 기술적 분석 ── */}
        <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">기술적 분석</p>
          <div className="flex flex-col gap-3">
            {technicalLines.map((line, i) => (
              <div key={i} className="flex gap-3 bg-slate-800/40 rounded-xl px-4 py-3">
                <span className="text-indigo-400 text-[10px] mt-0.5 shrink-0 font-bold">{String(i + 1).padStart(2, '0')}</span>
                <p className="text-[13px] text-slate-300 leading-relaxed">{line}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 5행: 기관/외국인 동향 + 리스크 + 기회 ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

          {/* 기관/외국인 동향 — 도넛 차트 */}
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

            {/* 요약 텍스트 */}
            <p className="text-center text-[12px] text-slate-400 mt-3 leading-relaxed">
              {result.foreignFlow?.split(/(?<=[.。])\s+/)[0]?.trim() ?? ''}
            </p>
          </div>

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

          {/* 기회 요인 */}
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
        </div>

        {/* ── 6행: 기관 / 외국인 상세 ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">기관 동향</p>
            <div className="flex flex-col gap-2">
              {(result.institutionalFlow?.split(/\n|(?<=다\.) /).filter(Boolean) ?? []).map((line, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-violet-400/60 text-[10px] mt-1 shrink-0">▶</span>
                  <p className="text-[12px] text-slate-300 leading-relaxed">{line.replace(/^[-·•]\s*/, '').trim()}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">외국인 동향</p>
            <div className="flex flex-col gap-2">
              {(result.foreignFlow?.split(/\n|(?<=다\.) /).filter(Boolean) ?? []).map((line, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-sky-400/60 text-[10px] mt-1 shrink-0">▶</span>
                  <p className="text-[12px] text-slate-300 leading-relaxed">{line.replace(/^[-·•]\s*/, '').trim()}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 7행: 단기/중기 전망 ── */}
        {(result.shortTermOutlook || result.midTermOutlook) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {result.shortTermOutlook && (
              <div className="bg-[#1a1f2e] border border-indigo-500/20 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                    단기 전망 1M
                  </span>
                </div>
                <p className="text-[13px] text-slate-300 leading-relaxed">{result.shortTermOutlook}</p>
              </div>
            )}
            {result.midTermOutlook && (
              <div className="bg-[#1a1f2e] border border-violet-500/20 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-[10px] font-bold text-violet-400 uppercase tracking-wider">
                    중기 전망 3M
                  </span>
                </div>
                <p className="text-[13px] text-slate-300 leading-relaxed">{result.midTermOutlook}</p>
              </div>
            )}
          </div>
        )}

        {/* ── 8행: 뉴스 / 분석 근거 구분 ── */}
        <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">뉴스 동향</p>
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
                    className="py-3.5 first:pt-0 last:pb-0 group cursor-pointer block"
                  >
                    <div className="flex gap-2.5">
                      <span className="mt-1 text-[10px] font-bold text-slate-600 shrink-0 w-4">{i + 1}</span>
                      <div>
                        <p className="text-[13px] font-medium text-white leading-snug group-hover:text-indigo-300 group-hover:underline transition-colors">
                          {n.title}
                        </p>
                        {n.description && (
                          <p className="text-[12px] text-slate-500 mt-1 leading-relaxed line-clamp-2">{n.description}</p>
                        )}
                      </div>
                    </div>
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
            <ChevronLeft className="w-4 h-4" /> 다시 종목진단 받기
          </button>
        )}
      </div>
    </div>
  );
}
