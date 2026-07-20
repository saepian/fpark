// 국내증시 급등/급락 테이블이 "지난주 금요일이 공휴일"이었던 일요일에 빈 값으로 표시된
// 버그 수정을 검증하는 테스트. 실제 KIS API를 호출하지 않고 시스템 시간과 fetcher를
// mock해서, "요일 계산 하나로 날짜를 확정" → "실제 데이터가 존재하는 날짜를 찾을 때까지
// 후보를 순차 재시도"로 바뀐 동작을 확인한다.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTradingDateCandidates, getLastTradingDate, findFirstNonEmptyByDate } from './market-utils';

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
