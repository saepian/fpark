// 2026-07-08 발견: app/api/diagnosis/route.ts가 관리자 제외 전원을 하루 1회로 하드코딩해
// pricing 광고(Free 1회/Basic 6회/Pro 11회)와 불일치하던 버그의 회귀 테스트.
// resolveDiagnosisLimit()이 PLAN_USAGE_LIMITS(lib/payment-constants.ts)를 그대로
// 반영하는지 고정해서, 둘 중 하나만 바뀌고 다른 하나는 안 바뀌는 재발을 막는다.

import { describe, it, expect } from 'vitest';
import { resolveDiagnosisLimit, resolvePortfolioLimit } from './plan';

describe('resolveDiagnosisLimit', () => {
  it('free는 하루 1회', () => {
    expect(resolveDiagnosisLimit('free')).toBe(1);
  });

  it('basic은 하루 6회 (버그 이전엔 1이었음)', () => {
    expect(resolveDiagnosisLimit('basic')).toBe(6);
  });

  it('pro는 하루 11회 (버그 이전엔 1이었음)', () => {
    expect(resolveDiagnosisLimit('pro')).toBe(11);
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

  it('basic은 월 1회', () => {
    expect(resolvePortfolioLimit('basic')).toBe(1);
  });

  it('pro는 월 20회', () => {
    expect(resolvePortfolioLimit('pro')).toBe(20);
  });

  it('admin은 사실상 무제한(999)', () => {
    expect(resolvePortfolioLimit('admin')).toBe(999);
  });
});
