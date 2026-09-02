import { describe, it, expect } from 'vitest';
import { computeSectorRelativeChange, computeSectorRelativeChangeFromCloses, shouldUsePrevCloseSectorBasis, type SectorPeer } from './sector-peers';
import type { MarketDayContext } from './market-day-context';

const peer = (name: string, changeRate = 0): SectorPeer => ({ ticker: name, name, price: 1000, changeRate });
const chart = (rows: [string, number][]) => rows.map(([date, close]) => ({ date, close }));
const kst = (iso: string) => new Date(`${iso}+09:00`);

describe('shouldUsePrevCloseSectorBasis — 평일 개장 전 + 오늘 행 없음일 때만', () => {
  const preOpenCtx: MarketDayContext = { isTradingDay: true, lastTradingDate: '2026-09-01', daysSinceLastTradingDate: 1, reason: null };
  it('평일 08:38, 차트 마지막 행이 어제 → 전일 기준', () => {
    expect(shouldUsePrevCloseSectorBasis(preOpenCtx, kst('2026-09-02T08:38:00'))).toBe(true);
  });
  it('같은 컨텍스트라도 09:00 이후면 당일 기준(오늘 행이 곧 생김)', () => {
    expect(shouldUsePrevCloseSectorBasis(preOpenCtx, kst('2026-09-02T09:00:00'))).toBe(false);
    expect(shouldUsePrevCloseSectorBasis(preOpenCtx, kst('2026-09-02T13:40:00'))).toBe(false);
  });
  it('장중 생성(오늘 행 있음)은 당일 기준', () => {
    const ctx: MarketDayContext = { isTradingDay: true, lastTradingDate: '2026-09-02', daysSinceLastTradingDate: 0, reason: null };
    expect(shouldUsePrevCloseSectorBasis(ctx, kst('2026-09-02T10:00:00'))).toBe(false);
  });
  it('주말 새벽은 휴장일 판정이라 제외(네이버가 금요일 등락률을 보여주므로 기존 계산 유지)', () => {
    const ctx: MarketDayContext = { isTradingDay: false, lastTradingDate: '2026-08-28', daysSinceLastTradingDate: 2, reason: 'weekend' };
    expect(shouldUsePrevCloseSectorBasis(ctx, kst('2026-08-30T08:00:00'))).toBe(false);
  });
});

describe('computeSectorRelativeChangeFromCloses — 마지막 두 종가로 전일 등락률', () => {
  const stock = chart([['2026-08-31', 100], ['2026-09-01', 103]]); // +3.00%
  it('peer 평균·차이·기준일·peer 목록을 계산한다', () => {
    const r = computeSectorRelativeChangeFromCloses(stock, [
      { peer: peer('A'), chart: chart([['2026-08-31', 200], ['2026-09-01', 202]]) }, // +1.00%
      { peer: peer('B'), chart: chart([['2026-08-31', 50],  ['2026-09-01', 49]]) },  // -2.00%
    ]);
    expect(r).toEqual({
      peerAvgChangeRate: -0.5, deltaVsPeer: 3.5, stockChangeRate: 3,
      basis: 'prevClose', basisDate: '2026-09-01', peerNames: ['A', 'B'],
    });
  });
  it('마감일이 종목과 다른 peer(거래정지·조회 실패)는 평균에서 제외하고 peerNames에도 빠진다', () => {
    const r = computeSectorRelativeChangeFromCloses(stock, [
      { peer: peer('A'), chart: chart([['2026-08-31', 200], ['2026-09-01', 202]]) },
      { peer: peer('Stale'), chart: chart([['2026-08-28', 10], ['2026-08-29', 11]]) },
      { peer: peer('Empty'), chart: [] },
    ]);
    expect(r?.peerAvgChangeRate).toBe(1);
    expect(r?.peerNames).toEqual(['A']);
  });
  it('유효 peer가 하나도 없거나 종목 차트가 2행 미만이면 null(카드 생략)', () => {
    expect(computeSectorRelativeChangeFromCloses(stock, [{ peer: peer('Empty'), chart: [] }])).toBeNull();
    expect(computeSectorRelativeChangeFromCloses(chart([['2026-09-01', 103]]), [{ peer: peer('A'), chart: chart([['2026-08-31', 1], ['2026-09-01', 1]]) }])).toBeNull();
  });
  it('기존 당일 기준 계산은 그대로(회귀)', () => {
    expect(computeSectorRelativeChange(2.23, [peer('A', 1), peer('B', 0.62)])).toEqual({ peerAvgChangeRate: 0.81, deltaVsPeer: 1.42 });
  });
});
