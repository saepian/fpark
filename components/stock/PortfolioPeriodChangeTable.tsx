'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChartDataPoint, PortfolioPeriodChange } from '../../lib/types';
import { computePortfolioPeriodChange } from '../../lib/market-utils';

interface HoldingInput {
  ticker: string;
  name: string;
  quantity: number;
}

interface TableData {
  rows: PortfolioPeriodChange[];
  nameByTicker: Map<string, string>;
}

type TableState = TableData | 'error' | null;

const BATCH_SIZE = 3;      // lib/kis-api.ts:1084 "3개씩 배치 처리 (rate limit 회피)"와 동일
const BATCH_DELAY_MS = 300;

async function fetchTickerPoints(ticker: string): Promise<ChartDataPoint[] | null> {
  try {
    const [mainRes, near12Res, near6Res] = await Promise.all([
      fetch(`/api/stock/${ticker}/chart?period=1Y`),
      fetch(`/api/stock/${ticker}/chart-near?monthsAgo=12`).catch(() => null),
      fetch(`/api/stock/${ticker}/chart-near?monthsAgo=6`).catch(() => null),
    ]);

    const mainBody = await mainRes.json().catch(() => null);
    if (!mainRes.ok || !Array.isArray(mainBody)) return null;

    const parseNear = async (res: Response | null) => {
      if (!res?.ok) return [] as ChartDataPoint[];
      const parsed = await res.json().catch(() => null);
      return Array.isArray(parsed) ? (parsed as ChartDataPoint[]) : [];
    };
    const [near12Body, near6Body] = await Promise.all([parseNear(near12Res), parseNear(near6Res)]);

    // near12(1년 전 근방) → near6(6개월 전 근방) → main(최근 ~5개월) 순으로 겹치지 않고
    // 시간순 정렬되므로 단순 concat으로 전체 시간순이 유지된다(PriceChangeTable과 동일 성질).
    return [...near12Body, ...near6Body, ...(mainBody as ChartDataPoint[])];
  } catch (e) {
    console.error(`[PortfolioPeriodChangeTable] ${ticker} 조회 실패:`, e);
    return null;
  }
}

// 최대 10종목(MAX_HOLDINGS) 전부를 한 번에 병렬 호출하면 KIS 동시성 장애 이력이 있어
// (app/api/portfolio-diagnosis/route.ts Stage 0 주석 — 4종목 동시 요청에서도 랜덤 누락
// 실측됨) 3종목씩 배치 + 배치 간 300ms 대기로 스태거링한다. 종목 하나 실패해도
// null로 기록하고 계속 진행 — 부분 실패로 전체를 막지 않는다.
async function fetchAllTickerPoints(
  holdings: HoldingInput[],
): Promise<Map<string, ChartDataPoint[] | null>> {
  const result = new Map<string, ChartDataPoint[] | null>();
  for (let i = 0; i < holdings.length; i += BATCH_SIZE) {
    const batch = holdings.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((h) => fetchTickerPoints(h.ticker)));
    batch.forEach((h, idx) => {
      const r = batchResults[idx];
      result.set(h.ticker, r.status === 'fulfilled' ? r.value : null);
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
        const pointsByTicker = await fetchAllTickerPoints(holdings);
        if (cancelled) return;

        const withPoints = holdings.map((h) => ({
          ticker: h.ticker,
          quantity: h.quantity,
          points: pointsByTicker.get(h.ticker) ?? null,
        }));
        const rows = computePortfolioPeriodChange(withPoints, currentTotalValue);
        const nameByTicker = new Map(holdings.map((h) => [h.ticker, h.name]));
        setState({ rows, nameByTicker });
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

  const { rows, nameByTicker } = state;
  const missingNotes = rows
    .filter((r) => r.missingTickers.length > 0)
    .map((r) => {
      const names = r.missingTickers.map((t) => nameByTicker.get(t) ?? t);
      const label = names.length <= 2 ? names.join(', ') : `${names[0]} 외 ${names.length - 1}종목`;
      return `${r.label} ${label}`;
    });

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 mb-4">
      <h3 className="text-sm font-bold text-slate-300 mb-3">
        기간별 포트폴리오 평가금액 변동
        <span className="text-[10px] text-slate-500 font-normal ml-2">1년 전 · 6개월 전 · 1개월 전 · 1주일 전 대비</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-[420px] w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left pb-2.5 font-medium">기간</th>
              <th className="text-right pb-2.5 font-medium">해당 시점 평가금액</th>
              <th className="text-right pb-2.5 font-medium">변동률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isUp = row.changeRate >= 0;
              const color = isUp ? 'text-red-400' : 'text-blue-400';
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missingNotes.length > 0 && (
        <p className="text-[10px] text-amber-500/80 mt-2.5 leading-relaxed">
          ⚠ 일부 종목 데이터 누락(제외하고 계산): {missingNotes.join(' · ')}
        </p>
      )}
    </div>
  );
}
