// 국내증시 급등/급락 테이블이 "지난주 금요일이 공휴일"이었던 일요일에 빈 값으로 표시된
// 버그 수정을 검증하는 테스트. 실제 KIS API를 호출하지 않고 시스템 시간과 fetcher를
// mock해서, "요일 계산 하나로 날짜를 확정" → "실제 데이터가 존재하는 날짜를 찾을 때까지
// 후보를 순차 재시도"로 바뀐 동작을 확인한다.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getTradingDateCandidates,
  getLastTradingDate,
  findFirstNonEmptyByDate,
  findClosestPastClose,
  computePriceChangeBadges,
  getPriceChangeTargets,
  computePortfolioPeriodChange,
  isKoreanMarketOpen,
  isKoreanMarketPreOpen,
} from './market-utils';
import type { ChartDataPoint } from './types';

describe('getTradingDateCandidates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('일요일에는 토/일을 건너뛰고 금요일부터 역순으로 평일만 나열한다', () => {
    // 2026-07-19는 일요일(KST), 낮 12시
    vi.setSystemTime(new Date('2026-07-19T12:00:00+09:00'));
    const candidates = getTradingDateCandidates(5).map(c => c.yyyymmdd);
    // 이 함수 자체는 공휴일을 모르므로, 7/17(금)이 실제로는 공휴일이었어도
    // 그대로 첫 후보로 포함된다 — "공휴일 스킵"은 호출부의 존재 여부 검증이 담당.
    expect(candidates).toEqual(['20260717', '20260716', '20260715', '20260714', '20260713']);
  });

  it('평일 15:30 이후에는 오늘을 첫 후보로 포함한다 (기존 getLastTradingDate 동작과의 하위 호환)', () => {
    // 2026-07-17은 금요일(KST), 16:00
    vi.setSystemTime(new Date('2026-07-17T16:00:00+09:00'));
    const candidates = getTradingDateCandidates(3).map(c => c.yyyymmdd);
    expect(candidates).toEqual(['20260717', '20260716', '20260715']);
  });

  it('평일 15:30 이전에는 오늘을 제외하고 그 전날부터 시작한다', () => {
    // 2026-07-17은 금요일(KST), 10:00 (장중)
    vi.setSystemTime(new Date('2026-07-17T10:00:00+09:00'));
    const candidates = getTradingDateCandidates(3).map(c => c.yyyymmdd);
    expect(candidates).toEqual(['20260716', '20260715', '20260714']);
  });

  it('maxCandidates 개수만큼 주말을 건너뛰어서라도 채운다', () => {
    // 2026-07-20(월) 10:00 — 전날인 일요일부터 시작하면 주말 2일을 건너뛰어야 함
    vi.setSystemTime(new Date('2026-07-20T10:00:00+09:00'));
    const candidates = getTradingDateCandidates(6).map(c => c.yyyymmdd);
    expect(candidates).toEqual(['20260717', '20260716', '20260715', '20260714', '20260713', '20260710']);
  });

  it('getLastTradingDate()는 항상 getTradingDateCandidates(1)[0]과 같은 값을 반환한다', () => {
    vi.setSystemTime(new Date('2026-07-19T12:00:00+09:00'));
    expect(getLastTradingDate()).toEqual(getTradingDateCandidates(1)[0]);
  });
});

// 대시보드 종목별 "AI 분석" 버튼의 활성 구간(장마감~자정)을 판정하는 두 함수 —
// isKoreanMarketOpen()이 false이면서 isKoreanMarketPreOpen()도 false인 구간(장마감~자정)에만
// 버튼이 활성화되어야 한다(2026-08-31, marketOpen만으로는 자정 이후~다음 장까지 계속
// 활성 상태로 남던 문제 수정).
describe('isKoreanMarketOpen / isKoreanMarketPreOpen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('평일 장중(10:00)에는 개장, 자정 이전 구간은 아니다', () => {
    // 2026-07-17은 금요일(KST)
    vi.setSystemTime(new Date('2026-07-17T10:00:00+09:00'));
    expect(isKoreanMarketOpen()).toBe(true);
    expect(isKoreanMarketPreOpen()).toBe(false);
  });

  it('평일 장마감 직후(15:31)에는 폐장, 자정 이전 구간도 아니다 — AI 분석 버튼 활성 구간', () => {
    vi.setSystemTime(new Date('2026-07-17T15:31:00+09:00'));
    expect(isKoreanMarketOpen()).toBe(false);
    expect(isKoreanMarketPreOpen()).toBe(false);
  });

  it('평일 자정 직후(00:00)에는 폐장이면서 자정 이전 구간 — AI 분석 버튼 비활성 구간', () => {
    vi.setSystemTime(new Date('2026-07-20T00:00:00+09:00'));
    expect(isKoreanMarketOpen()).toBe(false);
    expect(isKoreanMarketPreOpen()).toBe(true);
  });

  it('평일 새벽(08:59)에는 여전히 자정 이전 구간, 개장(09:00) 직전 경계에서 전환된다', () => {
    vi.setSystemTime(new Date('2026-07-20T08:59:00+09:00'));
    expect(isKoreanMarketPreOpen()).toBe(true);
    vi.setSystemTime(new Date('2026-07-20T09:00:00+09:00'));
    expect(isKoreanMarketPreOpen()).toBe(false);
    expect(isKoreanMarketOpen()).toBe(true);
  });

  it('주말 새벽에도 자정 이전 구간 판정은 요일과 무관하게 동일하다', () => {
    // 2026-07-19는 일요일(KST)
    vi.setSystemTime(new Date('2026-07-19T03:00:00+09:00'));
    expect(isKoreanMarketOpen()).toBe(false);
    expect(isKoreanMarketPreOpen()).toBe(true);
  });
});

describe('findFirstNonEmptyByDate', () => {
  it('공휴일(빈 응답)인 날짜는 건너뛰고 실제 데이터가 있는 첫 날짜를 채택한다', async () => {
    // 지난주 금요일이 공휴일이었던 시나리오 재현: 금요일엔 빈 배열, 목요일엔 실데이터
    const candidates = [
      { yyyymmdd: '20260717', label: '07/17' }, // 금 (공휴일 — 데이터 없음)
      { yyyymmdd: '20260716', label: '07/16' }, // 목 (실제 마지막 거래일)
      { yyyymmdd: '20260715', label: '07/15' },
    ];
    const fetcher = vi.fn(async (date: string) => (date === '20260716' ? [{ id: 1 }] : []));

    const result = await findFirstNonEmptyByDate(candidates, fetcher);

    expect(result?.date).toBe('20260716');
    expect(result?.label).toBe('07/16');
    expect(result?.rows).toEqual([{ id: 1 }]);
    expect(fetcher).toHaveBeenCalledTimes(2); // 금(실패) → 목(성공)에서 멈춤, 수요일은 시도 안 함
  });

  it('중간 후보에서 fetcher가 예외를 던져도 다음 후보로 넘어간다', async () => {
    const candidates = [
      { yyyymmdd: '20260717', label: '07/17' },
      { yyyymmdd: '20260716', label: '07/16' },
    ];
    const fetcher = vi.fn(async (date: string) => {
      if (date === '20260717') throw new Error('KIS 오류');
      return [{ id: 2 }];
    });

    const result = await findFirstNonEmptyByDate(candidates, fetcher);

    expect(result?.date).toBe('20260716');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('모든 후보가 실패하면 null을 반환한다 (호출부는 이걸 보고 Naver 폴백으로 넘어간다)', async () => {
    const candidates = [
      { yyyymmdd: '20260717', label: '07/17' },
      { yyyymmdd: '20260716', label: '07/16' },
    ];
    const fetcher = vi.fn(async () => []);

    const result = await findFirstNonEmptyByDate(candidates, fetcher);

    expect(result).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// 종목분석 페이지 1년전/1개월전/1주일전 대비 변동률 배지(PriceChangeBadges)가 쓰는 유틸.
function pt(date: string, close: number): ChartDataPoint {
  return { date, open: close, high: close, low: close, close, volume: 0 };
}

describe('findClosestPastClose', () => {
  const points = [pt('2026-01-05', 100), pt('2026-01-06', 101), pt('2026-01-09', 105)];

  it('정확히 일치하는 날짜가 있으면 그 봉을 반환한다', () => {
    expect(findClosestPastClose(points, '2026-01-06')?.close).toBe(101);
  });

  it('목표일이 휴장일 등으로 데이터가 없으면 직전 마지막 거래일을 반환한다', () => {
    // 01-08은 데이터가 없음(01-06과 01-09 사이 공백) — 직전 거래일인 01-06을 채택
    expect(findClosestPastClose(points, '2026-01-08')?.date).toBe('2026-01-06');
  });

  it('목표일이 가장 이른 데이터보다 과거면 null을 반환한다', () => {
    expect(findClosestPastClose(points, '2026-01-01')).toBeNull();
  });

  it('목표일이 가장 최근 데이터보다 미래면 가장 최근 봉을 반환한다', () => {
    expect(findClosestPastClose(points, '2026-02-01')?.close).toBe(105);
  });
});

describe('computePriceChangeBadges', () => {
  const now = new Date('2026-07-30T12:00:00+09:00'); // KST 2026-07-30

  it('1년치 데이터가 모두 있으면 배지 4개를 정확한 등락률로 반환한다', () => {
    const points = [
      pt('2025-07-30', 50000), // 1년 전과 정확히 일치
      pt('2026-01-30', 60000), // 6개월 전과 정확히 일치
      pt('2026-06-30', 68000), // 1개월 전과 정확히 일치
      pt('2026-07-23', 71000), // 1주일 전과 정확히 일치
      pt('2026-07-30', 70000),
    ];
    const badges = computePriceChangeBadges(points, 72000, now);

    expect(badges).toHaveLength(4);
    expect(badges.find(b => b.label === '1년 전')).toMatchObject({
      pastClose: 50000, changeRate: 44, periodHigh: 71000, periodLow: 50000,
    });
    expect(badges.find(b => b.label === '6개월 전')?.changeRate).toBeCloseTo(20, 10);
    expect(badges.find(b => b.label === '6개월 전')).toMatchObject({ periodHigh: 71000, periodLow: 60000 });
    expect(badges.find(b => b.label === '1개월 전')?.changeRate).toBeCloseTo(5.882352941176471, 10);
    expect(badges.find(b => b.label === '1개월 전')).toMatchObject({ periodHigh: 71000, periodLow: 68000 });
    expect(badges.find(b => b.label === '1주일 전')?.changeRate).toBeCloseTo(1.408450704225352, 10);
    expect(badges.find(b => b.label === '1주일 전')).toMatchObject({ periodHigh: 71000, periodLow: 70000 });
  });

  it('기간 중 최고가/최저가는 종가가 아니라 high/low 필드를 기준으로 계산한다', () => {
    const points: ChartDataPoint[] = [
      { date: '2026-07-23', open: 100, high: 130, low: 95, close: 100, volume: 0 },
      { date: '2026-07-27', open: 100, high: 110, low: 80, close: 105, volume: 0 },
      { date: '2026-07-30', open: 105, high: 108, low: 100, close: 106, volume: 0 },
    ];
    const badges = computePriceChangeBadges(points, 106, now);

    const oneWeekAgo = badges.find(b => b.label === '1주일 전');
    // pastDate가 2026-07-23으로 매칭되어 세 봉 전체가 구간에 포함됨
    expect(oneWeekAgo).toMatchObject({ pastDate: '2026-07-23', periodHigh: 130, periodLow: 80 });
  });

  it('상장 1년 미만 등으로 목표일 이전 데이터가 없으면 해당 배지를 생략한다', () => {
    // 최근 11일치 데이터만 존재(2026-07-20~2026-07-30) — 1년 전/6개월 전/1개월 전은 매칭 불가
    const points = Array.from({ length: 11 }, (_, i) =>
      pt(`2026-07-${String(20 + i).padStart(2, '0')}`, 60000 + i * 100)
    );
    const badges = computePriceChangeBadges(points, 61000, now);

    expect(badges).toHaveLength(1);
    expect(badges[0].label).toBe('1주일 전');
    expect(badges[0].pastDate).toBe('2026-07-23');
  });

  it('종가가 0인 봉은 0으로 나누기를 피하기 위해 건너뛴다', () => {
    const points = [pt('2025-07-30', 0), pt('2026-06-30', 68000), pt('2026-07-23', 71000)];
    const badges = computePriceChangeBadges(points, 72000, now);

    expect(badges.find(b => b.label === '1년 전')).toBeUndefined();
    expect(badges.find(b => b.label === '6개월 전')).toBeUndefined();
    expect(badges).toHaveLength(2);
  });

  it('데이터가 전혀 없으면 빈 배열을 반환한다', () => {
    expect(computePriceChangeBadges([], 72000, now)).toEqual([]);
  });
});

// 포트폴리오진단 "기간별 포트폴리오 전체 평가금액 변동"이 쓰는 유틸.
describe('getPriceChangeTargets', () => {
  it('1년 전/6개월 전/1개월 전/1주일 전 4개 타겟을 순서대로 정확한 날짜로 반환한다', () => {
    const now = new Date('2026-07-30T12:00:00+09:00'); // KST 2026-07-30
    const targets = getPriceChangeTargets(now);

    expect(targets.map(t => t.label)).toEqual(['1년 전', '6개월 전', '1개월 전', '1주일 전']);
    expect(targets.map(t => t.date.toISOString().slice(0, 10))).toEqual(
      // kstMidnight은 KST 00:00에 해당하는 UTC 시각(전날 15:00)을 반환하므로
      // ISO 날짜는 하루 전으로 찍힌다 — computePriceChangeBadges가 kstDateStr로
      // 다시 KST 기준 문자열로 바꿔 쓰는 것과 같은 이유.
      ['2025-07-29', '2026-01-29', '2026-06-29', '2026-07-22']
    );
  });
});

describe('computePortfolioPeriodChange', () => {
  const now = new Date('2026-07-30T12:00:00+09:00'); // KST 2026-07-30

  it('전 종목 데이터가 있으면 4개 기간 모두 수량 가중 합산으로 계산한다', () => {
    const holdingA = {
      ticker: 'AAA', quantity: 10,
      points: [
        pt('2025-07-30', 500),  // 1년 전
        pt('2026-01-30', 600),  // 6개월 전
        pt('2026-06-30', 700),  // 1개월 전
        pt('2026-07-23', 750),  // 1주일 전
        pt('2026-07-30', 780),
      ],
    };
    const holdingB = {
      ticker: 'BBB', quantity: 5,
      points: [
        pt('2025-07-30', 200),
        pt('2026-01-30', 250),
        pt('2026-06-30', 300),
        pt('2026-07-23', 320),
        pt('2026-07-30', 330),
      ],
    };
    const currentTotalValue = 10000;
    const rows = computePortfolioPeriodChange([holdingA, holdingB], currentTotalValue, now);

    expect(rows).toHaveLength(4);
    const byLabel = Object.fromEntries(rows.map(r => [r.label, r]));

    expect(byLabel['1년 전'].pastValue).toBe(500 * 10 + 200 * 5); // 6000
    expect(byLabel['1년 전'].changeRate).toBeCloseTo(((10000 - 6000) / 6000) * 100, 10);
    expect(byLabel['1년 전'].missingTickers).toEqual([]);

    expect(byLabel['6개월 전'].pastValue).toBe(600 * 10 + 250 * 5); // 7250
    expect(byLabel['6개월 전'].changeRate).toBeCloseTo(((10000 - 7250) / 7250) * 100, 10);

    expect(byLabel['1개월 전'].pastValue).toBe(700 * 10 + 300 * 5); // 8500
    expect(byLabel['1주일 전'].pastValue).toBe(750 * 10 + 320 * 5); // 9100

    // 날짜별 포트폴리오 평가금액 시계열: 6000(1년전) → 7250(6개월전) → 8500(1개월전)
    // → 9100(1주일전) → 9450(오늘) — 단조 증가라 각 기간의 최고=오늘(9450), 최저=그
    // 기간의 시작값 그대로.
    expect(byLabel['1년 전']).toMatchObject({ periodHigh: 9450, periodLow: 6000 });
    expect(byLabel['6개월 전']).toMatchObject({ periodHigh: 9450, periodLow: 7250 });
    expect(byLabel['1개월 전']).toMatchObject({ periodHigh: 9450, periodLow: 8500 });
    expect(byLabel['1주일 전']).toMatchObject({ periodHigh: 9450, periodLow: 9100 });
  });

  it('기간 중 최고/최저 평가금액은 구간 내 중간 스파이크도 반영한다(끝값이 아님)', () => {
    const holding = {
      ticker: 'AAA', quantity: 10,
      points: [
        pt('2026-06-29', 100), // 1개월 전과 정확히 일치(=pastValue 1000)
        pt('2026-07-05', 200), // 중간 스파이크(고점)
        pt('2026-07-10', 50),  // 중간 저점
        pt('2026-07-30', 120),
      ],
    };
    const rows = computePortfolioPeriodChange([holding], 1200, now);
    const oneMonthAgo = rows.find(r => r.label === '1개월 전')!;

    expect(oneMonthAgo.pastValue).toBe(1000);
    expect(oneMonthAgo.periodHigh).toBe(2000); // 07-05 스파이크(200*10), 끝값(120*10=1200)이 아님
    expect(oneMonthAgo.periodLow).toBe(500);   // 07-10 저점(50*10), 시작값(1000)도 아님
  });

  it('일부 종목 조회 실패(points: null)는 그 종목만 제외하고 나머지로 계산한다', () => {
    const holdingA = {
      ticker: 'AAA', quantity: 10,
      points: [pt('2025-07-30', 500), pt('2026-07-30', 780)],
    };
    const holdingB = { ticker: 'BBB', quantity: 5, points: null }; // 조회 실패

    const rows = computePortfolioPeriodChange([holdingA, holdingB], 10000, now);
    const oneYearAgo = rows.find(r => r.label === '1년 전')!;

    expect(oneYearAgo.pastValue).toBe(500 * 10); // BBB 제외
    expect(oneYearAgo.missingTickers).toEqual(['BBB']);
  });

  it('특정 기간에 전 종목이 실패하면 그 기간 행만 결과에서 생략한다', () => {
    // 두 종목 모두 최근 40일치만 있음(2026-06-20~2026-07-30) — 1년 전/6개월 전은
    // 두 종목 다 매칭 실패, 1개월 전/1주일 전은 매칭 성공
    const recentPoints = (base: number) =>
      Array.from({ length: 41 }, (_, i) => {
        const d = new Date('2026-06-20T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + i);
        return pt(d.toISOString().slice(0, 10), base + i);
      });

    const holdingA = { ticker: 'AAA', quantity: 10, points: recentPoints(700) };
    const holdingB = { ticker: 'BBB', quantity: 5, points: recentPoints(300) };

    const rows = computePortfolioPeriodChange([holdingA, holdingB], 10000, now);

    expect(rows.map(r => r.label)).toEqual(['1개월 전', '1주일 전']);
  });

  it('holdings가 비어있으면 빈 배열을 반환한다', () => {
    expect(computePortfolioPeriodChange([], 10000, now)).toEqual([]);
  });
});
