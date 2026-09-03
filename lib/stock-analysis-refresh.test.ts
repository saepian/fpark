// 2026-09-03 조사: 종목분석 리포트 재생성(캐시 갱신) 조건 검증 — 7/29 제보(SK하이닉스가
// 아침 생성 후 10%p+ 벌어져도 그대로였음)에 대응해 7/30에 이미 추가된 2단 임계값
// (30분+5% 급변 / 2시간+2.5% 완만한 변동) 로직이 실제로 정확한지, 장마감 강제 재생성이
// 실제로 정확한지 실측 검증한다. 이 로직 자체는 이미 존재/수정됐지만 이 파일 이전엔
// 회귀를 막는 자동화 테스트가 전혀 없었다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/kis-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kis-api')>();
  return { ...actual, fetchStockPrice: vi.fn() };
});

import { isIntradayCacheStale, isIntradayRefreshDue } from './stock-analysis-refresh';
import { fetchStockPrice } from '@/lib/kis-api';

const mockedFetchStockPrice = vi.mocked(fetchStockPrice);

// KST 자정 기준 분(minutes-since-midnight)을 실제 UTC ISO 문자열로 변환 — 테스트에서
// "오늘 09:35 KST에 생성됨" 같은 시나리오를 명확하게 표현하기 위한 헬퍼.
function kstTimeToday(hour: number, minute: number): Date {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstMidnight = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
  const kstTarget = new Date(kstMidnight.getTime() + (hour * 60 + minute) * 60 * 1000);
  return new Date(kstTarget.getTime() - 9 * 60 * 60 * 1000); // UTC로 환원
}

describe('isIntradayCacheStale — 장마감 캐시 무효화', () => {
  it('장중(마감 전)에 생성된 캐시를, 마감 후 시점에 조회하면 stale', () => {
    vi.useFakeTimers();
    vi.setSystemTime(kstTimeToday(16, 0)); // 지금은 16:00 KST(마감 후)
    const createdAt = kstTimeToday(9, 30).toISOString(); // 09:30 KST 생성(마감 전)
    expect(isIntradayCacheStale(createdAt)).toBe(true);
    vi.useRealTimers();
  });

  it('장중에 생성됐고 지금도 장중이면 stale 아님', () => {
    vi.useFakeTimers();
    vi.setSystemTime(kstTimeToday(14, 0)); // 지금 14:00 KST(장중)
    const createdAt = kstTimeToday(9, 30).toISOString();
    expect(isIntradayCacheStale(createdAt)).toBe(false);
    vi.useRealTimers();
  });

  it('이미 마감 후에 생성된 캐시는(장마감 확정치 반영) stale 아님', () => {
    vi.useFakeTimers();
    vi.setSystemTime(kstTimeToday(20, 0));
    const createdAt = kstTimeToday(16, 0).toISOString(); // 16:00(마감 후) 생성
    expect(isIntradayCacheStale(createdAt)).toBe(false);
    vi.useRealTimers();
  });
});

describe('isIntradayRefreshDue — 장중 신선도 트리거(2단 임계값)', () => {
  beforeEach(() => {
    mockedFetchStockPrice.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('장 시작 전/마감 후엔 항상 due:false(가격 조회 자체를 안 함)', async () => {
    vi.setSystemTime(kstTimeToday(8, 0)); // 개장 전
    const result = await isIntradayRefreshDue(kstTimeToday(7, 0).toISOString(), 70000, '005930');
    expect(result.due).toBe(false);
    expect(mockedFetchStockPrice).not.toHaveBeenCalled();
  });

  it('생성 후 30분 미만이면 가격이 아무리 움직여도 due:false(가격 조회도 안 함)', async () => {
    vi.setSystemTime(kstTimeToday(9, 20));
    const result = await isIntradayRefreshDue(kstTimeToday(9, 0).toISOString(), 70000, '005930');
    expect(result.due).toBe(false);
    expect(mockedFetchStockPrice).not.toHaveBeenCalled();
  });

  // 2026-07-30에 이 케이스(SK하이닉스, 생성 1.5시간 후 8%p+ 급변) 때문에 추가된 "급변 tier".
  // 7/29 제보의 실제 원인 재현 — 이 테스트가 통과하면 그 원인은 이미 해소됐다는 뜻.
  it('30분~2시간 구간(급변 tier): 5% 이상 움직이면 due:true — 실측 재현(SK하이닉스 09:16 생성, 1.5h 후 8%p 급변)', async () => {
    vi.setSystemTime(kstTimeToday(10, 46)); // 09:16 생성 + 1.5시간
    mockedFetchStockPrice.mockResolvedValue({
      ticker: '000660', name: 'SK하이닉스', price: 189000, change: 0, changeRate: 0, volume: 0, tradingValue: '0', sector: '', market: 'KOSPI',
    } as Awaited<ReturnType<typeof fetchStockPrice>>);
    // 생성 시점 저장가 175,000원 → 현재 189,000원 = +8.0% 변동
    const result = await isIntradayRefreshDue(kstTimeToday(9, 16).toISOString(), 175000, '000660');
    expect(result.due).toBe(true);
    expect(result.reason).toContain('변동');
  });

  it('30분~2시간 구간: 5% 미만이면 due:false(급변 tier 통과선 미달)', async () => {
    vi.setSystemTime(kstTimeToday(10, 46));
    mockedFetchStockPrice.mockResolvedValue({
      ticker: '000660', name: 'SK하이닉스', price: 182000, change: 0, changeRate: 0, volume: 0, tradingValue: '0', sector: '', market: 'KOSPI',
    } as Awaited<ReturnType<typeof fetchStockPrice>>);
    // 175,000 → 182,000 = +4.0% (5% 미만)
    const result = await isIntradayRefreshDue(kstTimeToday(9, 16).toISOString(), 175000, '000660');
    expect(result.due).toBe(false);
  });

  it('2시간 이상 경과: 2.5% 이상만 움직여도(급변 tier보다 완화된 기준) due:true', async () => {
    vi.setSystemTime(kstTimeToday(12, 0)); // 09:00 생성 + 3시간
    mockedFetchStockPrice.mockResolvedValue({
      ticker: '005930', name: '삼성전자', price: 71800, change: 0, changeRate: 0, volume: 0, tradingValue: '0', sector: '', market: 'KOSPI',
    } as Awaited<ReturnType<typeof fetchStockPrice>>);
    // 70,000 → 71,800 = +2.57%
    const result = await isIntradayRefreshDue(kstTimeToday(9, 0).toISOString(), 70000, '005930');
    expect(result.due).toBe(true);
  });

  it('2시간 이상 경과: 2.5% 미만이면 due:false', async () => {
    vi.setSystemTime(kstTimeToday(12, 0));
    mockedFetchStockPrice.mockResolvedValue({
      ticker: '005930', name: '삼성전자', price: 71500, change: 0, changeRate: 0, volume: 0, tradingValue: '0', sector: '', market: 'KOSPI',
    } as Awaited<ReturnType<typeof fetchStockPrice>>);
    // 70,000 → 71,500 = +2.14%
    const result = await isIntradayRefreshDue(kstTimeToday(9, 0).toISOString(), 70000, '005930');
    expect(result.due).toBe(false);
  });

  it('가격 조회 실패 시 안전하게 due:false(기존 캐시 유지)', async () => {
    vi.setSystemTime(kstTimeToday(12, 0));
    mockedFetchStockPrice.mockRejectedValue(new Error('KIS 타임아웃'));
    const result = await isIntradayRefreshDue(kstTimeToday(9, 0).toISOString(), 70000, '005930');
    expect(result.due).toBe(false);
  });

  it('storedPrice가 없으면(null) due:false', async () => {
    vi.setSystemTime(kstTimeToday(12, 0));
    const result = await isIntradayRefreshDue(kstTimeToday(9, 0).toISOString(), null, '005930');
    expect(result.due).toBe(false);
    expect(mockedFetchStockPrice).not.toHaveBeenCalled();
  });
});
