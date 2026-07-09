// Basic → Pro 업그레이드 크레딧 계산(lib/upgrade-credit.ts) 단위 테스트.
//
// 2026-07-09 실계정(saepian1@naver.com) 리포트: 구독 시작 3시간 만에 업그레이드 견적을
// 봤더니 10,000원(=19900-9900, 크레딧이 Basic 정가 전액)이 떴는데 기대값은 11,980원
// (=19900-7920, 7920은 "지금 취소하면 돌려받을 환불액")이었음. 순수 날짜비례 크레딧이
// "지금 취소했을 때의 환불액"보다 커질 수 있다는 게 문제로 확인되어, creditAmount에
// calculateRefund() 기반 상한을 씌우는 방식으로 수정. 아래 테스트는 그 상한이 실제로
// 걸리는 케이스와 안 걸리는 케이스를 모두 커버한다.

import { describe, it, expect } from 'vitest';
import { calculateUpgradeCredit, calculateUpgradeChargeAmount } from './upgrade-credit';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-07-09T00:00:00.000Z');

function daysFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * DAY_MS);
}

// 공통 파라미터 빌더 — 개별 테스트에서 필요한 값만 덮어쓴다.
function creditParams(overrides: Partial<Parameters<typeof calculateUpgradeCredit>[0]> = {}) {
  return {
    currentPlanMonthly:    9900,
    nextBilledAt:          daysFromNow(30),
    now:                   NOW,
    subscriptionStartDate: NOW,
    currentPlan:           'basic' as const,
    diagnosisCount:        0,
    portfolioCount:        0,
    ...overrides,
  };
}

describe('calculateUpgradeCredit — 상한 없이 날짜비례가 그대로 적용되는 경우(미사용)', () => {
  it('30일 남음 + 완전 미사용 → 환불 상한(9900원, 전액환불)과 날짜비례(9900원)가 같아 상한 안 걸림', () => {
    const result = calculateUpgradeCredit(creditParams({ nextBilledAt: daysFromNow(30) }));
    expect(result.remainingDays).toBe(30);
    expect(result.proratedCredit).toBe(9900);
    expect(result.refundCap).toBe(9900);
    expect(result.creditAmount).toBe(9900);
    expect(result.cappedByRefund).toBe(false);
    expect(result.refundWindowExpired).toBe(false);
  });

  it('3일 경과(27일 남음) + 완전 미사용 → 날짜비례와 환불 상한이 동일 공식이라 상한 안 걸림', () => {
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(27),
      subscriptionStartDate: daysFromNow(-3),
    }));
    expect(result.remainingDays).toBe(27);
    expect(result.proratedCredit).toBe(8910); // round(9900 * 27/30)
    expect(result.refundCap).toBe(8910);       // elapsedRatio=3/30=10%, 미사용이라 동일
    expect(result.creditAmount).toBe(8910);
    expect(result.cappedByRefund).toBe(false);
  });

  it('7일 경과(23일 남음) + 완전 미사용 → 환불 창구 마지막 날이라 두 공식이 정확히 일치', () => {
    // elapsedDays가 정확히 7일(REFUND_WINDOW_DAYS 경계값)이라 아직 환불 대상 — 날짜비례와
    // 환불 상한이 같은 공식(양쪽 다 9900*7/30을 쓰는 셈)이라 반올림까지 정확히 일치한다.
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(23),
      subscriptionStartDate: daysFromNow(-7),
    }));
    expect(result.remainingDays).toBe(23);
    expect(result.proratedCredit).toBe(7590); // round(9900 * 23/30)
    expect(result.refundCap).toBe(7590);      // 9900 - round(9900 * 7/30)
    expect(result.creditAmount).toBe(7590);
    expect(result.cappedByRefund).toBe(false);
  });
});

describe('calculateUpgradeCredit — 이용실적이 있어 환불 상한이 실제로 걸리는 경우', () => {
  it('실계정 리포트 시나리오 그대로: 0일 경과 + 포트폴리오 1회 사용 → 상한 7920원에 걸려 크레딧이 9900원이 아니라 7920원', () => {
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(30),
      subscriptionStartDate: NOW,
      portfolioCount: 1,
    }));
    expect(result.remainingDays).toBe(30);
    expect(result.proratedCredit).toBe(9900);  // 날짜비례만 보면 전액
    expect(result.refundCap).toBe(7920);       // 포트폴리오 1회 사용(계단식 20%) 반영된 실제 환불액
    expect(result.creditAmount).toBe(7920);    // 상한이 적용된 최종값
    expect(result.cappedByRefund).toBe(true);
  });

  it('기업분석을 많이 써서 이용실적 비율이 큰 경우도 상한이 걸림', () => {
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(30),
      subscriptionStartDate: NOW,
      diagnosisCount: 90, // limits.diagnosis(6) * 30 = 180 분모 기준 50%
    }));
    expect(result.proratedCredit).toBe(9900);
    expect(result.refundCap).toBe(4950); // 9900 - round(9900*0.5)
    expect(result.creditAmount).toBe(4950);
    expect(result.cappedByRefund).toBe(true);
  });

  it('결제일로부터 7일 초과 경과 → 환불 상한이 0원이 되어 잔여일수와 무관하게 크레딧도 0원', () => {
    // calculateRefund()의 "7일 초과 시 환불 대상 아님" 정책이 그대로 상한에 반영되는지 확인 —
    // 날짜비례로는 20일이나 남아 크레딧이 커 보이지만(6600원), 지금 취소해도 한 푼도 못
    // 돌려받는 시점이라 업그레이드 크레딧도 0원이 되는 게 "같은 기준" 원칙에 맞다.
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(20),
      subscriptionStartDate: daysFromNow(-10),
    }));
    expect(result.proratedCredit).toBe(6600); // round(9900 * 20/30)
    expect(result.refundCap).toBe(0);
    expect(result.creditAmount).toBe(0);
    expect(result.cappedByRefund).toBe(true);
    expect(result.refundWindowExpired).toBe(true); // 화면 안내 문구 표시 조건
  });
});

describe('calculateUpgradeCredit — 기존 날짜 clamp 동작 회귀 확인', () => {
  it('0일 남음(오늘이 결제일) → 크레딧 0원', () => {
    const result = calculateUpgradeCredit(creditParams({ nextBilledAt: daysFromNow(0) }));
    expect(result.remainingDays).toBe(0);
    expect(result.creditAmount).toBe(0);
  });

  it('이미 결제일이 지남(음수 일수) → 0으로 clamp, 음수 크레딧 없음', () => {
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(-5),
      subscriptionStartDate: daysFromNow(-35),
    }));
    expect(result.remainingDays).toBe(0);
    expect(result.creditAmount).toBe(0);
  });

  it('30일 초과(예: 데이터 이상치)해도 한 달치로 cap', () => {
    const result = calculateUpgradeCredit(creditParams({ nextBilledAt: daysFromNow(45) }));
    expect(result.remainingDays).toBe(30);
    expect(result.proratedCredit).toBe(9900);
    expect(result.creditAmount).toBe(9900); // 미사용이라 상한도 9900이라 안 걸림
  });
});

describe('calculateUpgradeChargeAmount', () => {
  it('실계정 리포트 시나리오: Basic(9900) → Pro(19900), 포트폴리오 1회 사용 → 청구액 11,980원', () => {
    const result = calculateUpgradeChargeAmount({
      currentPlanMonthly: 9900,
      targetPlanMonthly: 19900,
      nextBilledAt: daysFromNow(30),
      now: NOW,
      subscriptionStartDate: NOW,
      currentPlan: 'basic',
      diagnosisCount: 0,
      portfolioCount: 1,
    });
    expect(result.credit.creditAmount).toBe(7920);
    expect(result.chargeAmount).toBe(11980);
  });

  it('완전 미사용 + 30일 남음 → 청구액 = 19900 - 9900 = 10,000원(상한 안 걸리는 경우 회귀)', () => {
    const result = calculateUpgradeChargeAmount({
      currentPlanMonthly: 9900,
      targetPlanMonthly: 19900,
      nextBilledAt: daysFromNow(30),
      now: NOW,
      subscriptionStartDate: NOW,
      currentPlan: 'basic',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    expect(result.credit.cappedByRefund).toBe(false);
    expect(result.chargeAmount).toBe(10000);
  });

  it('크레딧이 목표 플랜 정가를 넘어도(인위적 케이스) 청구액은 0원 밑으로 안 내려감', () => {
    const result = calculateUpgradeChargeAmount({
      currentPlanMonthly: 25000,
      targetPlanMonthly: 19900,
      nextBilledAt: daysFromNow(30),
      now: NOW,
      subscriptionStartDate: NOW,
      currentPlan: 'basic',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    expect(result.chargeAmount).toBe(0);
  });
});
