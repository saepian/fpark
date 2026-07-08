// 2026-07-08 발견: app/api/diagnosis/route.ts가 관리자 제외 전원을 하루 1회로 하드코딩해
// pricing 광고(Free 1회/Basic 6회/Pro 11회)와 불일치하던 버그의 회귀 테스트.
// resolveDiagnosisLimit()이 PLAN_USAGE_LIMITS(lib/payment-constants.ts)를 그대로
// 반영하는지 고정해서, 둘 중 하나만 바뀌고 다른 하나는 안 바뀌는 재발을 막는다.

import { describe, it, expect } from 'vitest';
import { resolveDiagnosisLimit } from './plan';

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
