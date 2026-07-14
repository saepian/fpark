// Basic → Pro 업그레이드 크레딧 계산(lib/upgrade-credit.ts) 단위 테스트.
//
// 2026-07-09 실계정(saepian1@naver.com) 리포트: 구독 시작 3시간 만에 업그레이드 견적을
// 봤더니 10,000원(=19900-9900, 크레딧이 Basic 정가 전액)이 떴는데 기대값은 11,980원
// (=19900-7920, 7920은 "지금 취소하면 돌려받을 환불액")이었음. 순수 날짜비례 크레딧이
// "지금 취소했을 때의 환불액"보다 커질 수 있다는 게 문제로 확인되어, creditAmount에
// 이용률 기반 상한을 씌우는 방식으로 수정했다.
//
// 2026-07-14 추가 수정: 그 상한을 calculateRefund()에서 그대로 가져오면서 "7일 초과 시
// 환불 대상 아님(환불 0원)" 게이트까지 같이 들어왔는데, 이 게이트는 최초 가입 청약철회
// 정책이라 매달 반복 적용되면 안 된다 — subscription_start_date는 매달 갱신 때 안 바뀌므로
// 예전 로직대로면 가입 7일 지난 뒤 업그레이드하는 거의 모든 구독자가 크레딧 0원을 받는
// 버그가 있었다. 이제는 calculateUsageRatio()로 순수 이용률 상한만 적용하고,
// subscriptionStartDate 파라미터 자체를 없앴다(호출부가 이번 결제 사이클 카운트를 직접
// 계산해서 diagnosisCount/portfolioCount/stockAnalysisCount로 넘긴다).

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
    currentPlanMonthly: 9900,
    nextBilledAt:       daysFromNow(30),
    now:                NOW,
    currentPlan:        'basic' as const,
    diagnosisCount:     0,
    portfolioCount:     0,
    stockAnalysisCount: 0,
    ...overrides,
  };
}

describe('calculateUpgradeCredit — 상한 없이 날짜비례가 그대로 적용되는 경우(미사용)', () => {
  it('30일 남음 + 완전 미사용 → 이용률 0%라 상한 안 걸리고 날짜비례(9900원) 그대로', () => {
    const result = calculateUpgradeCredit(creditParams({ nextBilledAt: daysFromNow(30) }));
    expect(result.remainingDays).toBe(30);
    expect(result.proratedCredit).toBe(9900);
    expect(result.usageRatio).toBe(0);
    expect(result.usageCap).toBe(9900);
    expect(result.creditAmount).toBe(9900);
    expect(result.cappedByUsage).toBe(false);
  });

  it('3일 경과(27일 남음) + 완전 미사용 → 이용률 0%라 상한 안 걸림', () => {
    const result = calculateUpgradeCredit(creditParams({ nextBilledAt: daysFromNow(27) }));
    expect(result.remainingDays).toBe(27);
    expect(result.proratedCredit).toBe(8910); // round(9900 * 27/30)
    expect(result.usageCap).toBe(9900);
    expect(result.creditAmount).toBe(8910);
    expect(result.cappedByUsage).toBe(false);
  });
});

describe('calculateUpgradeCredit — 이용실적이 있어 이용률 상한이 실제로 걸리는 경우', () => {
  it('실계정 리포트 시나리오 그대로: 포트폴리오 1회 사용(계단식 20%) → 상한 7920원에 걸려 크레딧이 9900원이 아니라 7920원', () => {
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(30),
      portfolioCount: 1,
    }));
    expect(result.remainingDays).toBe(30);
    expect(result.proratedCredit).toBe(9900);  // 날짜비례만 보면 전액
    expect(result.usageRatio).toBe(0.2);
    expect(result.usageCap).toBe(7920);        // round(9900 * (1-0.2))
    expect(result.creditAmount).toBe(7920);
    expect(result.cappedByUsage).toBe(true);
  });

  it('기업분석을 많이 써서 이용실적 비율이 큰 경우도 상한이 걸림', () => {
    // basic 월간한도 30회, 15건 사용 → 50%
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(30),
      diagnosisCount: 15,
    }));
    expect(result.usageRatio).toBe(0.5);
    expect(result.usageCap).toBe(4950); // round(9900 * 0.5)
    expect(result.creditAmount).toBe(4950);
    expect(result.cappedByUsage).toBe(true);
  });

  it('종목분석 이용실적이 커도 상한에 반영됨(2026-07-14 신규 콘텐츠)', () => {
    // basic 월간한도 50회, 25건 사용 → 50%
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(30),
      stockAnalysisCount: 25,
    }));
    expect(result.usageRatio).toBe(0.5);
    expect(result.creditAmount).toBe(4950);
  });

  it('가입 7일 초과 후 업그레이드해도 이용률이 낮으면 크레딧이 0원이 되지 않음 (2026-07-14 버그 회귀 방지)', () => {
    // 예전 버그: calculateRefund()의 "7일 초과 시 환불 0원" 게이트가 그대로 상한에
    // 반영돼, subscription_start_date가 오래된(매달 갱신 시 안 바뀌므로) 장기 구독자는
    // 이용률과 무관하게 크레딧이 무조건 0원이었다. 이제 subscriptionStartDate 파라미터
    // 자체가 없으므로 그 게이트가 애초에 적용될 수 없다 — 순수 이용률(0%)만으로 계산되어
    // 날짜비례 크레딧이 그대로 적용돼야 한다.
    const result = calculateUpgradeCredit(creditParams({
      nextBilledAt: daysFromNow(20), // 가입한 지 오래돼 결제 사이클 20일 남음
    }));
    expect(result.usageRatio).toBe(0);
    expect(result.creditAmount).toBe(6600); // round(9900 * 20/30), 0원이 아님
  });
});

describe('calculateUpgradeCredit — 기존 날짜 clamp 동작 회귀 확인', () => {
  it('0일 남음(오늘이 결제일) → 크레딧 0원', () => {
    const result = calculateUpgradeCredit(creditParams({ nextBilledAt: daysFromNow(0) }));
    expect(result.remainingDays).toBe(0);
    expect(result.creditAmount).toBe(0);
  });

  it('이미 결제일이 지남(음수 일수) → 0으로 clamp, 음수 크레딧 없음', () => {
    const result = calculateUpgradeCredit(creditParams({ nextBilledAt: daysFromNow(-5) }));
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
      currentPlan: 'basic',
      diagnosisCount: 0,
      portfolioCount: 1,
      stockAnalysisCount: 0,
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
      currentPlan: 'basic',
      diagnosisCount: 0,
      portfolioCount: 0,
      stockAnalysisCount: 0,
    });
    expect(result.credit.cappedByUsage).toBe(false);
    expect(result.chargeAmount).toBe(10000);
  });

  it('크레딧이 목표 플랜 정가를 넘어도(인위적 케이스) 청구액은 0원 밑으로 안 내려감', () => {
    const result = calculateUpgradeChargeAmount({
      currentPlanMonthly: 25000,
      targetPlanMonthly: 19900,
      nextBilledAt: daysFromNow(30),
      now: NOW,
      currentPlan: 'basic',
      diagnosisCount: 0,
      portfolioCount: 0,
      stockAnalysisCount: 0,
    });
    expect(result.chargeAmount).toBe(0);
  });
});
