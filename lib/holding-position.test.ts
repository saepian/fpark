import { describe, it, expect } from 'vitest';
import { computeHoldingPosition, buildHoldingPositionBlock, describeHoldingWindow } from './holding-position';

// 2026-09-01 기업분석 "내 포지션" 카드 순수 계산 검증.
const chart = [
  { date: '2026-06-01', close: 10000 },
  { date: '2026-06-02', close: 11000 },
  { date: '2026-06-03', close: 12000 }, // 매수일
  { date: '2026-06-04', close: 14000 }, // +16.67% (big move)
  { date: '2026-06-05', close: 13000 },
  { date: '2026-06-08', close: 10500 }, // -19.23% (big move)
  { date: '2026-06-09', close: 11000 }, // 현재
];

describe('computeHoldingPosition', () => {
  it('매수일 이후 구간으로 고점·저점·최대/최저 평가손익·변동일을 계산한다', () => {
    const hp = computeHoldingPosition({ avgPrice: 12345, quantity: 10, currentPrice: 11000, buyDate: '2026-06-03', chart, eps: 500, benchmark: null })!;
    expect(hp.window).toEqual({ from: '2026-06-03', to: '2026-06-09', tradingDays: 5, basis: 'buyDate' });
    expect(hp.profitRate).toBeCloseTo(-10.9, 1);
    expect(hp.recoveryRate).toBeCloseTo(12.23, 2);          // 12345/11000 - 1
    expect(hp.high).toEqual({ date: '2026-06-04', close: 14000, vsCurrent: -21.43 });
    expect(hp.low).toEqual({ date: '2026-06-08', close: 10500, vsCurrent: 4.76 });
    expect(hp.maxPnl).toEqual({ date: '2026-06-04', rate: 13.41, amount: 16550 });
    expect(hp.minPnl).toEqual({ date: '2026-06-08', rate: -14.95, amount: -18450 });
    // 6/4 +16.67%, 6/8 -19.23% (6/3 당일 +9.09%는 미만, 6/1·6/2는 매수 전)
    expect(hp.bigMoves.count).toBe(2);
    expect(hp.bigMoves.days.map((d) => d.date)).toEqual(['2026-06-04', '2026-06-08']);
    expect(hp.per).toEqual({ atBuy: 24.7, now: 22, eps: 500 });
  });

  it('수익 구간이면 recoveryRate가 음수(여유)로 나온다', () => {
    const hp = computeHoldingPosition({ avgPrice: 10000, quantity: 1, currentPrice: 11000, buyDate: '2026-06-03', chart, eps: null, benchmark: null })!;
    expect(hp.recoveryRate).toBeCloseTo(-9.09, 2);
    expect(hp.per).toBeNull();
    expect(buildHoldingPositionBlock(hp)).toContain('여유');
    expect(buildHoldingPositionBlock(hp)).toContain('EPS 없음');
  });

  it('매수일이 없으면 최근 6개월 전체를 폴백으로 쓰고 캡션에 명시한다', () => {
    const hp = computeHoldingPosition({ avgPrice: 12000, quantity: 1, currentPrice: 11000, buyDate: null, chart, eps: null, benchmark: null })!;
    expect(hp.window.basis).toBe('fallback6M');
    expect(hp.priceBasis).toBe('close'); // high/low 없는 입력은 종가 기준 폴백
    expect(hp.window.from).toBe('2026-06-01');
    expect(hp.low).toEqual({ date: '2026-06-01', close: 10000, vsCurrent: 10 });
    expect(describeHoldingWindow(hp)).toContain('매수일 미입력');
    expect(hp.bigMoves.count).toBe(2); // 6/2 +10%는 미만
  });

  it('매수일이 차트 범위보다 오래되면 6개월 절삭을 basis로 표시한다', () => {
    const hp = computeHoldingPosition({ avgPrice: 12000, quantity: 1, currentPrice: 11000, buyDate: '2025-01-01', chart, eps: null, benchmark: null })!;
    expect(hp.window.basis).toBe('buyDateCapped6M');
    expect(describeHoldingWindow(hp)).toContain('최근 6개월만 반영');
  });

  it('장중 고가/저가가 있으면 그 기준으로 고점·저점·최대/최저 평가손익을 계산한다(기간별 등락률 표와 동일 기준, 2026-09-02)', () => {
    // 종가 기준이면 고점 6/4 14000·저점 6/8 10500이지만, 장중 고가는 6/5에 15000, 장중 저가는 6/9에 9800
    const intradayChart = chart.map((p) => ({ ...p, high: p.close + 500, low: p.close - 500 }));
    intradayChart[4] = { ...intradayChart[4], high: 15000 }; // 6/5 장중 고가
    intradayChart[6] = { ...intradayChart[6], low: 9800 };   // 6/9 장중 저가
    const hp = computeHoldingPosition({ avgPrice: 12345, quantity: 10, currentPrice: 11000, buyDate: '2026-06-03', chart: intradayChart, eps: null, benchmark: null })!;
    expect(hp.priceBasis).toBe('intraday');
    expect(hp.high).toEqual({ date: '2026-06-05', close: 15000, vsCurrent: -26.67 });
    expect(hp.low).toEqual({ date: '2026-06-09', close: 9800, vsCurrent: 12.24 });
    expect(hp.maxPnl).toEqual({ date: '2026-06-05', rate: 21.51, amount: 26550 });
    expect(hp.minPnl).toEqual({ date: '2026-06-09', rate: -20.62, amount: -25450 });
    expect(hp.bigMoves.count).toBe(2); // ±15% 변동일은 종가 대비 종가 그대로
    expect(buildHoldingPositionBlock(hp)).toContain('장중 고가 15,000원');
  });

  it('구간 일부 행에 장중 고가/저가가 없으면 전체를 종가 기준으로 통일 폴백한다', () => {
    const mixed = chart.map((p, i) => (i === 5 ? p : { ...p, high: p.close + 500, low: p.close - 500 }));
    const hp = computeHoldingPosition({ avgPrice: 12345, quantity: 10, currentPrice: 11000, buyDate: '2026-06-03', chart: mixed, eps: null, benchmark: null })!;
    expect(hp.priceBasis).toBe('close');
    expect(hp.high?.close).toBe(14000);
  });

  it('매수일이 차트 마지막 행보다 뒤면 마지막 행만 구간으로 삼는다', () => {
    const hp = computeHoldingPosition({ avgPrice: 12000, quantity: 1, currentPrice: 11000, buyDate: '2026-06-10', chart, eps: null, benchmark: null })!;
    expect(hp.window.tradingDays).toBe(1);
    expect(hp.high?.date).toBe('2026-06-09');
    expect(hp.bigMoves.count).toBe(0);
  });

  it('벤치마크는 초과수익(%p)을 붙여 그대로 통과시키고, 블록에 컴플라이언스 금지어가 없다', () => {
    const hp = computeHoldingPosition({
      avgPrice: 12345, quantity: 10, currentPrice: 11000, buyDate: '2026-06-03', chart, eps: 500,
      benchmark: { indexName: 'KOSPI', indexChangeRate: -20.88, stockProfitRate: -10.9, fromDate: '2026-06-03', toDate: '2026-06-09' },
    })!;
    expect(hp.benchmark?.excess).toBeCloseTo(9.98, 2);
    const block = buildHoldingPositionBlock(hp);
    expect(block).toContain('KOSPI -20.88% vs 이 종목 -10.9%');
    expect(block).toContain('EPS');
    for (const banned of ['매수 추천', '매도', '목표가', '손절', '회복 가능', '반등']) expect(block).not.toContain(banned);
  });

  it('매입가가 0 이하면 null', () => {
    expect(computeHoldingPosition({ avgPrice: 0, quantity: 1, currentPrice: 100, buyDate: null, chart, eps: null, benchmark: null })).toBeNull();
    expect(buildHoldingPositionBlock(null)).toContain('계산 없음');
  });
});
