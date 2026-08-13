'use client';

import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, LabelList,
  ScatterChart, Scatter, CartesianGrid, ReferenceLine, AreaChart, Area,
} from 'recharts';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { useChartEntranceAnimation } from '@/lib/chart-animation';

interface ChartHolding {
  ticker: string;
  name: string;
  currentPrice: number;
  quantity: number;
  avg_price: number;
}

export interface RiskPoint {
  ticker: string;
  mdd: number | null;
  volatility: number | null;
  fiveDayChange: number | null;
}

export interface MonthlyPoint {
  label: string;
  date: string;
  value: number;
  returnRate: number;
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

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: { payload: { name: string; volatility: number; profitRate: number } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2">
      <p className="text-[11px] font-semibold text-white mb-1">{d.name}</p>
      <p className="text-[11px] text-slate-400">변동성 {fmtPct(d.volatility)}</p>
      <p className="text-[11px] text-slate-400">수익률 {fmtPct(d.profitRate)}</p>
    </div>
  );
}

// 마커를 recharts 기본 반경보다 살짝 키우고(≥8px 규격) surface색 링을 둘러 겹치는
// 지점끼리도 구분되게 한다.
function ScatterDot({ cx, cy, fill }: { cx?: number; cy?: number; fill?: string }) {
  if (cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={7} fill={fill} stroke="#1a1f2e" strokeWidth={2} />;
}

export function RiskReturnScatterChart({ holdings, risk }: { holdings: ChartHolding[]; risk: RiskPoint[] }) {
  const anim = useChartEntranceAnimation();

  const riskByTicker = new Map(risk.map(r => [r.ticker, r.volatility]));
  const data = holdings
    .map((h, i) => {
      const volatility = riskByTicker.get(h.ticker);
      if (volatility == null) return null;
      const profitRate = h.avg_price > 0 ? ((h.currentPrice - h.avg_price) / h.avg_price) * 100 : 0;
      return { name: h.name, volatility, profitRate, color: i < MAX_DIRECT_SLICES ? SLICE_COLORS[i] : OTHER_COLOR };
    })
    .filter((d): d is { name: string; volatility: number; profitRate: number; color: string } => d !== null);

  const showLabels = data.length > 0 && data.length <= 8;

  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest`}>위험도 대비 수익률</p>
      <p className="text-[10px] text-slate-600 mb-3">가로: 변동성(낮음 → 높음) · 세로: 수익률 · 최근 약 5개월 기준</p>
      {data.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-[11px] text-slate-600">위험도 데이터를 불러오는 중...</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <ScatterChart margin={{ top: 26, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#334155" strokeOpacity={0.4} vertical={false} />
            <XAxis
              type="number" dataKey="volatility"
              domain={['dataMin - 0.3', 'dataMax + 0.3']}
              tick={{ fontSize: 10, fill: '#64748b' }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            />
            <YAxis
              type="number" dataKey="profitRate"
              domain={['dataMin - 5', 'dataMax + 15']}
              tick={{ fontSize: 10, fill: '#64748b' }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={44}
            />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            <Tooltip cursor={{ stroke: '#475569', strokeDasharray: '3 3' }} content={<ScatterTooltip />} />
            <Scatter data={data} shape={<ScatterDot />} {...anim}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
              {showLabels && (
                <LabelList
                  dataKey="name"
                  position="top"
                  offset={10}
                  style={{ fontSize: 10, fill: '#94a3b8' }}
                />
              )}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

const LINE_COLOR = '#818cf8'; // components/diagnosis/DiagnosisReport.tsx의 단일 라인차트와 동일한 인디고 액센트

function MonthlyTooltip({ active, payload }: { active?: boolean; payload?: { payload: MonthlyPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2">
      <p className="text-[11px] font-semibold text-white mb-1">{d.label}</p>
      <p className="text-[11px] text-slate-400">평가금액 {fmtWon(d.value)}</p>
      <p className="text-[11px] text-slate-400">수익률 {fmtPct(d.returnRate)}</p>
    </div>
  );
}

function EndDot({ cx, cy, index, dataLength }: { cx?: number; cy?: number; index?: number; dataLength: number }) {
  if (cx == null || cy == null) return null;
  const isLast = index === dataLength - 1;
  return <circle cx={cx} cy={cy} r={isLast ? 5 : 3} fill={LINE_COLOR} stroke="#1a1f2e" strokeWidth={2} />;
}

export function MonthlyReturnLineChart({ monthly }: { monthly: MonthlyPoint[] }) {
  const anim = useChartEntranceAnimation();
  const last = monthly[monthly.length - 1];

  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest`}>월별 수익률 추이</p>
      <p className="text-[10px] text-slate-600 mb-3">현재 투자원금 대비 누적 수익률 · 현재 보유 구성을 과거에도 유지했다고 가정</p>
      {monthly.length < 2 ? (
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-[11px] text-slate-600">추이 데이터를 불러오는 중...</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={monthly} margin={{ top: 16, right: 52, bottom: 0, left: 12 }}>
            <defs>
              <linearGradient id="monthlyReturnFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LINE_COLOR} stopOpacity={0.1} />
                <stop offset="100%" stopColor={LINE_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#334155" strokeOpacity={0.4} vertical={false} />
            <XAxis
              dataKey="label"
              interval={0}
              tick={{ fontSize: 10, fill: '#64748b' }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
            />
            <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            <Tooltip cursor={{ stroke: '#475569', strokeDasharray: '3 3' }} content={<MonthlyTooltip />} />
            <Area
              type="monotone"
              dataKey="returnRate"
              stroke={LINE_COLOR}
              strokeWidth={2}
              fill="url(#monthlyReturnFill)"
              dot={<EndDot dataLength={monthly.length} />}
              {...anim}
            >
              <LabelList
                dataKey="returnRate"
                content={(props) => {
                  const { x, y, index, value } = props as { x?: number; y?: number; index?: number; value?: number };
                  if (index !== monthly.length - 1 || x == null || y == null || value == null) return null;
                  return (
                    <text x={x + 8} y={y} dy={4} fontSize={11} fontFamily="monospace" fill={LINE_COLOR} textAnchor="start">
                      {fmtPct(value)}
                    </text>
                  );
                }}
              />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      )}
      {last && (
        <p className="text-[10px] text-slate-600 mt-1 text-right">최근: {last.label} 기준</p>
      )}
    </div>
  );
}
