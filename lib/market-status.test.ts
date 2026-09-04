// 시장 데이터 기준일 라벨 — 장중/마감후/개장전/공휴일/주말/개장직후 유예를 시각·차트 mock으로 검증.
import { describe, it, expect } from 'vitest';
import { getDomesticMarketDayContext } from './market-day-context';
import { resolveMarketStatus, marketStatusLabel, toMonthDayLabel, statusFromLegacy } from './market-status';

const kst = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+09:00`);
const chart = (...dates: string[]) => dates.map((date) => ({ date }));
const resolve = (now: Date, rows: { date: string }[]) => resolveMarketStatus(getDomesticMarketDayContext(rows, now), now);

describe('resolveMarketStatus', () => {
  it('장중(금 9/4 10:05, 오늘 행 있음) → open, 데이터 09/04', () => {
    expect(resolve(kst('2026-09-04', '10:05'), chart('2026-09-03', '2026-09-04'))).toEqual({ status: 'open', dataDate: '2026-09-04', dataDateLabel: '09/04' });
  });
  it('마감 후(금 9/4 16:08, 오늘 행 있음) → closed, 데이터 09/04 (예전 "전일 기준 · 09/04" 오표기 케이스)', () => {
    expect(resolve(kst('2026-09-04', '16:08'), chart('2026-09-03', '2026-09-04'))).toEqual({ status: 'closed', dataDate: '2026-09-04', dataDateLabel: '09/04' });
  });
  it('개장 전(월 9/7 08:30, 마지막 행 9/4) → pre_open, 데이터 09/04', () => {
    expect(resolve(kst('2026-09-07', '08:30'), chart('2026-09-03', '2026-09-04'))).toEqual({ status: 'pre_open', dataDate: '2026-09-04', dataDateLabel: '09/04' });
  });
  it('공휴일(평일 11:00인데 오늘 행 없음, 유예 지남) → holiday, 데이터는 마지막 거래일', () => {
    // 2026-10-09(금, 한글날) 가정 — 차트 마지막 행 10/08
    expect(resolve(kst('2026-10-09', '11:00'), chart('2026-10-07', '2026-10-08'))).toEqual({ status: 'holiday', dataDate: '2026-10-08', dataDateLabel: '10/08' });
    expect(resolve(kst('2026-10-09', '16:00'), chart('2026-10-07', '2026-10-08')).status).toBe('holiday');
  });
  it('개장 직후 유예(평일 09:10, 아직 오늘 행 없음) → open으로 취급, 09:30 이후엔 holiday', () => {
    expect(resolve(kst('2026-09-04', '09:10'), chart('2026-09-02', '2026-09-03')).status).toBe('open');
    expect(resolve(kst('2026-09-04', '09:31'), chart('2026-09-02', '2026-09-03')).status).toBe('holiday');
  });
  it('주말(토 9/5) → weekend, 데이터 09/04', () => {
    expect(resolve(kst('2026-09-05', '12:00'), chart('2026-09-04'))).toEqual({ status: 'weekend', dataDate: '2026-09-04', dataDateLabel: '09/04' });
  });
  it('차트 조회 실패(빈 배열) 평일 장중 → 거래일 간주 open, 날짜는 오늘', () => {
    expect(resolve(kst('2026-09-04', '10:00'), [])).toMatchObject({ status: 'open', dataDate: '2026-09-04' });
  });
});

describe('marketStatusLabel — 위젯별 표기(전일 단어 없음)', () => {
  const closed = { status: 'closed' as const, dataDateLabel: '09/04' };
  const open = { status: 'open' as const, dataDateLabel: '09/04' };
  const pre = { status: 'pre_open' as const, dataDateLabel: '09/04' };
  const hol = { status: 'holiday' as const, dataDateLabel: '10/08' };
  it('TOP MOVERS', () => {
    expect(marketStatusLabel('movers', open)).toBe('실시간');
    expect(marketStatusLabel('movers', open, '2026-09-04T01:20:00Z')).toBe('실시간 · 10:20 기준'); // 장중 캐시히트 = "장마감" 아님
    expect(marketStatusLabel('movers', closed)).toBe('09/04 마감 기준');
    expect(marketStatusLabel('movers', pre)).toBe('09/04 종가 기준');
    expect(marketStatusLabel('movers', hol)).toBe('10/08 종가 기준');
  });
  it('MARKET SUMMARY', () => {
    expect(marketStatusLabel('summary', open)).toBe('실시간');
    expect(marketStatusLabel('summary', closed)).toBe('09/04 종가 기준');
    expect(marketStatusLabel('summary', hol)).toBe('10/08 종가 기준');
  });
  it('히어로 배지', () => {
    expect(marketStatusLabel('hero', open)).toBe('실시간');
    expect(marketStatusLabel('hero', closed)).toBe('마감 · 09/04');
    expect(marketStatusLabel('hero', { status: 'weekend', dataDateLabel: '09/04' })).toBe('마감 · 09/04');
  });
  it('어떤 라벨에도 "전일"이 없다', () => {
    for (const w of ['movers', 'summary', 'hero'] as const) for (const s of [open, closed, pre, hol]) expect(marketStatusLabel(w, s)).not.toContain('전일');
  });
  it('보조', () => {
    expect(toMonthDayLabel('2026-09-04')).toBe('09/04');
    expect(statusFromLegacy(true, '09/04')).toEqual({ status: 'closed', dataDateLabel: '09/04' });
    expect(statusFromLegacy(false, undefined)).toEqual({ status: 'open', dataDateLabel: '' });
  });
});
