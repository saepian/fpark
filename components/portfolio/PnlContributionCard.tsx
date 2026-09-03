'use client';

import { computePnlSums } from '@/lib/portfolio-position';

// "종목별 손익 기여" 카드 (2026-09-03 최종 다듬기 신설) — AI 종합평가가 가장 강조하는 손익 구조
// ("종근당 하나가 전체 손실의 60.7%")가 글로만 있고 시각화가 없었다. 종목별 평가손익(매입가 대비
// 누적, 서버가 이미 계산한 holdings[].profit)을 부호 있는 가로막대로 — 손실은 중앙축 왼쪽 파란
// 막대, 이익은 오른쪽 빨간 막대(페이지 전체 색 관례) — 보여주고, 금액과 "전체 손실/이익의 X%"
// (같은 방향 종목만 더한 값 대비, HoldingPositionLine의 배지와 동일 정의)를 막대 위 줄 오른쪽에
// 붙인다. 처음엔 막대 끝에 라벨을 붙였는데 막대가 절반을 다 채우는 최대 종목에서 라벨이 밀려
// 사라지고(실측), 390px에서는 절반 폭에 금액+비율이 들어가지 않아 WeightDriftCard와 같은
// "이름·수치 한 줄 + 막대 한 줄" 배치로 바꿨다. 순수 사실 서술(판단·권유 없음). 메인·공유 공용.
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
      <p className="text-[15px] font-bold text-slate-500 uppercase tracking-widest mb-1">종목별 손익 기여</p>
      <p className="text-[11px] text-slate-500 leading-relaxed mb-4">
        매입가 대비 평가손익을 종목별로 나란히 놓은 것입니다. 손실(왼쪽)과 이익(오른쪽)이 어느 종목에서 만들어지는지 — 비율은 같은 방향 종목만 더한 값 대비입니다.
      </p>
      <div className="flex items-center gap-4 text-[11px] text-slate-500 mb-3">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-full bg-blue-400" />손실</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-full bg-red-400" />이익</span>
      </div>
      <div className="flex flex-col gap-3">
        {sorted.map((h) => {
          const loss = h.profit < 0;
          const widthPct = (Math.abs(h.profit) / maxAbs) * 100;
          const shareText = share(h.profit);
          return (
            <div key={h.ticker}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[13px] text-slate-300 font-medium truncate">{h.name}</span>
                <span className={`font-mono text-[12px] whitespace-nowrap ${loss ? 'text-blue-300' : h.profit > 0 ? 'text-red-300' : 'text-slate-500'}`}>
                  {won(h.profit)}
                  {shareText && <span className="text-[11px] text-slate-500 ml-1.5">· {shareText}</span>}
                </span>
              </div>
              <div className="grid grid-cols-2 items-center">
                {/* 왼쪽 절반 — 손실 막대(중앙축에서 왼쪽으로) */}
                <div className="flex justify-end border-r border-slate-600/70 h-2.5">
                  {loss && <div className="h-full rounded-l-full bg-blue-400/80" style={{ width: `${Math.max(widthPct, 1.5)}%` }} />}
                </div>
                {/* 오른쪽 절반 — 이익 막대(중앙축에서 오른쪽으로) */}
                <div className="flex justify-start h-2.5">
                  {h.profit > 0 && <div className="h-full rounded-r-full bg-red-400/80" style={{ width: `${Math.max(widthPct, 1.5)}%` }} />}
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
