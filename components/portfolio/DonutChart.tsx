'use client';

import { useState, type ReactNode } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { sliceColorCycled } from '@/lib/chart-palette';
import { useChartEntranceAnimation } from '@/lib/chart-animation';

// 범용 도넛 차트 (2026-09-01) — 대시보드 "종목별 투자비중/산업군별 비중"이 쓰던 패턴을 그대로
// 공용화: 마우스를 따라다니는 툴팁 대신 도넛 중앙(항상 비어 있는 고정 위치)에 호버한 조각의
// 이름·값·비율을 표시하고(범례와 겹침이 구조적으로 불가능), 하단에 색 점 + 이름 + % 범례.
// 대시보드 두 도넛과 포트폴리오분석 "섹터 편중도/변동성 기여도"가 모두 이 컴포넌트를 쓴다.
//
// 아주 작은 비중(1~2%)도 조각으로 보이도록 minAngle을 두고, 종목이 많을 때(8개 초과)는
// 범례 간격을 줄여 줄바꿈이 자연스럽게 되게 한다 — 범례는 flex-wrap이라 깨지지 않는다.

export interface DonutSlice {
  key: string;
  name: string;
  value: number;        // 조각 크기(금액이든 %든 상대값)
  pct?: number;         // 표시용 %(없으면 value/합계로 계산)
  detail?: string;      // 호버 시 이름 아래 한 줄(예: 평가금액 "1,234,000원")
  color?: string;       // 없으면 팔레트 순환
  badge?: ReactNode;    // 범례에서 이름 옆에 붙는 배지(예: 과집중)
}

function fmtPct(n: number) { return `${n.toFixed(1)}%`; }

export default function DonutChart({
  slices,
  centerLabel,
  centerValue,
  centerSub,
  height = 200,
  legendClassName = '',
}: {
  slices: DonutSlice[];
  centerLabel: ReactNode;   // 호버 없을 때 중앙 위 작은 라벨
  centerValue: ReactNode;   // 호버 없을 때 중앙 큰 값
  centerSub?: ReactNode;    // 호버 없을 때 중앙 아래 보조 줄
  height?: number;
  legendClassName?: string;
}) {
  const anim = useChartEntranceAnimation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const total = slices.reduce((s, d) => s + Math.max(d.value, 0), 0);
  const colored = slices.map((d, i) => ({
    ...d,
    color: d.color ?? sliceColorCycled(i),
    pct: d.pct ?? (total > 0 ? (Math.max(d.value, 0) / total) * 100 : 0),
  }));
  const active = activeIndex != null ? colored[activeIndex] : null;

  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={colored}
              dataKey="value"
              nameKey="name"
              innerRadius={62}
              outerRadius={90}
              paddingAngle={2}
              cornerRadius={3}
              minAngle={3}
              stroke="none"
              onMouseEnter={(_, i) => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              {...anim}
            >
              {colored.map((d, i) => <Cell key={d.key ?? i} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-8 text-center">
          {active ? (
            <>
              <p className="text-[11px] text-slate-500 uppercase tracking-wide truncate max-w-full">{active.name}</p>
              {active.detail && <p className="text-[13px] font-bold font-mono text-white truncate max-w-full">{active.detail}</p>}
              <p className={`font-mono ${active.detail ? 'text-[11px] text-slate-400' : 'text-[15px] font-bold text-white'}`}>{fmtPct(active.pct)}</p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-slate-500 uppercase tracking-wide truncate max-w-full">{centerLabel}</p>
              <div className="text-[15px] font-bold font-mono text-white leading-tight">{centerValue}</div>
              {centerSub && <div className="text-[11px] text-slate-400 mt-0.5">{centerSub}</div>}
            </>
          )}
        </div>
      </div>
      <div className={`flex flex-wrap ${colored.length > 8 ? 'gap-x-2.5' : 'gap-x-4'} gap-y-1.5 mt-3 justify-center ${legendClassName}`}>
        {colored.map((d, i) => (
          <div
            key={d.key ?? i}
            className={`flex items-center gap-1.5 cursor-default ${activeIndex !== null && activeIndex !== i ? 'opacity-50' : ''}`}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-[11px] text-slate-400">{d.name}</span>
            {d.badge}
            <span className="text-[11px] text-slate-500 font-mono">{fmtPct(d.pct)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
