export const PLAN_AMOUNTS = {
  basic: { monthly: 9900,  annual: 95040,  name: 'Finance Park Basic' },
  pro:   { monthly: 19900, annual: 191040, name: 'Finance Park Pro'   },
} as const satisfies Record<string, { monthly: number; annual: number; name: string }>;

// verify/route.ts 에서 금액 검증 시 사용
export const PLAN_ALLOWED_AMOUNTS: Record<string, number[]> = {
  basic: [PLAN_AMOUNTS.basic.monthly, PLAN_AMOUNTS.basic.annual],
  pro:   [PLAN_AMOUNTS.pro.monthly,   PLAN_AMOUNTS.pro.annual],
};

export const ANNUAL_AMOUNTS = [PLAN_AMOUNTS.basic.annual, PLAN_AMOUNTS.pro.annual];
