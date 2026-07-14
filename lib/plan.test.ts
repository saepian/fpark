// 2026-07-08 발견: app/api/diagnosis/route.ts가 관리자 제외 전원을 하루 1회로 하드코딩해
// pricing 광고(Free 1회/Basic 6회/Pro 11회)와 불일치하던 버그의 회귀 테스트.
// resolveDiagnosisLimit()이 PLAN_USAGE_LIMITS(lib/payment-constants.ts)를 그대로
// 반영하는지 고정해서, 둘 중 하나만 바뀌고 다른 하나는 안 바뀌는 재발을 막는다.
// 2026-07-14 요금제 재구성: 기업분석 일일→월간 전환, 숫자 갱신(Free 5/Basic 30/Pro 50).

import { describe, it, expect } from 'vitest';
import { resolveDiagnosisLimit, resolvePortfolioLimit, resolveStockAnalysisLimit, getUsageCycleStart, isStockAnalysisDaily } from './plan';

describe('resolveDiagnosisLimit', () => {
  it('free는 월 5회', () => {
    expect(resolveDiagnosisLimit('free')).toBe(5);
  });

  it('basic은 월 30회', () => {
    expect(resolveDiagnosisLimit('basic')).toBe(30);
  });

  it('pro는 월 50회', () => {
    expect(resolveDiagnosisLimit('pro')).toBe(50);
  });

  it('admin은 사실상 무제한(999)', () => {
    expect(resolveDiagnosisLimit('admin')).toBe(999);
  });
});

// app/api/portfolio-diagnosis/route.ts가 로컬 상수(MONTHLY_LIMIT/BASIC_MONTHLY_LIMIT)로
// 따로 들고 있던 값을 resolveDiagnosisLimit과 같은 패턴으로 공용화하면서 추가한 회귀 테스트.
describe('resolvePortfolioLimit', () => {
  it('free는 0회 (크레딧 없으면 403)', () => {
    expect(resolvePortfolioLimit('free')).toBe(0);
  });

  it('basic은 월 5회 (2026-07-14 요금제 재구성, 이전엔 1이었음)', () => {
    expect(resolvePortfolioLimit('basic')).toBe(5);
  });

  it('pro는 월 20회', () => {
    expect(resolvePortfolioLimit('pro')).toBe(20);
  });

  it('admin은 사실상 무제한(999)', () => {
    expect(resolvePortfolioLimit('admin')).toBe(999);
  });
});

// 2026-07-14 신설 — 종목분석은 이전까지 한도 자체가 없었다.
// 2026-07-15 정정: free는 애초에 월 30회로 설계했으나, 무료 회원이 하루에 몰아 쓸 수
// 있다는 문제로 "일 1회"로 변경(basic/pro는 그대로 월간 50/100).
describe('resolveStockAnalysisLimit', () => {
  it('free는 일 1회', () => {
    expect(resolveStockAnalysisLimit('free')).toBe(1);
  });

  it('basic은 월 50회', () => {
    expect(resolveStockAnalysisLimit('basic')).toBe(50);
  });

  it('pro는 월 100회', () => {
    expect(resolveStockAnalysisLimit('pro')).toBe(100);
  });

  it('admin은 사실상 무제한(999)', () => {
    expect(resolveStockAnalysisLimit('admin')).toBe(999);
  });
});

describe('isStockAnalysisDaily', () => {
  it('free만 일간 한도', () => {
    expect(isStockAnalysisDaily('free')).toBe(true);
  });

  it('basic/pro/admin은 월간 한도', () => {
    expect(isStockAnalysisDaily('basic')).toBe(false);
    expect(isStockAnalysisDaily('pro')).toBe(false);
    expect(isStockAnalysisDaily('admin')).toBe(false);
  });
});

// app/api/portfolio-diagnosis/route.ts와 app/api/mypage/route.ts에 거의 동일하게
// 중복 정의돼 있던 사이클 계산을 공용화하면서 추가한 회귀 테스트(2026-07-14).
describe('getUsageCycleStart', () => {
  it('subscriptionStartDate가 null이면 캘린더월(매월 1일)로 폴백', () => {
    const now = new Date(2026, 6, 14); // 2026-07-14
    const { cycleStart, nextCycleStart } = getUsageCycleStart(null, now);
    expect(cycleStart).toEqual(new Date(2026, 6, 1));
    expect(nextCycleStart).toEqual(new Date(2026, 7, 1));
  });

  it('결제일이 이번 달에 이미 지났으면 이번 달 결제일이 사이클 시작', () => {
    const now = new Date(2026, 6, 14); // 2026-07-14
    const { cycleStart, nextCycleStart } = getUsageCycleStart('2026-05-10T00:00:00+09:00', now);
    expect(cycleStart).toEqual(new Date(2026, 6, 10));
    expect(nextCycleStart).toEqual(new Date(2026, 7, 10));
  });

  it('결제일이 이번 달에 아직 안 지났으면 지난달 결제일이 사이클 시작', () => {
    const now = new Date(2026, 6, 5); // 2026-07-05
    const { cycleStart, nextCycleStart } = getUsageCycleStart('2026-05-20T00:00:00+09:00', now);
    expect(cycleStart).toEqual(new Date(2026, 5, 20));
    expect(nextCycleStart).toEqual(new Date(2026, 6, 20));
  });

  it('말일 결제일은 짧은 달로 클램핑 (1/31 가입 → 2월 사이클은 28일 시작, 2026은 평년)', () => {
    const now = new Date(2026, 1, 28); // 2026-02-28
    const { cycleStart, nextCycleStart } = getUsageCycleStart('2026-01-31T00:00:00+09:00', now);
    expect(cycleStart).toEqual(new Date(2026, 1, 28));
    expect(nextCycleStart).toEqual(new Date(2026, 2, 31));
  });
});
