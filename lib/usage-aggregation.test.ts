// app/api/admin/users/route.ts의 N+1(유저 1명당 count 쿼리 3개) 구조를 벌크 쿼리 3개 +
// JS 집계로 바꾸면서 추가한 테스트. 기존 per-user 쿼리(`.gte('created_at', cycleStart)`
// 등)와 동일한 경계 조건을 재현하는지가 핵심이라, 경계값(cycleStart 정확히 그 시각)과
// 사이클이 다른 유저가 섞여도 서로 오염되지 않는지를 중점적으로 검증한다.

import { describe, it, expect } from 'vitest';
import { aggregateUsageCounts, minCycleStart, type UsageAggregationUser } from './usage-aggregation';

// lib/plan.test.ts와 동일한 헬퍼 — 실행 머신 로컬 타임존과 무관하게 KST 오프셋을 명시.
function kst(y: number, m1: number, d: number, h = 0, min = 0): string {
  const mm = String(m1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const hh = String(h).padStart(2, '0');
  const mi = String(min).padStart(2, '0');
  return `${y}-${mm}-${dd}T${hh}:${mi}:00+09:00`;
}

describe('aggregateUsageCounts', () => {
  it('cycleStart 이전 로우는 제외, 이상(경계 포함)은 포함한다', () => {
    const now = new Date(kst(2026, 7, 14));
    const users: UsageAggregationUser[] = [
      { id: 'u1', plan: 'basic', subscriptionStartDate: kst(2026, 5, 10) }, // cycleStart = 2026-07-10 KST
    ];
    const diagnosisRows = [
      { user_id: 'u1', created_at: kst(2026, 7, 9, 23, 59) },  // 경계 직전 — 제외
      { user_id: 'u1', created_at: kst(2026, 7, 10, 0, 0) },   // 경계 정확히 — 포함
      { user_id: 'u1', created_at: kst(2026, 7, 12) },         // 포함
    ];
    const result = aggregateUsageCounts(users, diagnosisRows, [], [], now, '2026-07-14');
    expect(result.get('u1')?.diagnosisUsed).toBe(2);
  });

  it('무료 회원 종목분석은 사이클 전체가 아니라 오늘(KST) 날짜만 센다', () => {
    const now = new Date(kst(2026, 7, 14));
    const users: UsageAggregationUser[] = [
      { id: 'u1', plan: 'free', subscriptionStartDate: null },
    ];
    const stockAnalysisRows = [
      { user_id: 'u1', usage_date: '2026-07-01' }, // 이번 사이클(캘린더월) 안이지만 오늘 아님 — 제외
      { user_id: 'u1', usage_date: '2026-07-14' }, // 오늘 — 포함
    ];
    const result = aggregateUsageCounts(users, [], [], stockAnalysisRows, now, '2026-07-14');
    expect(result.get('u1')?.stockAnalysisUsed).toBe(1);
  });

  // 2026-08-03 버그 수정 회귀 테스트: cycleStart(Date, KST 자정을 나타내는 절대시각)를
  // usage_date(순수 KST 날짜 문자열)와 비교할 때 `cycleStart.toISOString().split('T')[0]`을
  // 그대로 쓰면 UTC로 변환되면서 하루 당겨진다(예: KST 7/1 00:00 → UTC로는 6/30 15:00 →
  // "6/30"). 예전엔 이 프로젝트의 프로덕션 코드가 이미 이 방식을 쓰고 있어(과다집계 버그)
  // N+1↔벌크 파리티를 위해 그대로 재현했었지만, 이제 kstDateStr()로 고쳐서 사이클 시작
  // 전날 사용분이 더 이상 포함되지 않아야 한다.
  it('베이직/프로 종목분석은 오늘이 아니라 사이클 누적으로 센다(사이클 시작 전날은 제외)', () => {
    const now = new Date(kst(2026, 7, 14));
    const users: UsageAggregationUser[] = [
      { id: 'u1', plan: 'pro', subscriptionStartDate: null }, // cycleStart = 2026-07-01 (캘린더월 폴백)
    ];
    const stockAnalysisRows = [
      { user_id: 'u1', usage_date: '2026-07-01' },
      { user_id: 'u1', usage_date: '2026-07-14' },
      { user_id: 'u1', usage_date: '2026-06-30' }, // 사이클 시작 전날 — 버그 수정 후엔 제외되어야 함
      { user_id: 'u1', usage_date: '2026-06-29' }, // 그 전날도 제외
    ];
    const result = aggregateUsageCounts(users, [], [], stockAnalysisRows, now, '2026-07-14');
    expect(result.get('u1')?.stockAnalysisUsed).toBe(2);
  });

  it('subscription_start_date가 null이면 캘린더월(매월 1일)로 폴백한다', () => {
    const now = new Date(kst(2026, 7, 14));
    const users: UsageAggregationUser[] = [
      { id: 'u1', plan: 'basic', subscriptionStartDate: null },
    ];
    const portfolioRows = [
      { user_id: 'u1', created_at: kst(2026, 6, 30) }, // 지난달 — 제외
      { user_id: 'u1', created_at: kst(2026, 7, 1) },  // 이번 달 1일 — 포함
    ];
    const result = aggregateUsageCounts(users, [], portfolioRows, [], now, '2026-07-14');
    expect(result.get('u1')?.portfolioUsed).toBe(1);
  });

  it('사이클이 서로 다른 유저들의 로우가 서로 섞이지 않는다', () => {
    const now = new Date(kst(2026, 7, 14));
    const users: UsageAggregationUser[] = [
      { id: 'u1', plan: 'basic', subscriptionStartDate: kst(2026, 5, 10) }, // cycleStart = 07-10
      { id: 'u2', plan: 'pro',   subscriptionStartDate: kst(2026, 5, 20) }, // cycleStart = 06-20 (이번달 20일 아직 안 지남 → 지난달)
    ];
    const diagnosisRows = [
      { user_id: 'u1', created_at: kst(2026, 7, 5) },  // u1 사이클(07-10) 이전 — 제외
      { user_id: 'u1', created_at: kst(2026, 7, 11) }, // 포함
      { user_id: 'u2', created_at: kst(2026, 7, 5) },  // u2 사이클(06-20) 이후 — 포함
      { user_id: 'u3', created_at: kst(2026, 7, 12) }, // users 목록에 없는 유저 — 무시되어야 함
    ];
    const result = aggregateUsageCounts(users, diagnosisRows, [], [], now, '2026-07-14');
    expect(result.get('u1')?.diagnosisUsed).toBe(1);
    expect(result.get('u2')?.diagnosisUsed).toBe(1);
    expect(result.has('u3')).toBe(false);
  });
});

describe('minCycleStart', () => {
  it('유저 전체 중 가장 이른 cycleStart를 반환한다', () => {
    const now = new Date(kst(2026, 7, 14));
    const users: UsageAggregationUser[] = [
      { id: 'u1', plan: 'basic', subscriptionStartDate: kst(2026, 5, 10) }, // cycleStart = 07-10
      { id: 'u2', plan: 'pro',   subscriptionStartDate: kst(2026, 5, 20) }, // cycleStart = 06-20
      { id: 'u3', plan: 'free',  subscriptionStartDate: null },             // cycleStart = 07-01 (캘린더월)
    ];
    const min = minCycleStart(users, now);
    expect(min).toEqual(new Date(kst(2026, 6, 20)));
  });

  it('유저가 없으면 now를 반환한다', () => {
    const now = new Date(kst(2026, 7, 14));
    expect(minCycleStart([], now)).toEqual(now);
  });
});
