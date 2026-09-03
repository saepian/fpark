'use client';

import { computePnlSums } from '@/lib/portfolio-position';

// "종목별 손익 기여" 카드 (2026-09-03 최종 다듬기 신설) — AI 종합평가가 가장 강조하는 손익 구조
// ("종근당 하나가 전체 손실의 60.7%")가 글로만 있고 시각화가 없었다. 종목별 평가손익(매입가 대비
// 누적, 서버가 이미 계산한 holdings[].profit)을 부호 있는 가로막대로 — 손실은 중앙축 왼쪽 파란
// 막대, 이익은 오른쪽 빨간 막대(페이지 전체 색 관례) — 막대 끝에 금액과 "전체 손실/이익의 X%"
// (같은 방향 종목만 더한 값 대비, HoldingPositionLine의 배지와 동일 정의)를 붙인다.
// 순수 사실 서술(판단·권유 없음). 메인·공유 페이지가 이 하나를 같이 쓴다.
export default function PnlContributionCard({
  holdings,
  className = '',
}: {
  holdings: { ticker: string; name: string; profit: number }[];
  className?: string;
}) {
  const rows = holdings.filter((h) => Number.isFinite(h.profit));
  if (rows.length < 2) return null;
  const { lossSum, gainSum } = computePnlSums(rows);
  const total = rows.reduce((s, h) => s + h.profit, 0);
  const maxAbs = Math.max(1, ...rows.map((h) => Math.abs(h.profit)));
  const sorted = [...rows].sort((a, b) => a.profit - b.profit); // 손실 큰 순 → 이익 큰 순
  const won = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString()}원`;
  const share = (p: number) => {
    if (p < 0 && lossSum < 0) return `전체 손실의 ${((p / lossSum) * 100).toFixed(1)}%`;
    if (p > 0 && gainSum > 0) return `전체 이익의 ${((p / gainSum) * 100).toFixed(1)}%`;
    return null;
  };
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">종목별 손익 기여</p>
      <p className="text-[11px] text-slate-500 leading-relaxed mb-4">
        매입가 대비 평가손익을 종목별로 나란히 놓은 것입니다. 손실(왼쪽)과 이익(오른쪽)이 어느 종목에서 만들어지는지 — 비율은 같은 방향 종목만 더한 값 대비입니다.
      </p>
      <div className="flex items-center gap-4 text-[11px] text-slate-500 mb-3">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-full bg-blue-400" />손실</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-full bg-red-400" />이익</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {sorted.map((h) => {
          const loss = h.profit < 0;
          const widthPct = (Math.abs(h.profit) / maxAbs) * 100;
          const shareText = share(h.profit);
          const label = (
            <span className={`text-[11px] font-mono whitespace-nowrap ${loss ? 'text-blue-300' : h.profit > 0 ? 'text-red-300' : 'text-slate-500'}`}>
              {won(h.profit)}{shareText && <span className="text-slate-500 ml-1">· {shareText}</span>}
            </span>
          );
          return (
            <div key={h.ticker} className="grid grid-cols-[minmax(56px,88px)_1fr] items-center gap-2">
              <span className="text-[12px] text-slate-300 font-medium truncate">{h.name}</span>
              <div className="grid grid-cols-2 items-center min-w-0">
                {/* 왼쪽 절반 — 손실 막대(중앙축에서 왼쪽으로) */}
                <div className="flex items-center justify-end gap-2 min-w-0 pr-px border-r border-slate-600/70">
                  {loss && <span className="truncate">{label}</span>}
                  {loss && <div className="h-3.5 rounded-l-md bg-blue-400/80 shrink-0" style={{ width: `${Math.max(widthPct, 2)}%` }} />}
                </div>
                {/* 오른쪽 절반 — 이익 막대(중앙축에서 오른쪽으로) */}
                <div className="flex items-center gap-2 min-w-0 pl-px">
                  {!loss && h.profit > 0 && <div className="h-3.5 rounded-r-md bg-red-400/80 shrink-0" style={{ width: `${Math.max(widthPct, 2)}%` }} />}
                  {!loss && <span className="truncate">{label}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-600 mt-4 font-mono">
        손실 종목 합산 {won(lossSum)} · 이익 종목 합산 {won(gainSum)} · 총 손익 {won(total)}
      </p>
    </div>
  );
}
