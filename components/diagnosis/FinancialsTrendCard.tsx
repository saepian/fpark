// "실적 추이" 카드 (연간 3개년 확정치 + 최근 분기 단독값·전년동기비) — 2026-09-01 메인·공유 페이지
// 손복제를 여기로 통합하고 분기 섹션을 신설. 수치는 lib/kis-api.ts fetchFinancialsTrend가 계산한
// 값 그대로(분기 단독값 = 누적 차감, 11월 결산은 회계분기 순번). narrative는 호출부가 스트리밍
// 상태까지 조립해 넘긴다(SectorComparisonCard와 같은 패턴).
import type { ReactNode } from 'react';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import type { AnnualFinancialRow, QuarterlyFinancialRow } from '@/lib/kis-api';

function fmt(n: number) { return n.toLocaleString(); }
const yoyTone = (n: number) => (n >= 0 ? 'text-red-400' : 'text-blue-400');

export function FinancialsTrendCard({
  annual,
  quarterly = [],
  yearEndMonth,
  narrative,
  className = '',
}: {
  annual: AnnualFinancialRow[];
  quarterly?: QuarterlyFinancialRow[];
  yearEndMonth?: string;
  narrative?: ReactNode;
  className?: string;
}) {
  if (annual.length === 0 && quarterly.length === 0) return null;
  const maxRevenue = Math.max(1, ...annual.map((r) => r.revenue ?? 0));
  const maxAbsOpProfit = Math.max(1, ...annual.map((r) => Math.abs(r.operatingProfit ?? 0)));
  const nonDecFy = yearEndMonth && yearEndMonth !== '12' ? `${Number(yearEndMonth)}월 결산` : null;

  return (
    <div className={`bg-[#1a1f2e] border border-violet-500/20 rounded-2xl p-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span className={`px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
          실적 추이
        </span>
        {nonDecFy && <span className="text-[11px] text-slate-500">{nonDecFy} 기업 — 분기 순번은 회계연도 기준</span>}
      </div>

      {/* 2026-09-02 밀도 조정: 연간(막대)과 분기(표)를 세로로 나열하면 카드가 페이지에서 가장 길어져
          데스크톱에선 둘 다 있을 때 2열로 나란히 둔다(모바일은 세로 스택 그대로). */}
      <div className={`grid grid-cols-1 ${annual.length > 0 && quarterly.length > 0 ? 'md:grid-cols-2 md:gap-5' : ''} gap-3 mb-3`}>
      {annual.length > 0 && (
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-500 mb-2.5">연간 (확정치, 억원)</p>
          <div className="flex flex-col gap-3">
            {annual.map((r) => (
              <div key={r.year}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-slate-400">{r.year}년</span>
                  {r.roe !== null && <span className="text-[11px] text-slate-500 font-mono">ROE {r.roe}%</span>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-600 w-14 shrink-0">매출</span>
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
                    <span className="text-[11px] text-slate-600 w-14 shrink-0">영업이익</span>
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
        </div>
      )}

      {quarterly.length > 0 && (
        <div className={`min-w-0 ${annual.length > 0 ? 'pt-3 border-t border-slate-700/40 md:pt-0 md:border-t-0 md:border-l md:pl-5' : ''}`}>
          <p className="text-[11px] font-bold text-slate-500 mb-2">분기 (단독, 억원 · 괄호는 전년 동기비)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] tabular-nums">
              <thead>
                <tr className="text-slate-600">
                  <th className="text-left font-normal py-1 pr-2 whitespace-nowrap">분기</th>
                  <th className="text-right font-normal py-1 px-2 whitespace-nowrap">매출</th>
                  <th className="text-right font-normal py-1 pl-2 whitespace-nowrap">영업이익</th>
                </tr>
              </thead>
              <tbody>
                {quarterly.map((q) => (
                  <tr key={q.yymm} className="border-t border-slate-800/60">
                    <td className="py-1.5 pr-2 text-slate-400 whitespace-nowrap">{q.label}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-slate-300 whitespace-nowrap">
                      {q.revenue !== null ? `${fmt(q.revenue)}억` : '-'}
                      {q.revenueYoy !== null && <span className={`ml-1 ${yoyTone(q.revenueYoy)}`}>({q.revenueYoy >= 0 ? '+' : ''}{q.revenueYoy}%)</span>}
                    </td>
                    <td className={`py-1.5 pl-2 text-right font-mono whitespace-nowrap ${q.operatingProfit === null ? 'text-slate-300' : q.operatingProfit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {q.operatingProfit !== null ? `${q.operatingProfit >= 0 ? '+' : ''}${fmt(q.operatingProfit)}억` : '-'}
                      {q.operatingProfitYoy !== null && <span className={`ml-1 ${yoyTone(q.operatingProfitYoy)}`}>({q.operatingProfitYoy >= 0 ? '+' : ''}{q.operatingProfitYoy}%)</span>}
                      {q.operatingProfitTurn && <span className="ml-1 text-amber-300">({q.operatingProfitTurn})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {narrative}
    </div>
  );
}

export default FinancialsTrendCard;
