'use client';

import type { WeightDriftRow } from '@/lib/portfolio-position';

// "매입 비중 vs 현재 비중" 드리프트 카드 (2026-09-01 신설) — 처음 매입할 때 배분했던 비중
// (매입가×수량)과 지금 비중(현재가×수량)을 종목별로 나란히 보여준다. 손실 종목의 비중이
// 저절로 줄고 이익 종목의 비중이 커지는 "구조의 이동"을 숫자 두 개와 막대 두 개로 직관화.
// 순수 사실 서술(판단·권유 없음). 포트폴리오분석 메인·공유·대시보드가 이 하나를 같이 쓴다.
// 색 규칙: 비중이 커진 종목 = 빨강(수익 관례), 줄어든 종목 = 파랑 — 페이지 전체 관례와 동일.
export default function WeightDriftCard({
  rows,
  className = '',
}: {
  rows: WeightDriftRow[];
  className?: string;
}) {
  if (rows.length === 0) return null;
  const maxW = Math.max(1, ...rows.flatMap(r => [r.buyWeight, r.currentWeight]));
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">매입 비중 vs 현재 비중</p>
      <p className="text-[11px] text-slate-500 leading-relaxed mb-4">
        처음 매입할 때의 배분(매입가×수량)과 지금의 배분(현재가×수량)입니다. 가격이 오른 종목은 손대지 않아도 비중이 커지고, 내린 종목은 비중이 줄어듭니다.
      </p>
      <div className="flex items-center gap-4 text-[11px] text-slate-500 mb-3">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-full bg-slate-500/70" />매입 시점</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-full bg-indigo-400" />현재</span>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const up = r.deltaPp > 0;
          const flat = Math.abs(r.deltaPp) < 0.05;
          return (
            <div key={r.ticker}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[13px] text-slate-300 font-medium truncate">{r.name}</span>
                <span className="font-mono text-[12px] text-slate-400 whitespace-nowrap">
                  {r.buyWeight.toFixed(1)}% <span className="text-slate-600">→</span> <span className="text-slate-200 font-semibold">{r.currentWeight.toFixed(1)}%</span>
                  <span className={`ml-1.5 text-[11px] font-bold ${flat ? 'text-slate-500' : up ? 'text-red-400' : 'text-blue-400'}`}>
                    ({r.deltaPp > 0 ? '+' : ''}{r.deltaPp.toFixed(1)}%p)
                  </span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1e293b' }}>
                  <div className="h-full rounded-full bg-slate-500/70" style={{ width: `${(r.buyWeight / maxW) * 100}%` }} />
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1e293b' }}>
                  <div className="h-full rounded-full bg-indigo-400" style={{ width: `${(r.currentWeight / maxW) * 100}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
