import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';

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

// 기업분석(AI 종목 진단) 일일 한도 — admin은 무제한, 나머지는 PLAN_USAGE_LIMITS 그대로.
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
