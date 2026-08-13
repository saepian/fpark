'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, LabelList } from 'recharts';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { useChartEntranceAnimation } from '@/lib/chart-animation';

interface ChartHolding {
  name: string;
  currentPrice: number;
  quantity: number;
  avg_price: number;
}

// dataviz 스킬 카테고리 팔레트(dark, adjacent-pair 검증 통과 순서) — 종목이 8개를
// 넘어가면 나머지는 "기타"(회색)로 접는다(9번째 슬롯을 새로 생성하지 않음).
const SLICE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER_COLOR = '#64748b';
const MAX_DIRECT_SLICES = 7;

const TOOLTIP_STYLE = {
  backgroundColor: '#1a1f2e',
  border: '1px solid #334155',
  borderRadius: '8px',
  fontSize: '11px',
};

function fmtWon(n: number) { return `${Math.round(n).toLocaleString()}원`; }
function fmtPct(n: number) { return `${n.toFixed(1)}%`; }

export function AllocationDonutChart({ holdings }: { holdings: ChartHolding[] }) {
  const anim = useChartEntranceAnimation();

  const withValue = holdings
    .map(h => ({ name: h.name, value: h.currentPrice * h.quantity }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const totalValue = withValue.reduce((s, d) => s + d.value, 0);

  const data = withValue.length > MAX_DIRECT_SLICES
    ? [
        ...withValue.slice(0, MAX_DIRECT_SLICES),
        { name: '기타', value: withValue.slice(MAX_DIRECT_SLICES).reduce((s, d) => s + d.value, 0) },
      ]
    : withValue;

  const colored = data.map((d, i) => ({
    ...d,
    color: i < MAX_DIRECT_SLICES ? SLICE_COLORS[i] : OTHER_COLOR,
    pct: totalValue > 0 ? (d.value / totalValue) * 100 : 0,
  }));

  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-4`}>종목별 투자비중</p>
      <div className="relative">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={colored}
              dataKey="value"
              nameKey="name"
              innerRadius={62}
              outerRadius={90}
              paddingAngle={2}
              cornerRadius={3}
              stroke="none"
              {...anim}
            >
              {colored.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, _n, entry) => [`${fmtWon(value)} (${fmtPct(entry.payload.pct)})`, entry.payload.name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">평가금액</p>
          <p className="text-[15px] font-bold font-mono text-white">{fmtWon(totalValue)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 justify-center">
        {colored.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-[11px] text-slate-400">{d.name}</span>
            <span className="text-[11px] text-slate-500 font-mono">{fmtPct(d.pct)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReturnBarChart({ holdings }: { holdings: ChartHolding[] }) {
  const anim = useChartEntranceAnimation();

  const data = holdings.map(h => ({
    name: h.name.length > 5 ? `${h.name.slice(0, 4)}…` : h.name,
    fullName: h.name,
    profitRate: h.avg_price > 0 ? ((h.currentPrice - h.avg_price) / h.avg_price) * 100 : 0,
  }));

  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-4`}>종목별 수익률 비교</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={{ stroke: '#334155' }}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: number) => [fmtPct(v), '수익률']}
            labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullName ?? ''}
          />
          <Bar dataKey="profitRate" radius={[3, 3, 0, 0]} maxBarSize={40} {...anim}>
            {data.map((d, i) => <Cell key={i} fill={d.profitRate >= 0 ? '#ef4444' : '#3b82f6'} />)}
            <LabelList
              dataKey="profitRate"
              position="top"
              formatter={(v: number) => fmtPct(v)}
              style={{ fontSize: 10, fill: '#94a3b8', fontFamily: 'monospace' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
