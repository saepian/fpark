'use client';

import { useState } from 'react';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';

export interface DartDividendSummary {
  year:             string;
  dividendYield:    number | null;
  dividendPerShare: number | null;
  payoutRatio:      number | null;
}

export interface DividendHistoryRow {
  recordDate:     string;
  kind:           '분기' | '결산';
  kindLabel:      string;
  perShareAmount: number;
  dividendRate:   number | null;
  payDate:        string | null;
}

// 기업분석 "배당 정보" 섹션 — DART 최신 사업연도 요약(미니 카드) + KIS 최근 5년
// 배당 지급 이력(표). 무배당 종목(summary도 없고 history도 빈 배열)이어도 섹션
// 자체는 숨기지 않고 "배당이 없는 종목입니다"를 보여준다(사용자 확정 사양).
// 요약/이력 둘 다 있을 때만 탭으로 전환하고, 하나만 있으면 굳이 탭 UI를 보여줄
// 이유가 없어(탭이 1개면 무의미) 기존처럼 단일 블록으로 바로 보여준다.
export default function DividendInfo({
  summary,
  history,
}: {
  summary: DartDividendSummary | null;
  history: DividendHistoryRow[];
}) {
  const isEmpty = !summary && history.length === 0;
  const hasBoth = !!summary && history.length > 0;
  const [tab, setTab] = useState<'summary' | 'history'>('summary');

  const showSummary = !!summary && (!hasBoth || tab === 'summary');
  const showHistory = history.length > 0 && (!hasBoth || tab === 'history');

  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between gap-2 mb-4">
        <p className={`${SECTION_TITLE_CLASS} text-slate-400 uppercase tracking-widest`}>배당 정보</p>
        {hasBoth && (
          <div className="flex items-center gap-1">
            {(['summary', 'history'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                  tab === t
                    ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'
                    : 'border border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                {t === 'summary' ? '요약' : '이력'}
              </button>
            ))}
          </div>
        )}
      </div>

      {isEmpty ? (
        <p className="text-[13px] text-slate-500">배당이 없는 종목입니다.</p>
      ) : (
        <>
          {showSummary && summary && (
            <div className="mb-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-800/40 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-slate-500 mb-1">배당수익률</p>
                  <p className="text-[15px] font-bold font-mono text-slate-200">
                    {summary.dividendYield !== null ? `${summary.dividendYield.toFixed(2)}%` : '-'}
                  </p>
                </div>
                <div className="bg-slate-800/40 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-slate-500 mb-1">주당배당금</p>
                  <p className="text-[15px] font-bold font-mono text-slate-200">
                    {summary.dividendPerShare !== null ? `${summary.dividendPerShare.toLocaleString()}원` : '-'}
                  </p>
                </div>
                <div className="bg-slate-800/40 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-slate-500 mb-1">배당성향</p>
                  <p className="text-[15px] font-bold font-mono text-slate-200">
                    {summary.payoutRatio !== null ? `${summary.payoutRatio.toFixed(1)}%` : '-'}
                  </p>
                </div>
              </div>
              <p className="text-[10px] text-slate-600 mt-2">{summary.year}년 사업연도 기준 (DART 사업보고서)</p>
            </div>
          )}

          {showHistory && (
            <div className="overflow-x-auto">
              <table className="min-w-[480px] w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-700/50">
                    <th className="text-left pb-2.5 font-medium">기준일</th>
                    <th className="text-left pb-2.5 font-medium">구분</th>
                    <th className="text-right pb-2.5 font-medium">배당금액</th>
                    <th className="text-right pb-2.5 font-medium">배당율</th>
                    <th className="text-right pb-2.5 font-medium">지급일</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.recordDate} className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 text-slate-300 whitespace-nowrap">{row.recordDate}</td>
                      <td className="py-2.5 text-slate-400 whitespace-nowrap">{row.kindLabel}</td>
                      <td className="py-2.5 text-right font-mono text-slate-200 whitespace-nowrap">
                        {row.perShareAmount.toLocaleString()}원
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-200 whitespace-nowrap">
                        {row.dividendRate !== null ? `${row.dividendRate.toFixed(2)}%` : '-'}
                      </td>
                      <td className="py-2.5 text-right text-slate-500 whitespace-nowrap">
                        {row.payDate ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
