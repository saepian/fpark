'use client';

import { useEffect, useState } from 'react';
import type { ChartDataPoint, PriceChangeBadge, StockPrice } from '../../lib/types';
import { computePriceChangeBadges } from '../../lib/market-utils';
import { SECTION_TITLE_CLASS } from '../../lib/ui-constants';

type Market = 'KOSPI' | 'KOSDAQ';
type BenchmarkRates = Partial<Record<PriceChangeBadge['label'], number>>;

interface TableData {
  rows: PriceChangeBadge[];
  market: Market;
  benchmark: BenchmarkRates;
}

type TableState = TableData | 'error' | null;

// DailyPriceTable(일별 주가 동향)과 같은 카드 형태이되, 바로 위에 붙어 있어 배경색이
// 같으면 두 카드가 구분이 안 된다는 피드백(2026-07-30)으로 배경만 StockChart/
// StockMetrics와 같은 계열(#122131 + #2d313e 테두리)로 분리했다 — 상승/하락 폰트
// 색(red-400/blue-400)은 그대로 유지.
// 현재가·시장(KOSPI/KOSDAQ)은 /api/stock/[ticker]/price(StockHeader가 이미 폴링 중인
// 것과 같은, TTL 캐시가 있는 엔드포인트)를 1회만 조회해서 쓴다 — DailyPriceTable도
// ticker만 받아 스스로 데이터를 가져오는 동일한 패턴.
export default function PriceChangeTable({ ticker }: { ticker: string }) {
  const [state, setState] = useState<TableState>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);

    (async () => {
      try {
        // market을 알아야 지수 대비 라우트를 호출할 수 있어 price만 먼저 기다린다.
        const priceRes = await fetch(`/api/stock/${ticker}/price`);
        const priceBody = await priceRes.json().catch(() => null) as StockPrice | { error?: string } | null;
        if (!priceRes.ok || !priceBody || typeof (priceBody as StockPrice).price !== 'number') {
          throw new Error('현재가 조회 실패');
        }
        const currentPrice = (priceBody as StockPrice).price;
        const market: Market = (priceBody as StockPrice).market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';

        const [mainRes, near12Res, benchmarkRes] = await Promise.all([
          fetch(`/api/stock/${ticker}/chart?period=1Y`),
          fetch(`/api/stock/${ticker}/chart-near?monthsAgo=12`).catch(() => null),
          fetch(`/api/market/benchmark-change?market=${market}`).catch(() => null),
        ]);

        const mainBody = await mainRes.json().catch(() => null) as ChartDataPoint[] | { error?: string } | null;
        if (!mainRes.ok || !Array.isArray(mainBody)) {
          throw new Error(
            mainBody && !Array.isArray(mainBody) && typeof mainBody.error === 'string'
              ? mainBody.error
              : `1Y 차트 조회 실패 (${mainRes.status})`
          );
        }

        // 1년 전 근방 조회(near12)는 부가 데이터라 실패해도 1개월/1주일 행은 그대로
        // 보여준다. /chart?period=1Y(main)는 KIS가 요청 범위와 무관하게 최근 100건
        // (≈5개월)으로 응답을 잘라서 "1년 전"·"6개월 전"에 닿지 못하므로, near12를
        // /api/stock/[ticker]/chart-near에서 fetchChartBackTo로 오늘부터 12개월 전까지
        // 빈틈없이 연쇄 조회해온다(2026-08-03 — 예전엔 near12/near6가 각각 목표일 근방
        // 14일짜리 스냅샷이라 서로 이어지지 않는 공백이 있었고, 그 공백에 실제 52주
        // 고점이 있으면 조용히 누락됐다. S-Oil 2026-03-04 고가 177,100원 누락 사례로
        // 실측 확인 — near12 하나가 6개월 전 시점도 포함하는 연속 데이터가 되므로
        // near6는 더 이상 따로 부르지 않는다).
        // near12는 오늘 날짜까지 이어붙이므로 main과 최근 구간이 겹친다 — main(5분/1시간
        // 캐시, 더 신선함)을 우선해 날짜 기준으로 병합 후 오름차순 정렬한다(단순 concat은
        // 겹치는 구간 때문에 정렬이 깨져 findClosestPastClose의 "오름차순 가정"을 위반함).
        const parseNear = async (res: Response | null) => {
          if (!res?.ok) return [] as ChartDataPoint[];
          const parsed = await res.json().catch(() => null);
          return Array.isArray(parsed) ? (parsed as ChartDataPoint[]) : [];
        };
        const near12Body = await parseNear(near12Res);
        const byDate = new Map<string, ChartDataPoint>();
        for (const p of near12Body) byDate.set(p.date, p);
        for (const p of mainBody) byDate.set(p.date, p);
        const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

        // 지수 대비 등락률도 부가 데이터 — 실패해도 나머지 컬럼은 그대로 보여준다.
        let benchmark: BenchmarkRates = {};
        if (benchmarkRes?.ok) {
          const parsed = await benchmarkRes.json().catch(() => null);
          if (parsed && typeof parsed === 'object') benchmark = parsed;
        }

        const rows = computePriceChangeBadges(points, currentPrice);
        if (!cancelled) setState({ rows, market, benchmark });
      } catch (e) {
        console.error(`[PriceChangeTable] ${ticker} 조회 실패:`, e);
        if (!cancelled) setState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [ticker]);

  if (state === null) {
    return (
      <div className="rounded-xl bg-[#122131] border border-[#2d313e] p-4 animate-pulse">
        <div className="h-4 bg-[#2d313e] rounded w-32 mb-4" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 bg-[#2d313e] rounded mb-2" />
        ))}
      </div>
    );
  }

  if (state === 'error' || state.rows.length === 0) return null;

  const { rows, market, benchmark } = state;
  const indexLabel = market === 'KOSDAQ' ? '코스닥' : '코스피';

  return (
    <div className="rounded-xl bg-[#122131] border border-[#2d313e] p-4">
      <h3 className={`${SECTION_TITLE_CLASS} text-[#d4e4fa] mb-3`}>
        기간별 등락률
        <span className="text-[10px] text-[#8c909f] font-normal ml-2">1년 전 · 6개월 전 · 1개월 전 · 1주일 전 대비</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-[660px] w-full text-xs">
          <thead>
            <tr className="text-[#8c909f] border-b border-[#2d313e]">
              <th className="text-left pb-2.5 font-medium">기간</th>
              <th className="text-right pb-2.5 font-medium">해당 시점 가격</th>
              <th className="text-right pb-2.5 font-medium">변동률</th>
              <th className="text-right pb-2.5 font-medium">{indexLabel} 대비</th>
              <th className="text-right pb-2.5 font-medium">기간 중 최고가</th>
              <th className="text-right pb-2.5 font-medium">기간 중 최저가</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isUp = row.changeRate >= 0;
              const color = isUp ? 'text-red-400' : 'text-blue-400';

              const indexRate = benchmark[row.label];
              const vsIndex = indexRate === undefined ? null : row.changeRate - indexRate;
              const vsColor = vsIndex === null ? 'text-[#8c909f]' : vsIndex >= 0 ? 'text-red-400' : 'text-blue-400';

              return (
                <tr
                  key={row.label}
                  title={row.pastDate}
                  className="border-b border-[#2d313e]/60 hover:bg-[#2d313e]/30 transition-colors"
                >
                  <td className="py-2.5 text-[#8c909f] whitespace-nowrap">{row.label}</td>
                  <td className="py-2.5 text-right font-mono text-[#d4e4fa] whitespace-nowrap">
                    {row.pastClose.toLocaleString()}원
                  </td>
                  <td className={`py-2.5 text-right font-mono font-semibold ${color} whitespace-nowrap`}>
                    {isUp ? '+' : ''}
                    {row.changeRate.toFixed(2)}%
                  </td>
                  <td className={`py-2.5 text-right font-mono whitespace-nowrap ${vsColor}`}>
                    {vsIndex === null
                      ? '-'
                      : `${vsIndex > 0 ? '+' : ''}${vsIndex.toFixed(1)}%p`}
                  </td>
                  <td className="py-2.5 text-right font-mono text-red-400/70 whitespace-nowrap">
                    {row.periodHigh.toLocaleString()}원
                  </td>
                  <td className="py-2.5 text-right font-mono text-blue-400/70 whitespace-nowrap">
                    {row.periodLow.toLocaleString()}원
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
