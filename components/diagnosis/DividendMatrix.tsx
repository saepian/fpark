'use client';

import { useState } from 'react';

// app/portfolio-diagnosis/page.tsx, app/share/[id]/page.tsx의 DividendMatrixRow/Cell과 동일
// shape(lib/dividend-aggregation.ts 손복제) — 두 페이지 모두 여기 하나로 렌더링을 공유한다.
// share 페이지는 async 서버 컴포넌트라 클릭→모달 같은 상태는 그 안에 직접 둘 수 없어서,
// 이 파일만은 예외적으로 클라이언트 컴포넌트로 분리해 양쪽에서 import한다(그 외 타입/카드
// 레이아웃은 기존 관례대로 각 페이지에 손복제).
export type DividendMatrixRecord = {
  year:           number;
  recordDate:     string;
  payDate:        string | null;
  kind:           '분기' | '결산';
  kindLabel:      string;
  perShareAmount: number;
};
export type DividendMatrixCell = {
  count:   number;
  records: DividendMatrixRecord[];
};
export type DividendMatrixRow = {
  ticker: string;
  name:   string;
  months: (DividendMatrixCell | null)[];
};

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);

function formatPayDate(payDate: string): string {
  const [, m, d] = payDate.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export default function DividendMatrix({ rows }: { rows: DividendMatrixRow[] }) {
  const [selected, setSelected] = useState<{ row: DividendMatrixRow; month: number } | null>(null);

  if (rows.length === 0) return null;

  const selectedCell = selected ? selected.row.months[selected.month - 1] : null;

  return (
    <>
      {/* 2026-09-03: "×5" 배지의 의미(최근 5년 중 그 달에 지급한 횟수)를 범례로 명시 — 배지만으로는
          "5주"인지 "5번"인지 알 수 없다는 검토 피드백. 칸의 title 툴팁에도 같은 뜻을 담는다. */}
      <p className="text-[11px] text-slate-500 mb-2">
        <span className="inline-flex items-center justify-center min-w-[30px] h-[18px] rounded-md bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 font-mono font-semibold mr-1.5 px-1">×N</span>
        최근 5년 중 그 달에 배당을 지급한 횟수(연도 수) — 칸을 클릭하면 연도별 지급일·금액
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-[620px] w-full text-xs border-separate border-spacing-y-1.5">
          <thead>
            <tr>
              <th className="sticky left-0 bg-[#1a1f2e] text-left text-[11px] text-slate-500 font-medium pb-1 pr-2 z-10">
                종목
              </th>
              {MONTH_LABELS.map(label => (
                <th key={label} className="text-[11px] text-slate-500 font-medium pb-1 text-center w-[44px]">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.ticker}>
                <td className="sticky left-0 bg-[#1a1f2e] text-[11px] text-slate-300 font-medium pr-2 whitespace-nowrap max-w-[110px] truncate">
                  {row.name}
                </td>
                {row.months.map((cell, i) => (
                  <td key={i} className="text-center px-0.5">
                    {cell ? (
                      <button
                        type="button"
                        onClick={() => setSelected({ row, month: i + 1 })}
                        className="w-full min-h-[36px] rounded-lg bg-indigo-500/10 border border-indigo-500/25
                          hover:bg-indigo-500/20 transition-colors flex items-center justify-center cursor-pointer"
                        title={`${row.name} · ${i + 1}월 — 최근 5년 중 ${cell.count}회 지급 (클릭하면 연도별 내역)`}
                      >
                        <span className="text-[11px] text-indigo-300 font-mono font-semibold">×{cell.count}</span>
                      </button>
                    ) : (
                      <div className="w-full min-h-[36px] rounded-lg bg-slate-800/30 border border-slate-800/40" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && selectedCell && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-[#1a1f2e] border border-indigo-500/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <h3 className="text-[15px] font-bold text-white">
                {selected.row.name} · {selected.month}월
              </h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer text-[13px] shrink-0"
              >
                닫기
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {selectedCell.records.map((r, i) => (
                <div key={i} className="bg-slate-800/40 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] text-slate-300 font-medium">
                      {r.payDate
                        ? `${r.year}년 ${formatPayDate(r.payDate)} 지급`
                        : `${r.year}년 배당기준일 ${r.recordDate}(지급일 미확정)`}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{r.kindLabel}</p>
                  </div>
                  <p className="text-[13px] font-mono font-semibold text-indigo-300 whitespace-nowrap">
                    주당 {r.perShareAmount.toLocaleString()}원
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-600 mt-4 leading-relaxed">
              최근 5년 실제 지급 이력이며, 지급 정책 변경 등으로 매년 같은 달에 지급되지 않을 수 있습니다.
              향후 지급을 예측하거나 보장하지 않습니다.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
