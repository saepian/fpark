// 환불 계산(lib/refund.ts) 회귀 테스트.
// 이 로직은 실제 돈이 오가는 민감한 비즈니스 규칙이고, 커밋 이력상 이미 두 번
// 버그가 있었다(73b26d3 하이브리드 계산 도입 전 "결제 당일 전액환불" 허점,
// b862c90 이전 연간결제가 월간 비율식을 잘못 재사용하던 문제) — 같은 종류의
// 버그가 재발하지 않도록 그 시나리오를 명시적으로 커버한다.

import { describe, it, expect } from 'vitest';
import { calculateRefund, calculateAnnualRefund } from './refund';

const DAY_MS = 86_400_000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

describe('calculateRefund (월간결제)', () => {
  it('0일 경과 + 미사용 → 전액환불(구독 시작 당일 100% 환불)', () => {
    const result = calculateRefund({
      paidAmount: 19900,
      subscriptionStartDate: daysAgo(0),
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    expect(result.refundEligible).toBe(true);
    expect(result.refundAmount).toBe(19900);
  });

  it('경과일 비율이 이용실적 비율보다 큰 경우 → 경과일 비율로 차감', () => {
    const result = calculateRefund({
      paidAmount: 19900,
      subscriptionStartDate: daysAgo(5),
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    // elapsedRatio = 5/30 ≈ 16.67% > usageRatio(0%)
    expect(result.refundAmount).toBe(16583); // 19900 - round(19900 * 5/30)
  });

  it('이용실적 비율이 경과일 비율보다 큰 경우 → 이용실적 비율로 차감 (결제 당일 사용 후 전액환불 버그 회귀 방지)', () => {
    // 73b26d3 이전 버그: elapsedDays=0이면 사용 여부와 무관하게 무조건 전액환불이었음.
    // 지금은 0일째에 포트폴리오 분석을 2건 써도(usageRatio = 2/20 = 10%) 그만큼 차감돼야 한다.
    const result = calculateRefund({
      paidAmount: 19900,
      subscriptionStartDate: daysAgo(0),
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 2,
    });
    expect(result.refundAmount).toBeLessThan(19900);
    expect(result.refundAmount).toBe(17910); // 19900 - round(19900 * 0.1)
  });

  it('7일 초과 → 환불 대상 아님(해지예약), 환불액 0원', () => {
    const result = calculateRefund({
      paidAmount: 19900,
      subscriptionStartDate: daysAgo(8),
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    expect(result.refundEligible).toBe(false);
    expect(result.refundAmount).toBe(0);
  });

  it('이용량이 한도를 크게 초과해도 환불액이 음수가 되지 않고 0으로 clamp됨', () => {
    const result = calculateRefund({
      paidAmount: 19900,
      subscriptionStartDate: daysAgo(0),
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 100, // 월간 한도(20)를 5배 초과
    });
    expect(result.refundAmount).toBe(0);
    expect(result.refundAmount).toBeGreaterThanOrEqual(0);
  });

  it('Basic 플랜도 동일한 하이브리드 로직 적용(플랜별 한도만 다름)', () => {
    const result = calculateRefund({
      paidAmount: 9900,
      subscriptionStartDate: daysAgo(3),
      cancelAt: new Date(),
      plan: 'basic',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    // elapsedRatio = 3/30 = 10%
    expect(result.refundAmount).toBe(8910); // 9900 - round(9900 * 0.1)
  });
});

describe('calculateAnnualRefund (연간결제 — 정가 소급 재계산)', () => {
  const PAID = 191040; // Pro 연간 결제액(20% 할인 적용가)
  const MONTHLY_FULL = 19900; // Pro 정가 월요금

  it('0일 경과 + 미사용 → 전액환불', () => {
    const result = calculateAnnualRefund({
      paidAmount: PAID,
      subscriptionStartDate: daysAgo(0),
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    expect(result.refundEligible).toBe(true);
    expect(result.refundAmount).toBe(PAID);
    expect(result.monthsUsed).toBe(0);
  });

  it('1개월 사용 후 환불 — 정가 1개월분 소급 차감', () => {
    const result = calculateAnnualRefund({
      paidAmount: PAID,
      subscriptionStartDate: daysAgo(3),
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 1, // 7일 이내라도 사용했으므로 미사용 전액환불 예외 대상 아님
    });
    expect(result.monthsUsed).toBe(1);
    expect(result.retroactiveCost).toBe(MONTHLY_FULL);
    expect(result.refundAmount).toBe(PAID - MONTHLY_FULL); // 171,140원
  });

  it('6개월 사용 후 환불 — 정가 6개월분 소급 재계산 검증(20% 할인 소급 취소)', () => {
    const result = calculateAnnualRefund({
      paidAmount: PAID,
      subscriptionStartDate: daysAgo(165), // 165/30 = 5.5 → 올림 6개월
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    expect(result.monthsUsed).toBe(6);
    expect(result.retroactiveCost).toBe(6 * MONTHLY_FULL); // 119,400원
    expect(result.refundAmount).toBe(PAID - 6 * MONTHLY_FULL); // 71,640원
  });

  it('11개월 사용 후 환불 — 만료 직전 엣지 케이스, 정가 소급액이 결제액을 넘어 환불 0원(음수 아님)', () => {
    const result = calculateAnnualRefund({
      paidAmount: PAID,
      subscriptionStartDate: daysAgo(310), // 310/30 = 10.33 → 올림 11개월
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    expect(result.monthsUsed).toBe(11);
    expect(result.retroactiveCost).toBe(11 * MONTHLY_FULL); // 218,900원 — 이미 결제액(191,040) 초과
    expect(result.refundAmount).toBe(0);
    expect(result.refundAmount).toBeGreaterThanOrEqual(0);
  });

  it('12개월 초과 경과해도 소급 개월수는 12개월로 cap됨', () => {
    const result = calculateAnnualRefund({
      paidAmount: PAID,
      subscriptionStartDate: daysAgo(400), // 400/30 = 13.3 → cap 없으면 14개월
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    expect(result.monthsUsed).toBe(12);
    expect(result.retroactiveCost).toBe(12 * MONTHLY_FULL);
    expect(result.refundAmount).toBe(0);
  });

  it('8일 경과해도 월간결제와 달리 환불 불가/해지예약 하드컷오프가 적용되지 않음 (연간·월간 로직 혼용 회귀 방지)', () => {
    // b862c90 이전 버그: 연간결제도 월간용 calculateRefund()를 그대로 써서
    // 7일 초과 시 무조건 환불 0원 처리됐었다. 연간은 절대 그러면 안 된다.
    const result = calculateAnnualRefund({
      paidAmount: PAID,
      subscriptionStartDate: daysAgo(8),
      cancelAt: new Date(),
      plan: 'pro',
      diagnosisCount: 0,
      portfolioCount: 0,
    });
    expect(result.refundEligible).toBe(true);
    expect(result.refundAmount).toBe(PAID - MONTHLY_FULL); // 0원이 아니라 1개월분만 차감
    expect(result.refundAmount).toBeGreaterThan(0);
  });
});
