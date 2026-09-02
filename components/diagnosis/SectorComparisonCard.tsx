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
  sectorName?: string;   // peer 선정에 실제로 쓰인 네이버 하위분류명(예: "반도체와반도체장비", 2026-09-02부터 KIS 대분류 대신 이 값) — 없으면 캡션에서 생략
  peerNames?: string[];  // 비교에 쓰인 동종업계 peer 종목명 전체(평균 계산에 쓰인 개수와 동일)
  sparkline?: {
    dates: string[]; stockReturns: number[]; peerAvgReturns: number[];
    // 2026-09-02 신설 — 업종 내 상위 3종목(기준: 같은 스파크라인 구간의 누적 등락률 상위, 캡션에 명시).
    // 없거나(peer 부족) 옛 레코드면 undefined — 스파크라인은 기존 2선(이 종목/업종 평균)만 표시.
    topPeers?: { name: string; returns: number[] }[];
  } | null;
  basis?: 'today' | 'prevClose'; // 2026-09-02 신설 — 'prevClose'면 개장 전 생성이라 전일 마감 등락률로 계산(옛 레코드는 undefined=당일)
  basisDate?: string;            // basis='prevClose'일 때 그 마감일(YYYY-MM-DD)
}

// 2026-09-02: 넓은 업종의 시가총액 유사도 필터(lib/sector-peers.ts)를 거치면 peer가
// 이 값 이하로 줄어들 수 있다 — 그 경우 "왜 이렇게 적은지" 안내 문구를 붙인다.
const SPARSE_PEER_THRESHOLD = 2;

function fmtMonthDay(d: string): string {
  const p = d.split('-');
  return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : d;
}

function fmtRate(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

// 업종 내 TOP3 peer 선 색 — 이 종목(indigo, 굵게 강조)·업종 평균(회색)과 겹치지 않게
// 채도 다른 3색을 얇은 선으로. 이 종목 선을 마지막에 그려 항상 맨 위에 오도록 한다.
const TOP_PEER_COLORS = ['#f59e0b', '#22c55e', '#e879f9']; // amber / green / fuchsia

// 최근 1개월 상대수익률(이 종목 vs peer 평균 vs 업종 TOP3, 첫날 대비 누적%)을 축 없이
// 보여주는 작은 스파크라인 — MarketSummary.tsx의 MiniAreaChart와 같은 "축 없는 미니 차트"
// 원칙을 따르되, 여기는 실제 시계열(가짜 장식용 곡선이 아님)이라 범례로 색을 설명한다.
// 2026-09-02: peer 6종목 중 TOP3(같은 구간 누적 등락률 상위)를 얇은 선 3개로 추가 — 5선이
// 되므로 이 종목만 굵게 강조하고 TOP3는 얇게 눌러 범례가 깨지지 않게 한다.
function SectorSparkline({ sparkline }: { sparkline: NonNullable<SectorComparison['sparkline']> }) {
  const topPeers = sparkline.topPeers ?? [];
  // peer가 정확히 1개면 "업종 평균"은 정의상 그 peer의 값 그 자체라 두 선이 항상 완전히
  // 겹친다 — 범례엔 3개(이 종목/업종 평균/peer명)가 보이는데 화면엔 선이 2개로만 보이는
  // 원인. 이 경우 평균 선을 따로 그리지 않고 peer 선 하나로 합쳐 범례도 2개로 줄인다.
  const singlePeer = topPeers.length === 1 ? topPeers[0] : null;
  const data = sparkline.dates.map((d, i) => {
    const row: Record<string, string | number> = {
      date: d,
      stock: sparkline.stockReturns[i],
      peerAvg: sparkline.peerAvgReturns[i],
    };
    topPeers.forEach((p, pi) => { row[`top${pi}`] = p.returns[i]; });
    return row;
  });
  return (
    <div className="mb-2">
      <div style={{ height: 64 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            {!singlePeer && topPeers.map((_, pi) => (
              <Line key={pi} type="monotone" dataKey={`top${pi}`} stroke={TOP_PEER_COLORS[pi]} strokeWidth={1} strokeOpacity={0.75} dot={false} isAnimationActive={false} />
            ))}
            <Line type="monotone" dataKey="peerAvg" stroke={singlePeer ? TOP_PEER_COLORS[0] : '#64748b'} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="stock" stroke="#818cf8" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
        <span className="flex items-center gap-1 text-[11px] text-slate-300 font-semibold">
          <span className="w-2 h-0.5 rounded-full bg-indigo-400 inline-block" /> 이 종목
        </span>
        {singlePeer ? (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <span className="w-2 h-0.5 rounded-full inline-block" style={{ backgroundColor: TOP_PEER_COLORS[0] }} /> {singlePeer.name}
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="w-2 h-0.5 rounded-full bg-slate-500 inline-block" /> 업종 평균
            </span>
            {topPeers.map((p, pi) => (
              <span key={p.name} className="flex items-center gap-1 text-[11px] text-slate-500">
                <span className="w-2 h-0.5 rounded-full inline-block" style={{ backgroundColor: TOP_PEER_COLORS[pi] }} /> {p.name}
              </span>
            ))}
          </>
        )}
        <span className="text-[11px] text-slate-600 ml-auto">최근 {data.length}거래일</span>
      </div>
      {topPeers.length > 0 && (
        <p className="text-[10px] text-slate-600 mt-0.5">
          {topPeers.length >= 3
            ? 'TOP3 기준: 같은 구간 누적 등락률 상위 3종목'
            : topPeers.length === 2
              ? '업종 내 비교 가능한 상위 2종목 기준: 같은 구간 누적 등락률'
              : '업종 내 비교 가능한 유일한 종목 기준: 같은 구간 누적 등락률'}
        </p>
      )}
    </div>
  );
}

// narrative는 완성된 문자열 그대로 넘겨도 되고(공유 페이지), 메인 페이지처럼 스트리밍
// 타이핑 커서를 붙인 JSX를 넘겨도 된다 — 이 컴포넌트는 그냥 그대로 렌더링만 한다.
export function SectorComparisonCard({
  data,
  narrative,
  topPeersNarrative,
}: {
  data: SectorComparison;
  narrative?: React.ReactNode;          // 오늘(또는 전일) vs 업종 평균 — 기존 서술
  topPeersNarrative?: React.ReactNode;  // 2026-09-02: 최근 구간 누적 기준 TOP3 대비 위치 — narrative와 역할 분리
}) {
  const prevClose = data.basis === 'prevClose';
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
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
              {data.peerNames!.join('·')} {data.peerNames!.length}개 종목 평균
            </>
          )}
        </p>
      )}
      {/* 2026-09-02: 넓은 업종에서 시가총액 유사도 필터(lib/sector-peers.ts)를 거치면 삼성전자처럼
          peer가 1~2개로 줄어들 수 있다 — 그 자체는 정상 동작이지만 설명 없이 "6개 종목 평균"에
          익숙한 화면에서 갑자기 1개만 보이면 뭔가 잘못됐다고 오인하기 쉬워, 왜 이렇게 됐는지
          납득할 수 있는 문구를 붙인다. */}
      {(data.peerNames?.length ?? 0) > 0 && data.peerNames!.length <= SPARSE_PEER_THRESHOLD && (
        <p className="text-[11px] text-amber-300/70 mb-2 leading-relaxed">
          이 종목과 비교할 만한 규모의 동종업계 상장사가 {data.peerNames!.join('·')} 외에는 확인되지 않아, 비교 대상이 제한적입니다.
        </p>
      )}
      {data.sparkline && <SectorSparkline sparkline={data.sparkline} />}
      <div className="flex flex-col gap-1.5">
        {narrative}
        {topPeersNarrative}
      </div>
    </div>
  );
}
