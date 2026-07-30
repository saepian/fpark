'use client';

import { useEffect, useState } from 'react';
import type { ChartDataPoint } from '../../lib/types';
import { computePriceChangeBadges } from '../../lib/market-utils';

interface PriceChangeBadgesProps {
  ticker: string;
  currentPrice: number;
}

// null = 로딩 중, 'error' = 조회 실패(조용히 숨김)
type ChartState = ChartDataPoint[] | 'error' | null;

export default function PriceChangeBadges({ ticker, currentPrice }: PriceChangeBadgesProps) {
  const [chartData, setChartData] = useState<ChartState>(null);

  // 일봉 데이터는 ticker에만 의존 — currentPrice가 30초마다 폴링 갱신돼도 재조회하지 않고,
  // 아래 badges는 매 렌더 currentPrice로 재계산해 항상 최신 등락률을 반영한다.
  //
  // /chart?period=1Y는 KIS가 요청 범위와 무관하게 최근 100건(≈5개월)으로 응답을 잘라서
  // "1년 전"에 닿지 못한다(lib/kis-api.ts fetchChartRangeRaw 주석 참고) — 1개월 전/1주일
  // 전은 이걸로 충분하지만 1년 전은 /chart-near-1y(1년 전 근방만 좁게 조회하는 전용
  // 라우트)를 별도로 합쳐야 한다. 두 응답 모두 오래된순이고 근방 창이 1Y 응답의 가장
  // 이른 날짜보다 항상 앞서므로 단순 concat으로 시간순이 유지된다.
  useEffect(() => {
    let cancelled = false;
    setChartData(null);

    (async () => {
      try {
        const [mainRes, nearRes] = await Promise.all([
          fetch(`/api/stock/${ticker}/chart?period=1Y`),
          fetch(`/api/stock/${ticker}/chart-near-1y`).catch(() => null),
        ]);
        const mainBody = await mainRes.json().catch(() => null) as ChartDataPoint[] | { error?: string } | null;
        if (!mainRes.ok || !Array.isArray(mainBody)) {
          throw new Error(
            mainBody && !Array.isArray(mainBody) && typeof mainBody.error === 'string'
              ? mainBody.error
              : `1Y 차트 조회 실패 (${mainRes.status})`
          );
        }

        // 1년 전 근방 조회는 부가 데이터라 실패해도 1개월/1주일 배지는 그대로 보여준다
        let nearBody: ChartDataPoint[] = [];
        if (nearRes?.ok) {
          const parsed = await nearRes.json().catch(() => null);
          if (Array.isArray(parsed)) nearBody = parsed;
        }

        if (!cancelled) setChartData([...nearBody, ...mainBody]);
      } catch (e) {
        console.error(`[PriceChangeBadges] ${ticker} 조회 실패:`, e);
        if (!cancelled) setChartData('error');
      }
    })();

    return () => { cancelled = true; };
  }, [ticker]);

  if (chartData === null) {
    return (
      <div className="flex gap-2 mb-6 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-7 w-24 rounded-lg bg-gray-200 dark:bg-[#2d313e]" />
        ))}
      </div>
    );
  }

  if (chartData === 'error') return null;

  const badges = computePriceChangeBadges(chartData, currentPrice);
  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {badges.map((b) => {
        const r = b.changeRate;
        const style =
          r > 0
            ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
            : r < 0
            ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400'
            : 'bg-gray-500/10 border-gray-500/20 text-gray-400';
        return (
          <div
            key={b.label}
            title={`${b.pastDate} 종가 ${b.pastClose.toLocaleString()}원 대비`}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs font-bold ${style}`}
          >
            <span className="text-[10px] font-normal opacity-80">{b.label}</span>
            <span>
              {r > 0 ? '+' : ''}
              {r.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
