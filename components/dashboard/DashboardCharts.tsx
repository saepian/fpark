'use client';

import {
  Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, LabelList,
  CartesianGrid, ReferenceLine, AreaChart, Area,
} from 'recharts';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { useChartEntranceAnimation } from '@/lib/chart-animation';
import { SLICE_COLORS, OTHER_COLOR, MAX_DIRECT_SLICES, sliceColorCycled } from '@/lib/chart-palette';
import DonutChart from '@/components/portfolio/DonutChart';

interface ChartHolding {
  ticker: string;
  name: string;
  currentPrice: number;
  quantity: number;
  avg_price: number;
  sector: string;
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

// 팔레트·순환 규칙은 lib/chart-palette.ts(2026-09-01 분리 — 포트폴리오분석 도넛과 공유).

const TOOLTIP_STYLE = {
  backgroundColor: '#1a1f2e',
  border: '1px solid #334155',
  borderRadius: '8px',
  fontSize: '11px',
};

function fmtWon(n: number) { return `${Math.round(n).toLocaleString()}원`; }
function fmtPct(n: number) { return `${n.toFixed(1)}%`; }

// 2026-09-01: 도넛 렌더링(중앙 고정 표시·호버·범례)은 components/portfolio/DonutChart로 공용화 —
// 포트폴리오분석 "섹터 편중도/변동성 기여도"와 같은 컴포넌트를 쓴다. 여기선 데이터 준비만.
export function AllocationDonutChart({ holdings }: { holdings: ChartHolding[] }) {
  const data = holdings
    .map(h => ({ name: h.name, value: h.currentPrice * h.quantity }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const totalValue = data.reduce((s, d) => s + d.value, 0);
  const slices = data.map((d, i) => ({ key: `${d.name}-${i}`, name: d.name, value: d.value, detail: fmtWon(d.value), color: sliceColorCycled(i) }));
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-4`}>종목별 투자비중</p>
      <DonutChart slices={slices} centerLabel="평가금액" centerValue={fmtWon(totalValue)} />
    </div>
  );
}

// 업종 대분류 매핑 테이블 없이 KIS bstp_kor_isnm(업종명)을 그대로 카테고리로 쓴다 —
// lib/sector-news.ts의 실측 확인대로 이 값 자체가 이미 세분류가 아니라 KRX 대분류
// (~20개) 수준이라, Tech/Finance 같은 영문 GICS로 재매핑하면 오히려 근거 없는 오분류
// 위험만 생긴다. 값이 비어있으면(조회 실패 등) "기타"로 폴백.
export function SectorAllocationDonutChart({ holdings }: { holdings: ChartHolding[] }) {
  const bySector = new Map<string, number>();
  for (const h of holdings) {
    const key = h.sector?.trim() || '기타';
    const value = h.currentPrice * h.quantity;
    if (value <= 0) continue;
    bySector.set(key, (bySector.get(key) ?? 0) + value);
  }
  const withValue = [...bySector.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const data = withValue.length > MAX_DIRECT_SLICES
    ? [...withValue.slice(0, MAX_DIRECT_SLICES), { name: '기타', value: withValue.slice(MAX_DIRECT_SLICES).reduce((s, d) => s + d.value, 0) }]
    : withValue;
  const slices = data.map((d, i) => ({ key: d.name, name: d.name, value: d.value, detail: fmtWon(d.value), color: d.name === '기타' ? OTHER_COLOR : SLICE_COLORS[i % MAX_DIRECT_SLICES] }));
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-4`}>산업군별 비중</p>
      <DonutChart slices={slices} centerLabel="업종 수" centerValue={`${data.length}개`} />
    </div>
  );
}

// 값 라벨을 막대의 "0(기준선)에서 먼 쪽 끝"에 붙인다 — recharts LabelList의
// position="top"은 막대 사각형의 위쪽 변에 붙이는데, 음수 막대는 사각형 위쪽 변이
// 기준선(=x축 종목명 근처)에 있어서 라벨이 종목명과 겹치는 문제가 있었다. 양수는
// 막대 끝(맨 위) 위에, 음수는 막대 끝(맨 아래) 아래에 붙여 항상 기준선 반대쪽에 오게 한다.
function renderBarValueLabel(props: unknown, fontSize = 11) {
  const { x, y, width, height, value } = props as { x?: number; y?: number; width?: number; height?: number; value?: number };
  if (x == null || y == null || width == null || height == null || value == null) return null;
  // recharts가 음수 막대에서 height를 음수로 보고할 때가 있어(y=막대 끝, y+height=기준선)
  // 부호를 가정하지 않고 실제 min/max로 "기준선에서 먼 쪽 끝"을 계산한다.
  const edgeTop = Math.min(y, y + height);
  const edgeBottom = Math.max(y, y + height);
  const cx = x + width / 2;
  const cy = value >= 0 ? edgeTop - 6 : edgeBottom + 12;
  return (
    <text x={cx} y={cy} textAnchor="middle" fontSize={fontSize} fontFamily="monospace" fill="#94a3b8">
      {fmtPct(value)}
    </text>
  );
}

export function ReturnBarChart({ holdings }: { holdings: ChartHolding[] }) {
  const anim = useChartEntranceAnimation();

  // 종목이 많아지면(최대 15개) 가로스크롤 대신 막대 폭·폰트를 줄여서 한 화면에
  // 다 들어가게 한다 — 이름 축약 길이도 같이 줄여 겹침을 막는다.
  const dense = holdings.length > 8;
  const nameLen = dense ? 3 : 4;
  const tickFontSize = 11;
  const maxBarSize = Math.max(14, Math.min(40, Math.floor(320 / holdings.length)));

  const data = holdings.map(h => ({
    name: h.name.length > nameLen + 1 ? `${h.name.slice(0, nameLen)}…` : h.name,
    fullName: h.name,
    profitRate: h.avg_price > 0 ? ((h.currentPrice - h.avg_price) / h.avg_price) * 100 : 0,
  }));

  // 'dataMin - N' 같은 고정 픽셀 패딩은 양수쪽에 극단값(수백%) 하나만 있어도 음수쪽
  // 막대가 기준선 바로 옆으로 짜부라져 라벨 놓을 자리가 없어진다(막대가 짧아서 라벨을
  // "막대 밖 12px"에 놓아도 x축 종목명과 겹침) — 데이터 범위 비례 패딩으로 항상 절대
  // 여백을 확보한다.
  const values = data.map(d => d.profitRate);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = Math.max(rawMax - rawMin, 1);
  const yDomain: [number, number] = [rawMin - span * 0.2, rawMax + span * 0.15];

  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-4`}>종목별 수익률 비교</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 24, right: 8, bottom: 8, left: 8 }}>
          <XAxis
            dataKey="name"
            interval={0}
            tick={{ fontSize: tickFontSize, fill: '#64748b' }}
            axisLine={{ stroke: '#334155' }}
            tickLine={false}
          />
          <YAxis hide domain={yDomain} />
          <Tooltip
            // 2026-08-14 cursor/labelStyle/itemStyle을 지정하지 않으면 recharts 기본값이
            // 각각 "막대 전체 높이를 덮는 밝은 회색 커서 배경"과 "검정 텍스트"라 다크
            // 테마에서 흰 배경이 값 라벨을 가리고, 종목명(label) 텍스트도 안 보였다.
            cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ color: '#94a3b8' }}
            formatter={(v: number) => [fmtPct(v), '수익률']}
            labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullName ?? ''}
          />
          <Bar dataKey="profitRate" radius={[3, 3, 0, 0]} maxBarSize={maxBarSize} {...anim}>
            {data.map((d, i) => <Cell key={i} fill={d.profitRate >= 0 ? '#ef4444' : '#3b82f6'} />)}
            <LabelList dataKey="profitRate" content={(p) => renderBarValueLabel(p, 11)} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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

type ReturnTrendMode = 'monthly' | 'daily';

// 토글로 전환할 때마다 진입 애니메이션을 다시 재생하고 싶은데, useChartEntranceAnimation은
// "최초 마운트 1회만" 재생하도록 설계돼 있다(5분 폴링 재생 방지). 이 내부 컴포넌트를
// mode를 key로 매번 새로 마운트시켜서, 폴링 때는 그대로 안 재생되고(같은 mode 유지 시
// 리마운트 없음) 토글로 mode가 바뀔 때만 자연스럽게 다시 재생되게 한다.
function ReturnTrendBody({ data }: { data: MonthlyPoint[] }) {
  const anim = useChartEntranceAnimation();

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 16, right: 52, bottom: 0, left: 12 }}>
        <defs>
          <linearGradient id="monthlyReturnFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LINE_COLOR} stopOpacity={0.1} />
            <stop offset="100%" stopColor={LINE_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#334155" strokeOpacity={0.4} vertical={false} />
        <XAxis
          dataKey="label"
          interval={data.length > 10 ? 'preserveStartEnd' : 0}
          tick={{ fontSize: 11, fill: '#64748b' }}
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
          dot={<EndDot dataLength={data.length} />}
          {...anim}
        >
          <LabelList
            dataKey="returnRate"
            content={(props) => {
              const { x, y, index, value } = props as { x?: number; y?: number; index?: number; value?: number };
              if (index !== data.length - 1 || x == null || y == null || value == null) return null;
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
  );
}

export function MonthlyReturnLineChart({ monthly, daily }: { monthly: MonthlyPoint[]; daily: MonthlyPoint[] }) {
  const [mode, setMode] = useState<ReturnTrendMode>('monthly');
  const data = mode === 'monthly' ? monthly : daily;
  const last = data[data.length - 1];

  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest`}>수익률 추이</p>
        <div className="flex bg-[#0d1117] rounded-lg p-0.5 border border-slate-800/60 shrink-0">
          {(['monthly', 'daily'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 font-mono text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                mode === m ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              {m === 'monthly' ? '월별' : '일별'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-slate-600 mb-3 mt-1">현재 투자원금 대비 누적 수익률 · 현재 보유 구성을 과거에도 유지했다고 가정</p>
      {data.length < 2 ? (
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-[11px] text-slate-600">추이 데이터를 불러오는 중...</p>
        </div>
      ) : (
        <ReturnTrendBody key={mode} data={data} />
      )}
      {last && (
        <p className="text-[11px] text-slate-600 mt-1 text-right">최근: {last.label} 기준</p>
      )}
    </div>
  );
}
