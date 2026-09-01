'use client';

import type { HoldingPositionSummary } from '@/lib/portfolio-position';

// 기업별 관찰 지표 — 각 종목 카드 상단 "이 종목이 내 포트폴리오에서 차지하는 위치" 한 줄
// (2026-09-01). 비중·손익 기여·변동성 기여를 칩으로 나열해 뉴스 서술보다 먼저 보이게 한다.
// 숫자는 lib/portfolio-position.ts의 buildHoldingPositionSummary가 계산한 값만 표시한다.
export default function HoldingPositionLine({ s, className = '' }: { s: HoldingPositionSummary; className?: string }) {
  const chip = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700/60 text-[11px] text-slate-400 whitespace-nowrap';
  const num = 'font-mono font-semibold text-slate-200';
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className={chip}>포트폴리오 비중 <span className={num}>{s.weightPct.toFixed(1)}%</span></span>
      {s.pnlSharePct !== null && s.pnlShareKind && (
        <span className={chip}>
          전체 {s.pnlShareKind === 'loss' ? '손실' : '이익'}의{' '}
          <span className={`font-mono font-semibold ${s.pnlShareKind === 'loss' ? 'text-blue-300' : 'text-red-300'}`}>{s.pnlSharePct.toFixed(1)}%</span>
        </span>
      )}
      {s.riskPct !== null && (
        <span className={chip}>변동성 기여 <span className={num}>{s.riskPct.toFixed(1)}%</span></span>
      )}
    </div>
  );
}
