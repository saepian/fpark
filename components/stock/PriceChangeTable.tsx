'use client';

import { useEffect, useState } from 'react';
import type { ChartDataPoint, PriceChangeBadge, StockPrice } from '../../lib/types';
import { computePriceChangeBadges } from '../../lib/market-utils';

// DailyPriceTable(일별 주가 동향)과 같은 카드 형태 — 그 밑에 나란히 배치된다.
// 현재가는 /api/stock/[ticker]/price(StockHeader가 이미 30초 폴링 중인 것과 같은
// 엔드포인트, 서버에 TTL 캐시가 있어 추가 호출 비용이 사실상 없음)를 1회만 조회해서
// 쓴다 — DailyPriceTable도 ticker만 받아 스스로 데이터를 가져오는 동일한 패턴.
export default function PriceChangeTable({ ticker }: { ticker: string }) {
  const [rows, setRows] = useState<PriceChangeBadge[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);

    (async () => {
      try {
        const [priceRes, mainRes, nearRes] = await Promise.all([
          fetch(`/api/stock/${ticker}/price`),
          fetch(`/api/stock/${ticker}/chart?period=1Y`),
          fetch(`/api/stock/${ticker}/chart-near-1y`).catch(() => null),
        ]);

        const priceBody = await priceRes.json().catch(() => null) as StockPrice | { error?: string } | null;
        if (!priceRes.ok || !priceBody || typeof (priceBody as StockPrice).price !== 'number') {
          throw new Error('현재가 조회 실패');
        }
        const currentPrice = (priceBody as StockPrice).price;

        const mainBody = await mainRes.json().catch(() => null) as ChartDataPoint[] | { error?: string } | null;
        if (!mainRes.ok || !Array.isArray(mainBody)) {
          throw new Error(
            mainBody && !Array.isArray(mainBody) && typeof mainBody.error === 'string'
              ? mainBody.error
              : `1Y 차트 조회 실패 (${mainRes.status})`
          );
        }

        // 1년 전 근방 조회는 부가 데이터라 실패해도 1개월/1주일 행은 그대로 보여준다.
        // /chart?period=1Y는 KIS가 요청 범위와 무관하게 최근 100건(≈5개월)으로 응답을
        // 잘라서 "1년 전"에 닿지 못한다(lib/kis-api.ts fetchChartRangeRaw 주석 참고).
        // 두 응답 모두 오래된순이고 근방 창이 1Y 응답의 가장 이른 날짜보다 항상 앞서므로
        // 단순 concat으로 시간순이 유지된다.
        let nearBody: ChartDataPoint[] = [];
        if (nearRes?.ok) {
          const parsed = await nearRes.json().catch(() => null);
          if (Array.isArray(parsed)) nearBody = parsed;
        }

        if (!cancelled) setRows(computePriceChangeBadges([...nearBody, ...mainBody], currentPrice));
      } catch (e) {
        console.error(`[PriceChangeTable] ${ticker} 조회 실패:`, e);
        if (!cancelled) setRows([]);
      }
    })();

    return () => { cancelled = true; };
  }, [ticker]);

  if (rows === null) {
    return (
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-32 mb-4" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-8 bg-slate-700 rounded mb-2" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4">
      <h3 className="text-sm font-bold text-slate-300 mb-3">
        기간별 등락률
        <span className="text-[10px] text-slate-500 font-normal ml-2">1년 전 · 1개월 전 · 1주일 전 대비</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-[320px] w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left pb-2.5 font-medium">기간</th>
              <th className="text-right pb-2.5 font-medium">해당 시점 가격</th>
              <th className="text-right pb-2.5 font-medium">변동률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isUp = row.changeRate >= 0;
              const color = isUp ? 'text-red-400' : 'text-blue-400';
              const cellBg = isUp ? 'bg-red-500/10' : 'bg-blue-500/10';
              return (
                <tr
                  key={row.label}
                  title={row.pastDate}
                  className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors"
                >
                  <td className="py-2.5 text-slate-400">{row.label}</td>
                  <td className="py-2.5 text-right font-mono text-slate-300">
                    {row.pastClose.toLocaleString()}원
                  </td>
                  <td className={`py-2.5 text-right font-mono font-semibold ${color} ${cellBg}`}>
                    {isUp ? '+' : ''}
                    {row.changeRate.toFixed(2)}%
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
