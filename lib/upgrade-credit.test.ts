// Basic → Pro 업그레이드 크레딧 계산(lib/upgrade-credit.ts) 단위 테스트.
// 순수 날짜 비례 계산 — lib/refund.ts의 7일 컷오프/이용실적 비율과 완전히 무관함을
// 이 파일 자체로 보장한다(계산에 diagnosisCount/portfolioCount 인자가 아예 없음).

import { describe, it, expect } from 'vitest';
import { calculateUpgradeCredit, calculateUpgradeChargeAmount } from './upgrade-credit';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-07-09T00:00:00.000Z');

function daysFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * DAY_MS);
}

describe('calculateUpgradeCredit', () => {
  it('30일 남음 → 크레딧 100% (한 달 정가 전체)', () => {
    const result = calculateUpgradeCredit({
      currentPlanMonthly: 9900,
      nextBilledAt: daysFromNow(30),
      now: NOW,
    });
    expect(result.remainingDays).toBe(30);
    expect(result.creditRatio).toBe(1);
    expect(result.creditAmount).toBe(9900);
  });

  it('15일 남음 → 크레딧 50%', () => {
    const result = calculateUpgradeCredit({
      currentPlanMonthly: 9900,
      nextBilledAt: daysFromNow(15),
      now: NOW,
    });
    expect(result.remainingDays).toBe(15);
    expect(result.creditRatio).toBe(0.5);
    expect(result.creditAmount).toBe(4950);
  });

  it('8일 남음 → 실제 유저 리포트 시나리오 대입(9900원 → 크레딧 2640원)', () => {
    const result = calculateUpgradeCredit({
      currentPlanMonthly: 9900,
      nextBilledAt: daysFromNow(8),
      now: NOW,
    });
    expect(result.remainingDays).toBe(8);
    expect(result.creditAmount).toBe(2640); // round(9900 * 8/30)
  });

  it('0일 남음(오늘이 결제일) → 크레딧 0원', () => {
    const result = calculateUpgradeCredit({
      currentPlanMonthly: 9900,
      nextBilledAt: daysFromNow(0),
      now: NOW,
    });
    expect(result.remainingDays).toBe(0);
    expect(result.creditAmount).toBe(0);
  });

  it('이미 결제일이 지남(음수 일수) → 0으로 clamp, 음수 크레딧 없음', () => {
    const result = calculateUpgradeCredit({
      currentPlanMonthly: 9900,
      nextBilledAt: daysFromNow(-5),
      now: NOW,
    });
    expect(result.remainingDays).toBe(0);
    expect(result.creditRatio).toBe(0);
    expect(result.creditAmount).toBe(0);
  });

  it('30일 초과(예: 데이터 이상치)해도 한 달치로 cap', () => {
    const result = calculateUpgradeCredit({
      currentPlanMonthly: 9900,
      nextBilledAt: daysFromNow(45),
      now: NOW,
    });
    expect(result.remainingDays).toBe(30);
    expect(result.creditAmount).toBe(9900);
  });
});

describe('calculateUpgradeChargeAmount', () => {
  it('Basic(9900) → Pro(19900), 8일 남음 → 청구액 = 19900 - 2640 = 17260원', () => {
    const result = calculateUpgradeChargeAmount({
      currentPlanMonthly: 9900,
      targetPlanMonthly: 19900,
      nextBilledAt: daysFromNow(8),
      now: NOW,
    });
    expect(result.credit.creditAmount).toBe(2640);
    expect(result.chargeAmount).toBe(17260);
  });

  it('크레딧이 목표 플랜 정가를 넘을 일은 없지만(Pro가 항상 더 비쌈) 방어적으로 0원 밑으로 안 내려감', () => {
    // Pro보다 비싼 currentPlanMonthly를 인위적으로 넣어 하한 clamp를 검증
    const result = calculateUpgradeChargeAmount({
      currentPlanMonthly: 25000,
      targetPlanMonthly: 19900,
      nextBilledAt: daysFromNow(30),
      now: NOW,
    });
    expect(result.chargeAmount).toBe(0);
  });

  it('30일 남음(막 결제 직후 업그레이드) → 청구액 = 19900 - 9900 = 10000원', () => {
    const result = calculateUpgradeChargeAmount({
      currentPlanMonthly: 9900,
      targetPlanMonthly: 19900,
      nextBilledAt: daysFromNow(30),
      now: NOW,
    });
    expect(result.chargeAmount).toBe(10000);
  });
});
