// lib/market-status.ts의 서버 래퍼 — 앵커 종목(삼성전자) 1주 차트로 공휴일까지 판정한다.
// /api/market(30초 폴링)·/api/market/movers(3분 폴링)가 모든 방문자에게 호출되므로 차트 조회 결과
// (마지막 행 날짜)를 market_cache에 5분 캐시해 KIS 호출을 5분당 1건으로 묶는다. 상태 자체는 시각에
// 따라 바뀌므로 캐시하지 않고 매 요청 계산한다.

import { fetchDailyChart, cacheJsonResult } from '@/lib/kis-api';
import { getDomesticMarketDayContext } from '@/lib/market-day-context';
import { resolveMarketStatus, type MarketDataStatus } from '@/lib/market-status';

const ANCHOR_TICKER = '005930';
const CACHE_KEY = 'market_day_anchor_chart';
const CACHE_TTL_MS = 5 * 60_000;

export async function getMarketDataStatus(now: Date = new Date()): Promise<MarketDataStatus> {
  const { data } = await cacheJsonResult<{ dates: string[] }>(CACHE_KEY, CACHE_TTL_MS, async () => {
    const chart = await fetchDailyChart(ANCHOR_TICKER, '1W', { priority: 'batch' });
    return { dates: chart.map((p) => p.date) };
  });
  const ctx = getDomesticMarketDayContext(data.dates.map((date) => ({ date })), now);
  return resolveMarketStatus(ctx, now);
}
