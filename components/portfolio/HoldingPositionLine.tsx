'use client';

import type { HoldingPositionSummary, HoldingIssueTag } from '@/lib/portfolio-position';

// 기업별 관찰 지표 — 각 종목 카드 상단 "이 종목이 내 포트폴리오에서 차지하는 위치" 한 줄
// (2026-09-01). 비중·손익 기여·변동성 기여를 칩으로 나열해 뉴스 서술보다 먼저 보이게 한다.
// 숫자는 lib/portfolio-position.ts의 buildHoldingPositionSummary가 계산한 값만 표시한다.
// 2026-09-03 최종 다듬기: "종목별 개별 이슈" 카드(리스크/긍정 문장)를 제거하고, 그 판정을
// 이 줄 끝의 작은 성격 태그(🔴 리스크 / 🟢 긍정, 없으면 생략)로 흡수했다 — 카드 문장이
// 바로 아래 종목 서술과 같은 뉴스를 반복했기 때문.
export default function HoldingPositionLine({
  s,
  issueTag = null,
  className = '',
}: {
  s: HoldingPositionSummary;
  issueTag?: HoldingIssueTag | null;
  className?: string;
}) {
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
      {issueTag === 'risk' && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 whitespace-nowrap" title="이 종목 고유의 부정 요인이 관찰됨 — 아래 서술 참고">
          🔴 리스크
        </span>
      )}
      {issueTag === 'positive' && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 whitespace-nowrap" title="이 종목 고유의 긍정 요인이 관찰됨 — 아래 서술 참고">
          🟢 긍정
        </span>
      )}
    </div>
  );
}
