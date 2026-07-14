import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';
import { kstYearMonthDay, kstMidnight } from '@/lib/ai-grounding';

export type Plan = 'admin' | 'pro' | 'basic' | 'free';

// app/api/diagnosis, app/api/portfolio-diagnosis가 각자 복붙해서 쓰던 로직을 공용화.
// 복붙된 두 버전이 서로 다르게 어긋나는 패턴 때문에 diagnosis 쪽만 "관리자 제외 전원
// 하루 1회"로 하드코딩된 채 방치돼 pricing 광고(Basic 6회/Pro 11회)와 불일치하는 버그가
// 있었다(2026-07-08) — 앞으로 플랜 게이팅이 필요한 라우트는 전부 이 함수를 쓸 것.
// 관리자(ADMIN_EMAIL)는 users.plan 조회 없이 이메일만으로 즉시 판정.
export async function checkPlan(
  supabase: SupabaseClient<Database>,
  userId: string,
  email: string | undefined,
): Promise<Plan> {
  if (email === process.env.ADMIN_EMAIL) return 'admin';
  try {
    const { data } = await supabase.from('users').select('plan').eq('id', userId).maybeSingle();
    const plan = data?.plan;
    if (plan === 'pro')   return 'pro';
    if (plan === 'basic') return 'basic';
    return 'free';
  } catch { return 'free'; }
}

// 기업분석(AI 종목 진단) 월간 한도 — admin은 무제한, 나머지는 PLAN_USAGE_LIMITS 그대로.
// 2026-07-14까지는 일일 한도였으나 요금제 재구성으로 월간 전환(getUsageCycleStart 참고).
// 순수 함수로 분리해 DB 접근 없이 유닛 테스트 가능하게 함(lib/plan.test.ts).
export function resolveDiagnosisLimit(plan: Plan): number {
  if (plan === 'admin') return 999;
  return PLAN_USAGE_LIMITS[plan].diagnosis;
}

// 포트폴리오 분석 월간 한도 — admin은 무제한, 나머지는 PLAN_USAGE_LIMITS 그대로.
// app/api/portfolio-diagnosis/route.ts가 로컬 상수(MONTHLY_LIMIT/BASIC_MONTHLY_LIMIT)로
// 따로 들고 있던 것을 resolveDiagnosisLimit과 같은 패턴으로 공용화 — 이 값도 diagnosis처럼
// PLAN_USAGE_LIMITS와 어긋날 수 있는 하드코딩이라 같은 방식으로 고정해둔다.
export function resolvePortfolioLimit(plan: Plan): number {
  if (plan === 'admin') return 999;
  return PLAN_USAGE_LIMITS[plan].portfolio;
}

// 종목분석 한도 — 2026-07-14 신설(기존에는 제한 자체가 없었음). admin은 무제한,
// 나머지는 PLAN_USAGE_LIMITS 그대로(단, free는 일간·basic/pro는 월간 — isStockAnalysisDaily 참고).
export function resolveStockAnalysisLimit(plan: Plan): number {
  if (plan === 'admin') return 999;
  return PLAN_USAGE_LIMITS[plan].stockAnalysis;
}

// 종목분석 한도 주기 — 무료만 유일하게 "일간"(하루 1회), 베이직/프로/관리자는 월간.
// 2026-07-15 정정: 애초에 무료도 월간(30회)으로 설계했으나, 월간 한도로 두면 무료
// 회원이 하루에 몰아 써버릴 수 있어 "매일 최소 1회는 체험 가능"이라는 무료 취지에
// 맞게 free만 예외적으로 일간 카운트로 바꿨다.
export function isStockAnalysisDaily(plan: Plan): boolean {
  return plan === 'free';
}

// 월간 사용량 카운트의 "이번 사이클" 시작/다음 초기화 시점 계산 — 원래
// app/api/portfolio-diagnosis/route.ts(getBillingCycleStart)와 app/api/mypage/route.ts
// (getBillingCycle)에 거의 동일한 로직이 중복 정의돼 있던 것을 공용화(2026-07-14).
// subscription_start_date 기준으로 매달 같은 날짜에 리셋되고(말일은 클램핑), 구독이
// 없는 무료 회원 등 null인 경우는 캘린더월(매월 1일 KST 00:00)로 폴백한다.
//
// 2026-07-15 타임존 보정: 이전에는 .getDate()/.getMonth() 같은 서버 런타임 로컬
// 타임존(Vercel은 기본 UTC) 메서드로 날짜를 추출해, KST 00:00~08:59 사이에 가입한
// 사용자는 리셋일이 실제 KST 날짜와 최대 하루 어긋날 수 있었다. kstDateStr()과 동일한
// +9h 보정 방식(lib/ai-grounding.ts의 kstYearMonthDay/kstMidnight)으로 통일했다.
export function getUsageCycleStart(
  subscriptionStartDate: string | null,
  now: Date,
): { cycleStart: Date; nextCycleStart: Date } {
  const { year: ny, month: nm } = kstYearMonthDay(now);

  if (!subscriptionStartDate) {
    return {
      cycleStart:     kstMidnight(ny, nm, 1),
      nextCycleStart: kstMidnight(ny, nm + 1, 1),
    };
  }

  const { day: startDay } = kstYearMonthDay(new Date(subscriptionStartDate));

  // 말일 클램핑 (e.g., 1월 31일 → 2월 28일) — 그 달의 일수 자체는 타임존과 무관한
  // 순수 달력 사실이라 UTC 기준으로 계산해도 결과가 같다.
  const lastDayOfMonth = (yr: number, mo: number) => new Date(Date.UTC(yr, mo + 1, 0)).getUTCDate();

  const thisMonthStart = kstMidnight(ny, nm, Math.min(startDay, lastDayOfMonth(ny, nm)));
  if (thisMonthStart <= now) {
    return {
      cycleStart:     thisMonthStart,
      nextCycleStart: kstMidnight(ny, nm + 1, Math.min(startDay, lastDayOfMonth(ny, nm + 1))),
    };
  }
  return {
    cycleStart:     kstMidnight(ny, nm - 1, Math.min(startDay, lastDayOfMonth(ny, nm - 1))),
    nextCycleStart: thisMonthStart,
  };
}
