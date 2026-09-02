'use client';

import { ResponsiveContainer, LineChart, Line } from 'recharts';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';

// "업종 대비" 카드 전체 — diagnosis 메인 페이지(DiagnosisReport.tsx)와 공유 페이지
// (app/share/[id]/page.tsx)가 완전히 동일하게 렌더링해야 하는데, 예전엔 스파크라인
// 차트(SectorSparkline)와 sectorName/peerNames 캡션 줄이 DiagnosisReport.tsx에만 있고
// 공유 페이지엔 아예 없었다(2026-08-31 오픈 전 QA에서 실측 확인 — 메인/공유 드리프트
// 실패 패턴). 카드 전체를 여기 하나로 옮겨 두 페이지가 같은 컴포넌트를 그대로 쓰게 해서
// 이 종류의 드리프트가 구조적으로 재발하지 않게 한다.
export interface SectorComparison {
  peerAvgChangeRate: number;
  deltaVsPeer: number;
  sectorName?: string;   // KIS 업종명(예: "전기·전자") — 없으면 캡션에서 생략
  peerNames?: string[];  // 비교에 쓰인 동종업계 peer 종목명 전체(평균 계산에 쓰인 개수와 동일)
  sparkline?: { dates: string[]; stockReturns: number[]; peerAvgReturns: number[] } | null;
  basis?: 'today' | 'prevClose'; // 2026-09-02 신설 — 'prevClose'면 개장 전 생성이라 전일 마감 등락률로 계산(옛 레코드는 undefined=당일)
  basisDate?: string;            // basis='prevClose'일 때 그 마감일(YYYY-MM-DD)
}

function fmtMonthDay(d: string): string {
  const p = d.split('-');
  return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : d;
}

function fmtRate(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

// 최근 1개월 상대수익률(이 종목 vs peer 평균, 첫날 대비 누적%)을 축·범례 없이 보여주는
// 작은 스파크라인 — MarketSummary.tsx의 MiniAreaChart와 같은 "축·범례 없는 미니 차트"
// 원칙을 따르되, 여기는 실제 시계열 2개(가짜 장식용 곡선이 아님)라 범례 대신 아래 10px
// 캡션으로 색을 설명한다.
function SectorSparkline({ sparkline }: { sparkline: NonNullable<SectorComparison['sparkline']> }) {
  const data = sparkline.dates.map((d, i) => ({
    date: d,
    stock: sparkline.stockReturns[i],
    peerAvg: sparkline.peerAvgReturns[i],
  }));
  return (
    <div className="mb-2">
      <div style={{ height: 44 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <Line type="monotone" dataKey="peerAvg" stroke="#64748b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="stock" stroke="#818cf8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-3 mt-1">
        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          <span className="w-2 h-0.5 rounded-full bg-indigo-400 inline-block" /> 이 종목
        </span>
        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          <span className="w-2 h-0.5 rounded-full bg-slate-500 inline-block" /> 업종 평균
        </span>
        <span className="text-[11px] text-slate-600 ml-auto">최근 {data.length}거래일</span>
      </div>
    </div>
  );
}

// narrative는 완성된 문자열 그대로 넘겨도 되고(공유 페이지), 메인 페이지처럼 스트리밍
// 타이핑 커서를 붙인 JSX를 넘겨도 된다 — 이 컴포넌트는 그냥 그대로 렌더링만 한다.
export function SectorComparisonCard({
  data,
  narrative,
}: {
  data: SectorComparison;
  narrative?: React.ReactNode;
}) {
  const prevClose = data.basis === 'prevClose';
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <p className={`${SECTION_TITLE_CLASS} text-slate-400 uppercase tracking-widest`}>업종 대비</p>
        {prevClose && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300/90 whitespace-nowrap">
            전일{data.basisDate ? `(${fmtMonthDay(data.basisDate)})` : ''} 마감 기준
          </span>
        )}
      </div>
      <div className="flex flex-col divide-y divide-slate-700/40 mb-3">
        <div className="flex items-center justify-between py-2 first:pt-0">
          <span className="text-[12px] text-slate-400">업종 평균 등락률{prevClose ? ' (전일)' : ''}</span>
          <span className="text-[13px] font-bold font-mono text-slate-300">{fmtRate(data.peerAvgChangeRate)}</span>
        </div>
        <div className="flex items-center justify-between py-2 last:pb-0">
          <span className="text-[12px] text-slate-400">업종 대비 차이</span>
          <span className={`text-[13px] font-bold font-mono ${data.deltaVsPeer >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
            {data.deltaVsPeer >= 0 ? '+' : ''}{data.deltaVsPeer.toFixed(2)}%p
          </span>
        </div>
      </div>
      {prevClose && (
        <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">
          개장 전 생성이라 당일 등락률이 아직 없어 전일 마감 등락률로 비교했습니다.
        </p>
      )}
      {(data.sectorName || (data.peerNames?.length ?? 0) > 0) && (
        <p className="text-[11px] text-slate-500 mb-2">
          {data.sectorName}
          {(data.peerNames?.length ?? 0) > 0 && (
            <>
              {data.sectorName ? ' · ' : ''}
              {data.peerNames!.slice(0, 3).join('·')} 등 {data.peerNames!.length}개 종목 평균
            </>
          )}
        </p>
      )}
      {data.sparkline && <SectorSparkline sparkline={data.sparkline} />}
      {narrative}
    </div>
  );
}
