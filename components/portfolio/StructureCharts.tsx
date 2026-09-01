'use client';

import DonutChart, { type DonutSlice } from '@/components/portfolio/DonutChart';
import { SLICE_COLORS } from '@/lib/chart-palette';

// 포트폴리오분석 "섹터 편중도 분석"·"변동성 기여도" 도넛 카드 (2026-09-01) — 메인·공유·대시보드
// 공용. 예전엔 섹터/종목 수만큼 가로막대가 세로로 늘어졌다 → 대시보드 도넛과 같은 시각 언어로
// 바꾸고 두 카드를 데스크톱에서 2열(모바일 세로 스택)로 붙여 세로 공간을 줄였다.

export interface SectorSlice { name: string; weight: number; warning: boolean; tickers?: string[] }
export interface SectorConcentration { hhi: number; effectiveCount: number; grade: '고집중' | '보통' | '분산' }
export interface RiskContributionSlice { ticker: string; name: string; pct: number }

const GRADE_COLOR: Record<SectorConcentration['grade'], string> = { '고집중': '#f87171', '보통': '#fbbf24', '분산': '#34d399' };

function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 min-w-0">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col items-center gap-3 animate-pulse py-2">
      <div className="w-[180px] h-[180px] rounded-full border-[28px] border-slate-700/40" />
      <div className="h-3 w-2/3 rounded bg-slate-700/40" />
    </div>
  );
}

// 종목 수 부족(1종목)으로 정량 지표를 계산하지 않을 때 카드 안에 보여주는 캡션.
export function QuantSuppressedCaption() {
  return (
    <p className="text-[11px] text-slate-600 bg-slate-800/30 border border-slate-700/40 rounded-xl px-4 py-3">
      종목 수가 적어 섹터 집중도·상관관계·리스크 기여도는 계산하지 않습니다(2종목 이상부터 계산).
    </p>
  );
}

export function SectorConcentrationDonut({
  sectors,
  concentration,
  suppressed = false,
}: {
  sectors: SectorSlice[];
  concentration: SectorConcentration | null | undefined;
  suppressed?: boolean;
}) {
  const sorted = [...sectors].sort((a, b) => b.weight - a.weight);
  const slices: DonutSlice[] = sorted.map((s, i) => ({
    key: s.name,
    name: s.name,
    value: s.weight,
    pct: s.weight,
    color: s.warning ? '#ef4444' : SLICE_COLORS[i % SLICE_COLORS.length],
    badge: s.warning ? (
      <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>과집중</span>
    ) : undefined,
  }));
  return (
    <CardShell title="섹터 편중도 분석">
      {suppressed && <div className="mb-3"><QuantSuppressedCaption /></div>}
      <DonutChart
        slices={slices}
        centerLabel={concentration ? '섹터 집중도' : '업종 수'}
        centerValue={concentration
          ? <span style={{ color: GRADE_COLOR[concentration.grade] }}>{concentration.grade}</span>
          : `${sorted.length}개`}
        centerSub={concentration ? `실효 ${concentration.effectiveCount}개 업종` : undefined}
      />
    </CardShell>
  );
}

export function RiskContributionDonut({ riskContribution }: { riskContribution: RiskContributionSlice[] }) {
  const sorted = [...riskContribution].sort((a, b) => b.pct - a.pct);
  const top = sorted[0];
  const slices: DonutSlice[] = sorted.map((r, i) => ({ key: r.ticker, name: r.name, value: r.pct, pct: r.pct, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  return (
    <CardShell title="변동성 기여도">
      <DonutChart
        slices={slices}
        centerLabel="최대 기여"
        centerValue={<span className="truncate block max-w-[110px]">{top?.name ?? '-'}</span>}
        centerSub={top ? `${top.pct.toFixed(1)}%` : undefined}
      />
      <p className="text-[11px] text-slate-500 leading-relaxed mt-4">
        각 종목의 가격 변동이 포트폴리오 전체의 흔들림(변동성)에 얼마나 기여하는지를 비율로 나타낸 값입니다.
        보유 비중이 크거나 가격이 많이 출렁이는 종목일수록 높게 나옵니다.
        종목들이 서로 같이 움직이는 정도(상관관계)는 계산에 넣지 않은 근사치라, 실제 포트폴리오 변동성과는 차이가 있을 수 있습니다.
      </p>
    </CardShell>
  );
}

// 두 카드를 한 행에 — 데스크톱 2열 / 모바일 세로 스택. 한쪽만 있으면 1열. sectors가 아직
// 도착 전(pending)이면 섹터 카드 자리에 스켈레톤.
export function StructureChartsRow({
  sectors,
  concentration,
  riskContribution,
  suppressed = false,
  pending = false,
  className = '',
}: {
  sectors: SectorSlice[] | null | undefined;
  concentration: SectorConcentration | null | undefined;
  riskContribution: RiskContributionSlice[] | null | undefined;
  suppressed?: boolean;
  pending?: boolean;
  className?: string;
}) {
  const showSector = pending || (!!sectors && sectors.length > 0);
  const showRisk = !!riskContribution && riskContribution.length > 0;
  if (!showSector && !showRisk) return null;
  const both = showSector && showRisk;
  return (
    <div className={`grid grid-cols-1 ${both ? 'md:grid-cols-2' : ''} gap-4 ${className}`}>
      {showSector && (
        sectors && sectors.length > 0
          ? <SectorConcentrationDonut sectors={sectors} concentration={concentration} suppressed={suppressed} />
          : <CardShell title="섹터 편중도 분석"><Skeleton /></CardShell>
      )}
      {showRisk && <RiskContributionDonut riskContribution={riskContribution!} />}
    </div>
  );
}
