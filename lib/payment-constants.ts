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

// 계좌이체(무통장입금) 수동 승인 방식 — 회사 명의 고정 계좌.
// 실제 값은 .env.local / Vercel 환경변수로 채워야 함 (client에서도 표시하므로 NEXT_PUBLIC_ 필요):
//   NEXT_PUBLIC_BANK_TRANSFER_BANK_NAME, NEXT_PUBLIC_BANK_TRANSFER_ACCOUNT_NUMBER,
//   NEXT_PUBLIC_BANK_TRANSFER_ACCOUNT_HOLDER
export const BANK_TRANSFER_ACCOUNT = {
  bankName:      process.env.NEXT_PUBLIC_BANK_TRANSFER_BANK_NAME ?? '',
  accountNumber: process.env.NEXT_PUBLIC_BANK_TRANSFER_ACCOUNT_NUMBER ?? '',
  accountHolder: process.env.NEXT_PUBLIC_BANK_TRANSFER_ACCOUNT_HOLDER ?? '',
};

// mypage 사용량 표시 + lib/refund.ts 환불 계산에서 공용으로 쓰는 플랜별 한도.
// 2026-07-14 요금제 재구성: 종목분석 신규 한도 추가, 기업분석 일일→월간 전환,
// 포트폴리오 숫자 갱신 — 기업분석·포트폴리오·종목분석(베이직/프로)은 월간 한도로 통일
// (subscription_start_date 기준 결제 사이클월, lib/plan.ts의 getUsageCycleStart 참고).
//
// 2026-07-15 정정: 종목분석의 무료 등급만 예외적으로 "일간" 한도(하루 1회)다 — 월간
// 한도로 두면 무료 회원이 하루에 몰아 써버릴 수 있어, "매일 최소 1회는 체험 가능"이라는
// 무료 취지에 맞게 free.stockAnalysis만 일간 카운트로 계산한다(lib/plan.ts의
// isStockAnalysisDaily 참고 — 베이직 50/프로 100은 그대로 월간).
export const PLAN_USAGE_LIMITS = {
  free:  { stockAnalysis: 1,   diagnosis: 5,  portfolio: 0  },
  basic: { stockAnalysis: 50,  diagnosis: 30, portfolio: 5  },
  pro:   { stockAnalysis: 100, diagnosis: 50, portfolio: 20 },
} as const;
