// AI 리포트 4종이 휴장일에도 "오늘 마감"인 것처럼 서술하던 문제의 원인 조사 후 신설한
// lib/market-day-context.ts 검증. 실제 KIS/Yahoo를 호출하지 않고, 이미 fetch된 차트
// 데이터를 흉내낸 fixture + vi.setSystemTime으로 실제 과거 날짜(주말/공휴일)를 재현한다.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDomesticMarketDayContext, getOverseasMarketDayContext, buildMarketDayBlock } from './market-day-context';

describe('getDomesticMarketDayContext', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('일요일(주말)은 마지막 거래일(금요일) 기준으로 휴장 처리한다', () => {
    // 2026-07-26은 일요일(KST), 낮 12시. 마지막 거래일은 금요일 2026-07-24.
    vi.setSystemTime(new Date('2026-07-26T12:00:00+09:00'));
    const chart = [
      { date: '2026-07-22' }, { date: '2026-07-23' }, { date: '2026-07-24' },
    ];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.reason).toBe('weekend');
    expect(ctx.lastTradingDate).toBe('2026-07-24');
    expect(ctx.daysSinceLastTradingDate).toBe(2);
  });

  it('오늘 차트 행이 이미 있으면(장마감 후) 거래일로 확정한다', () => {
    // 2026-07-24는 금요일(KST), 16:00 — 장마감(15:30) 이후라 오늘 캔들이 이미 채워짐.
    vi.setSystemTime(new Date('2026-07-24T16:00:00+09:00'));
    const chart = [{ date: '2026-07-22' }, { date: '2026-07-23' }, { date: '2026-07-24' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(true);
    expect(ctx.reason).toBeNull();
    expect(ctx.lastTradingDate).toBe('2026-07-24');
    expect(ctx.daysSinceLastTradingDate).toBe(0);
  });

  it('평일 정규장 시간 중이라도 오늘 행이 있으면(장중 진행중 캔들) 거래일로 확정한다', () => {
    // 2026-07-27 09:12 KST 실측(로컬 QA)에서 확인된 실제 동작 — 개장 직후부터 KIS
    // 일별차트가 당일 진행중 캔들을 반영한다. 2026-07-24는 금요일(KST), 11:00.
    vi.setSystemTime(new Date('2026-07-24T11:00:00+09:00'));
    const chart = [{ date: '2026-07-22' }, { date: '2026-07-23' }, { date: '2026-07-24' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(true);
    expect(ctx.reason).toBeNull();
    expect(ctx.daysSinceLastTradingDate).toBe(0);
  });

  it('평일 개장 전 새벽에는 판정을 보류하고 거래일(평시)로 간주한다', () => {
    // 2026-07-24는 금요일(KST), 06:00 — 개장 전.
    vi.setSystemTime(new Date('2026-07-24T06:00:00+09:00'));
    const chart = [{ date: '2026-07-22' }, { date: '2026-07-23' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(true);
    expect(ctx.reason).toBeNull();
  });

  it('평일 공휴일(신정, 2026-01-01 목요일)은 개장 시각(09:00) 이후 곧바로 실측으로 정확히 잡는다', () => {
    // 2026-01-01은 목요일(KST) 신정 공휴일, 10:00 — 개장 시각이 지났는데도 차트에 오늘
    // (1/1) 행이 없음 → 공휴일로 판정(실제 거래일이면 09:00 직후 진행중 캔들이 이미
    // 생겼어야 함 — 위 파일 상단 2026-07-27 실측 주석 참고). 실제 마지막 거래일은
    // 전날 거래일인 2025-12-31.
    vi.setSystemTime(new Date('2026-01-01T10:00:00+09:00'));
    const chart = [{ date: '2025-12-29' }, { date: '2025-12-30' }, { date: '2025-12-31' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.reason).toBe('holiday');
    expect(ctx.lastTradingDate).toBe('2025-12-31');
    expect(ctx.daysSinceLastTradingDate).toBe(1);
  });

  it('알려진 한계: 평일 공휴일이라도 개장 시각(09:00) 전 새벽에는 정상 거래일과 데이터상 구분이 안 되어 거래일로 간주된다', () => {
    // 같은 2026-01-01 신정이지만 06:00(개장 전) — 이 시간대는 실제 거래일이든 공휴일이든
    // 데이터가 똑같이 없어 차트만으로 판별 불가능하므로 보수적으로 거래일로 처리.
    vi.setSystemTime(new Date('2026-01-01T06:00:00+09:00'));
    const chart = [{ date: '2025-12-29' }, { date: '2025-12-30' }, { date: '2025-12-31' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(true);
  });

  it('차트 조회 자체가 실패했을 때는 요일만으로 폴백한다 (주말)', () => {
    vi.setSystemTime(new Date('2026-07-26T12:00:00+09:00'));
    const ctx = getDomesticMarketDayContext([]);
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.reason).toBe('weekend');
  });

  it('차트 조회 자체가 실패했을 때는 요일만으로 폴백한다 (평일은 보수적으로 거래일)', () => {
    vi.setSystemTime(new Date('2026-07-24T16:00:00+09:00'));
    const ctx = getDomesticMarketDayContext([]);
    expect(ctx.isTradingDay).toBe(true);
    expect(ctx.reason).toBeNull();
  });
});

// daily-alert-email(15:45 KST)·market-cache-warm(15:35 KST) 크론은 vercel.json 스케줄로
// 이미 평일(1-5)만 실행되므로 주말은 신경 쓸 필요가 없고, 이 크론들이 실제로 걱정하는
// 케이스는 "평일인데 공휴일이라 장이 안 열린 날" 하나뿐이다 — 두 크론 모두 실행 시각이
// 정규장 마감(15:30) 이후라 홀리데이 판정이 항상 신뢰 가능한 구간(위 2026-01-01 신정
// 테스트가 이미 증명한 그 구간)에 들어간다. 한글날(2026-10-09, 금요일)로 다시 한번
// 재현해 다른 날짜에서도 크론 시각 기준 판정이 정확한지 확인한다.
describe('국내 크론(daily-alert-email/market-cache-warm) 휴장일 스킵 시나리오', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('한글날(2026-10-09, 금요일) 15:45 KST — daily-alert-email 실행 시각 기준 휴장 판정, 발송 생략 조건 충족', () => {
    vi.setSystemTime(new Date('2026-10-09T15:45:00+09:00'));
    const chart = [{ date: '2026-10-06' }, { date: '2026-10-07' }, { date: '2026-10-08' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.reason).toBe('holiday');
    expect(ctx.lastTradingDate).toBe('2026-10-08');
    // 라우트의 실제 스킵 조건과 동일하게 검증 — !ctx.isTradingDay일 때만 발송을 건너뛴다.
    expect(!ctx.isTradingDay).toBe(true);
  });

  it('한글날 15:35 KST — market-cache-warm 실행 시각 기준으로도 동일하게 휴장 판정된다', () => {
    vi.setSystemTime(new Date('2026-10-09T15:35:00+09:00'));
    const chart = [{ date: '2026-10-06' }, { date: '2026-10-07' }, { date: '2026-10-08' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.reason).toBe('holiday');
  });

  it('평일 정상 거래일(신정 다음 거래일)에는 두 크론 모두 스킵하지 않는다', () => {
    // 2026-01-02(금)는 신정 다음날 — 정상 개장일. 15:45 KST엔 이미 오늘 캔들이 확정돼 있음.
    vi.setSystemTime(new Date('2026-01-02T15:45:00+09:00'));
    const chart = [{ date: '2025-12-31' }, { date: '2026-01-02' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(true);
    expect(!ctx.isTradingDay).toBe(false);
  });
});

// stock-alerts 크론(09:00~15:30 KST, 10분 간격)은 2026-08-17(광복절 대체공휴일, 월요일)에
// isMarketOpen()이 요일+시각만 확인해 공휴일을 걸러내지 못한 채로 실행되어, KIS가 반환한
// 마지막 거래일(8/14 금) 스냅샷을 "오늘 변동"으로 오인해 알림을 발송한 실제 장애 사례.
// daily-alert-email/market-cache-warm과 달리 이 크론은 장중(09:00 직후~15:20)에도 도는데,
// getDomesticMarketDayContext()는 09:00 이후 구간에서 신뢰 가능하도록 설계되어 있으므로
// (위 2026-01-01/2026-07-27 실측 주석 참고) 동일하게 재사용 가능하다.
describe('국내 크론(stock-alerts) 휴장일 스킵 시나리오', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('광복절 대체공휴일(2026-08-17, 월요일) 09:00 KST — 첫 tick부터 휴장으로 판정해 스킵된다', () => {
    vi.setSystemTime(new Date('2026-08-17T09:00:00+09:00'));
    const chart = [{ date: '2026-08-12' }, { date: '2026-08-13' }, { date: '2026-08-14' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.reason).toBe('holiday');
    expect(ctx.lastTradingDate).toBe('2026-08-14');
    expect(!ctx.isTradingDay).toBe(true);
  });

  it('광복절 대체공휴일(2026-08-17) 10:50 KST — 실제 장애가 발생했던 시각에도 동일하게 휴장 판정된다', () => {
    vi.setSystemTime(new Date('2026-08-17T10:50:00+09:00'));
    const chart = [{ date: '2026-08-12' }, { date: '2026-08-13' }, { date: '2026-08-14' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.reason).toBe('holiday');
    expect(ctx.lastTradingDate).toBe('2026-08-14');
  });

  it('정상 거래일(2026-08-18, 화요일) 10:50 KST에는 스킵하지 않고 그대로 진행한다', () => {
    // 8/17(월) 휴장 다음날 — 정상 개장일. 장중이라 오늘(8/18) 캔들이 이미 반영돼 있음.
    vi.setSystemTime(new Date('2026-08-18T10:50:00+09:00'));
    const chart = [{ date: '2026-08-13' }, { date: '2026-08-14' }, { date: '2026-08-18' }];
    const ctx = getDomesticMarketDayContext(chart);
    expect(ctx.isTradingDay).toBe(true);
    expect(ctx.reason).toBeNull();
    expect(!ctx.isTradingDay).toBe(false);
  });
});

describe('getOverseasMarketDayContext', () => {
  it('marketState가 REGULAR/PRE/POST면 거래일로 판정한다', () => {
    const chart = [{ date: '2026-07-23' }, { date: '2026-07-24' }];
    for (const state of ['REGULAR', 'PRE', 'POST']) {
      const ctx = getOverseasMarketDayContext(chart, state, new Date('2026-07-24T22:00:00+09:00'));
      expect(ctx.isTradingDay).toBe(true);
      expect(ctx.reason).toBeNull();
    }
  });

  it('marketState가 CLOSED이고 주말이면 휴장(주말)으로 판정한다', () => {
    // 2026-07-26(일) — 미국장도 휴장, 마지막 세션은 2026-07-24(금)
    const now = new Date('2026-07-26T10:00:00+09:00');
    const chart = [{ date: '2026-07-23' }, { date: '2026-07-24' }];
    const ctx = getOverseasMarketDayContext(chart, 'CLOSED', now);
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.reason).toBe('weekend');
    expect(ctx.lastTradingDate).toBe('2026-07-24');
    expect(ctx.daysSinceLastTradingDate).toBe(2);
  });

  it('차트가 비어있고 CLOSED면 오늘 날짜를 기준으로 휴장 처리한다', () => {
    const ctx = getOverseasMarketDayContext([], 'CLOSED', new Date('2026-07-26T10:00:00+09:00'));
    expect(ctx.isTradingDay).toBe(false);
  });
});

describe('buildMarketDayBlock', () => {
  it('거래일이면 짧은 확인 문구만 반환한다', () => {
    const text = buildMarketDayBlock({ isTradingDay: true, lastTradingDate: '2026-07-24', daysSinceLastTradingDate: 0, reason: null });
    expect(text).toContain('거래일');
    expect(text).not.toContain('휴장');
  });

  it('휴장일 1일 전(어제)이면 "어제" 표현을 쓴다', () => {
    const text = buildMarketDayBlock({ isTradingDay: false, lastTradingDate: '2026-07-24', daysSinceLastTradingDate: 1, reason: 'weekend' });
    expect(text).toContain('어제(2026-07-24)');
    expect(text).toContain('2026-07-24 마감 기준');
  });

  it('휴장일 N일 전이면 "N일 전" 표현을 쓴다', () => {
    const text = buildMarketDayBlock({ isTradingDay: false, lastTradingDate: '2026-07-24', daysSinceLastTradingDate: 3, reason: 'holiday' });
    expect(text).toContain('3일 전인 2026-07-24');
    expect(text).toContain('공휴일');
  });
});
