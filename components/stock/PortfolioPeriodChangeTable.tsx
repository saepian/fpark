'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChartDataPoint, PortfolioPeriodChange, PriceChangeBadge, StockPrice } from '../../lib/types';
import { computePortfolioPeriodChange } from '../../lib/market-utils';

interface HoldingInput {
  ticker: string;
  name: string;
  quantity: number;
}

type Market = 'KOSPI' | 'KOSDAQ';
type BenchmarkRates = Partial<Record<PriceChangeBadge['label'], number>>;

interface TableData {
  rows: PortfolioPeriodChange[];
  nameByTicker: Map<string, string>;
  market: Market;
  benchmark: BenchmarkRates;
}

type TableState = TableData | 'error' | null;

const BATCH_SIZE = 3;      // lib/kis-api.ts:1084 "3개씩 배치 처리 (rate limit 회피)"와 동일
const BATCH_DELAY_MS = 300;

interface TickerData {
  points: ChartDataPoint[] | null;
  market: Market | null;
  currentPrice: number | null;
}

// 종목당 3개 병렬 호출(1Y 메인·1년전 근접 연쇄백필·현재가). market/currentPrice는
// 지수 대비 컬럼의 "우세 시장" 판정에만 쓰고, 포트폴리오 평가금액 계산 자체는 여전히
// 상위(page.tsx)가 넘겨주는 currentTotalValue를 그대로 쓴다(중복 산정 아님).
async function fetchTickerData(ticker: string): Promise<TickerData> {
  let points: ChartDataPoint[] | null = null;
  let market: Market | null = null;
  let currentPrice: number | null = null;

  try {
    const [mainRes, near12Res, priceRes] = await Promise.all([
      fetch(`/api/stock/${ticker}/chart?period=1Y`),
      fetch(`/api/stock/${ticker}/chart-near?monthsAgo=12`).catch(() => null),
      fetch(`/api/stock/${ticker}/price`).catch(() => null),
    ]);

    const mainBody = await mainRes.json().catch(() => null);
    if (mainRes.ok && Array.isArray(mainBody)) {
      // 2026-08-03: /api/stock/[ticker]/chart-near가 fetchChartBackTo로 교체되면서
      // near12(1년 전~오늘까지 연쇄 백필)가 이제 main(최근 ~5개월)과 크게 겹치는 연속
      // 데이터를 반환한다 — 예전엔 서로 안 겹치는 좁은 스냅샷이라 단순 concat이 우연히
      // 오름차순을 유지했지만, 지금은 그대로 이어붙이면 순서가 깨져(near12가 오늘까지
      // 갔다가 main이 다시 5개월 전으로 되돌아감) findClosestPastClose의 "오름차순 가정"이
      // 깨지는 회귀가 실제로 발생했다(PriceChangeTable.tsx와 동일 문제, 같은 방식으로
      // 수정). near12 하나가 6개월 전 시점도 포함하므로 near6는 더 이상 호출하지 않는다.
      const parseNear = async (res: Response | null) => {
        if (!res?.ok) return [] as ChartDataPoint[];
        const parsed = await res.json().catch(() => null);
        return Array.isArray(parsed) ? (parsed as ChartDataPoint[]) : [];
      };
      const near12Body = await parseNear(near12Res);
      const byDate = new Map<string, ChartDataPoint>();
      for (const p of near12Body) byDate.set(p.date, p);
      for (const p of mainBody as ChartDataPoint[]) byDate.set(p.date, p);
      points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    }

    if (priceRes?.ok) {
      const priceBody = await priceRes.json().catch(() => null) as StockPrice | null;
      if (priceBody && typeof priceBody.price === 'number') {
        currentPrice = priceBody.price;
        market = priceBody.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';
      }
    }
  } catch (e) {
    console.error(`[PortfolioPeriodChangeTable] ${ticker} 조회 실패:`, e);
  }

  return { points, market, currentPrice };
}

// 최대 10종목(MAX_HOLDINGS) 전부를 한 번에 병렬 호출하면 KIS 동시성 장애 이력이 있어
// (app/api/portfolio-diagnosis/route.ts Stage 0 주석 — 4종목 동시 요청에서도 랜덤 누락
// 실측됨) 3종목씩 배치 + 배치 간 300ms 대기로 스태거링한다. 종목 하나 실패해도
// null로 기록하고 계속 진행 — 부분 실패로 전체를 막지 않는다.
async function fetchAllTickerData(
  holdings: HoldingInput[],
): Promise<Map<string, TickerData>> {
  const result = new Map<string, TickerData>();
  for (let i = 0; i < holdings.length; i += BATCH_SIZE) {
    const batch = holdings.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((h) => fetchTickerData(h.ticker)));
    batch.forEach((h, idx) => {
      const r = batchResults[idx];
      result.set(h.ticker, r.status === 'fulfilled' ? r.value : { points: null, market: null, currentPrice: null });
    });
    if (i + BATCH_SIZE < holdings.length) {
      await new Promise((res) => setTimeout(res, BATCH_DELAY_MS));
    }
  }
  return result;
}

interface PortfolioPeriodChangeTableProps {
  holdings: HoldingInput[];
  currentTotalValue: number;
}

export default function PortfolioPeriodChangeTable({ holdings, currentTotalValue }: PortfolioPeriodChangeTableProps) {
  const [state, setState] = useState<TableState>(null);

  // ticker/quantity 자체가 안 바뀌면 재조회하지 않는다 — result.holdings는 AI 텍스트
  // 필드(reason/sector 등)가 스트리밍될 때마다 새 배열 참조로 바뀌지만, 그 갱신마다
  // 차트를 다시 조회할 필요는 없다.
  const holdingsKey = useMemo(
    () => holdings.map((h) => `${h.ticker}:${h.quantity}`).sort().join(','),
    [holdings]
  );

  useEffect(() => {
    if (holdings.length === 0) {
      setState(null);
      return;
    }
    let cancelled = false;
    setState(null);

    (async () => {
      try {
        const dataByTicker = await fetchAllTickerData(holdings);
        if (cancelled) return;

        // 지수 대비 컬럼의 기준 시장 — 종목 수가 아니라 현재 평가금액이 더 큰 쪽 시장을
        // 채택한다(코스닥 종목이 개수는 많아도 비중은 작은 경우가 흔해 금액 기준이 더
        // 대표성 있음). market/currentPrice 조회에 실패한 종목은 가중치 0으로 제외.
        let kospiValue = 0;
        let kosdaqValue = 0;
        for (const h of holdings) {
          const d = dataByTicker.get(h.ticker);
          if (!d?.market || d.currentPrice == null) continue;
          const weight = d.currentPrice * h.quantity;
          if (d.market === 'KOSDAQ') kosdaqValue += weight;
          else kospiValue += weight;
        }
        const market: Market = kosdaqValue > kospiValue ? 'KOSDAQ' : 'KOSPI';

        // 지수 등락률도 부가 데이터 — 실패해도 나머지 컬럼은 그대로 보여준다.
        // 시장 단위로 캐싱된 라우트라(app/api/market/benchmark-change) 종목 수와
        // 무관하게 호출 1회.
        let benchmark: BenchmarkRates = {};
        const benchmarkRes = await fetch(`/api/market/benchmark-change?market=${market}`).catch(() => null);
        if (benchmarkRes?.ok) {
          const parsed = await benchmarkRes.json().catch(() => null);
          if (parsed && typeof parsed === 'object') benchmark = parsed;
        }

        const withPoints = holdings.map((h) => ({
          ticker: h.ticker,
          quantity: h.quantity,
          points: dataByTicker.get(h.ticker)?.points ?? null,
        }));
        const rows = computePortfolioPeriodChange(withPoints, currentTotalValue);
        const nameByTicker = new Map(holdings.map((h) => [h.ticker, h.name]));
        if (!cancelled) setState({ rows, nameByTicker, market, benchmark });
      } catch (e) {
        console.error('[PortfolioPeriodChangeTable] 집계 실패:', e);
        if (!cancelled) setState('error');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsKey, currentTotalValue]);

  if (state === null) {
    if (holdings.length === 0) return null;
    return (
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 animate-pulse mb-4">
        <div className="h-4 bg-slate-700 rounded w-40 mb-4" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 bg-slate-700 rounded mb-2" />
        ))}
      </div>
    );
  }

  if (state === 'error' || state.rows.length === 0) return null;

  const { rows, nameByTicker, market, benchmark } = state;
  const indexLabel = market === 'KOSDAQ' ? '코스닥' : '코스피';
  const missingNotes = rows
    .filter((r) => r.missingTickers.length > 0)
    .map((r) => {
      const names = r.missingTickers.map((t) => nameByTicker.get(t) ?? t);
      const label = names.length <= 2 ? names.join(', ') : `${names[0]} 외 ${names.length - 1}종목`;
      return `${r.label} ${label}`;
    });

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 mb-4">
      <h3 className="text-[15px] font-bold text-slate-300 mb-1">
        기간별 포트폴리오 평가금액 변동
        <span className="text-[11px] text-slate-500 font-normal ml-2">1년 전 · 6개월 전 · 1개월 전 · 1주일 전 대비</span>
      </h3>
      <p className="text-[11px] text-amber-500/80 mb-3 leading-relaxed">
        ※ 현재 보유 종목 구성을 과거에도 그대로 유지했다고 가정한 값입니다.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-[660px] w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left pb-2.5 font-medium">기간</th>
              <th className="text-right pb-2.5 font-medium">해당 시점 평가금액</th>
              <th className="text-right pb-2.5 font-medium">변동률</th>
              <th className="text-right pb-2.5 font-medium">{indexLabel} 대비</th>
              <th className="text-right pb-2.5 font-medium">기간중 최고평가금액</th>
              <th className="text-right pb-2.5 font-medium">기간중 최저평가금액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isUp = row.changeRate >= 0;
              const color = isUp ? 'text-red-400' : 'text-blue-400';

              const indexRate = benchmark[row.label];
              const vsIndex = indexRate === undefined ? null : row.changeRate - indexRate;
              const vsColor = vsIndex === null ? 'text-slate-600' : vsIndex >= 0 ? 'text-red-400' : 'text-blue-400';

              return (
                <tr key={row.label} className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                  <td className="py-2.5 text-slate-400 whitespace-nowrap">{row.label}</td>
                  <td className="py-2.5 text-right font-mono text-slate-300 whitespace-nowrap">
                    {Math.round(row.pastValue).toLocaleString()}원
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
                    {Math.round(row.periodHigh).toLocaleString()}원
                  </td>
                  <td className="py-2.5 text-right font-mono text-blue-400/70 whitespace-nowrap">
                    {Math.round(row.periodLow).toLocaleString()}원
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missingNotes.length > 0 && (
        <p className="text-[11px] text-amber-500/80 mt-2.5 leading-relaxed">
          ⚠ 일부 종목 데이터 누락(제외하고 계산): {missingNotes.join(' · ')}
        </p>
      )}
    </div>
  );
}
