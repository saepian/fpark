import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MarketDayContext } from './market-day-context';

vi.mock('./kis-api', () => ({ fetchMarketCapsCached: vi.fn() }));

import { computeSectorRelativeChange, computeSectorRelativeChangeFromCloses, shouldUsePrevCloseSectorBasis, fetchMarketCapsWithRetry, type SectorPeer } from './sector-peers';
import { fetchMarketCapsCached } from './kis-api';

const mockedFetchMarketCapsCached = vi.mocked(fetchMarketCapsCached);

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

// 2026-09-03 긴급조사: SK하이닉스 peer에 삼성전자가 빠진 원인 — 시가총액 조회가 유저
// 소프트캡(10/s, lib/kis-api.ts)에 걸려 일부 실패하면, 기존 코드는 실패=밴드밖으로
// 오인해 조용히 제외했다. 실패한 티커만 골라 한 번 더 조회하는 재시도로 고친다.
describe('fetchMarketCapsWithRetry — 소프트캡 등으로 실패한 티커만 재시도', () => {
  beforeEach(() => { mockedFetchMarketCapsCached.mockReset(); });

  it('1차 조회가 모두 성공하면 재시도 없이 그대로 반환', async () => {
    mockedFetchMarketCapsCached.mockResolvedValueOnce(new Map([['005930', 100], ['000660', 50]]));
    const result = await fetchMarketCapsWithRetry(['005930', '000660']);
    expect(result.get('005930')).toBe(100);
    expect(result.get('000660')).toBe(50);
    expect(mockedFetchMarketCapsCached).toHaveBeenCalledTimes(1);
  });

  // 실측 재현: SK하이닉스 리포트 생성 중 삼성전자(005930) 시가총액 조회가 소프트캡에
  // 걸려 실패 — 1차 결과엔 005930이 없고, 재시도(005930만)에서 성공적으로 채워진다.
  it('실패한 티커(캡 조회 안 됨)만 골라 재시도해서 채운다', async () => {
    mockedFetchMarketCapsCached
      .mockResolvedValueOnce(new Map([['000660', 50], ['402340', 10]])) // 1차: 005930 누락
      .mockResolvedValueOnce(new Map([['005930', 400]])); // 재시도: 005930만 조회
    const result = await fetchMarketCapsWithRetry(['000660', '005930', '402340']);
    expect(result.get('005930')).toBe(400);
    expect(result.get('000660')).toBe(50);
    expect(result.get('402340')).toBe(10);
    expect(mockedFetchMarketCapsCached).toHaveBeenCalledTimes(2);
    expect(mockedFetchMarketCapsCached).toHaveBeenLastCalledWith(['005930']);
  });

  it('재시도도 실패하면 해당 티커는 최종적으로 없음(undefined) — 예외를 던지지 않음', async () => {
    mockedFetchMarketCapsCached
      .mockResolvedValueOnce(new Map([['000660', 50]])) // 1차: 005930 누락
      .mockResolvedValueOnce(new Map()); // 재시도도 실패
    const result = await fetchMarketCapsWithRetry(['000660', '005930']);
    expect(result.get('000660')).toBe(50);
    expect(result.has('005930')).toBe(false);
  });
});
