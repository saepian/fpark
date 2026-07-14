import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';
import { isStockAnalysisDaily } from '@/lib/plan';

// pricing 페이지와 welcome 페이지가 공유하는 플랜별 기능 문구.
// 숫자(일일/월간 한도)는 PLAN_USAGE_LIMITS에서 그대로 끌어와, 한도가 바뀌어도
// 문구가 따로 어긋나지 않게 한다 — diagnosis 한도가 pricing 광고와 어긋났던
// 과거 버그(lib/plan.ts 참고)와 같은 종류의 드리프트를 막기 위함.

export type PlanType = 'free' | 'basic' | 'pro';

export interface PlanFeature { text: string; included: boolean }

export interface PlanFeatureSet {
  name: string;
  description: string;
  features: PlanFeature[];
}

const portfolioText = (monthlyLimit: number) =>
  monthlyLimit === 0 ? '포트폴리오 분석' : `포트폴리오 분석 월 ${monthlyLimit}회`;

// 2026-07-15 정정: 종목분석은 무료 등급만 예외적으로 "일간" 한도(하루 1회) —
// 나머지(베이직/프로)는 월간이라 isStockAnalysisDaily로 분기한다.
const stockAnalysisText = (plan: PlanType) =>
  isStockAnalysisDaily(plan)
    ? `종목 분석 일 ${PLAN_USAGE_LIMITS[plan].stockAnalysis}회`
    : `종목 분석 월 ${PLAN_USAGE_LIMITS[plan].stockAnalysis}회`;

export const PLAN_FEATURES: Record<PlanType, PlanFeatureSet> = {
  free: {
    name: 'FREE',
    description: '기업 데이터 분석을 처음 시작하는 분들을 위한 플랜',
    features: [
      { text: stockAnalysisText('free'), included: true },
      { text: `기업 분석 월 ${PLAN_USAGE_LIMITS.free.diagnosis}회`, included: true },
      { text: portfolioText(PLAN_USAGE_LIMITS.free.portfolio), included: PLAN_USAGE_LIMITS.free.portfolio > 0 },
      { text: '뉴스/시장 데이터 무제한', included: true },
      { text: '워치리스트', included: true },
      { text: '관심기업 주가 알림 (±5%, ±10%, ±20%, ±30%)', included: false },
      { text: '외국인/기관 수급 알림 (1,000억 이상 자금 유입·유출)', included: false },
      { text: '관심기업 일일 리포트 이메일 (AI 분석 포함)', included: false },
    ],
  },
  basic: {
    name: 'BASIC',
    description: '더 많은 분석이 필요한 이용자를 위한 플랜',
    features: [
      { text: stockAnalysisText('basic'), included: true },
      { text: `기업 분석 월 ${PLAN_USAGE_LIMITS.basic.diagnosis}회`, included: true },
      { text: portfolioText(PLAN_USAGE_LIMITS.basic.portfolio), included: PLAN_USAGE_LIMITS.basic.portfolio > 0 },
      { text: '뉴스/시장 데이터 무제한', included: true },
      { text: '워치리스트', included: true },
      { text: '관심기업 주가 알림 (±5%, ±10%, ±20%, ±30%)', included: false },
      { text: '외국인/기관 수급 알림 (1,000억 이상 자금 유입·유출)', included: false },
      { text: '관심기업 일일 리포트 이메일 (AI 분석 포함)', included: false },
    ],
  },
  pro: {
    name: 'PRO',
    description: '전문적인 포트폴리오 관리가 필요한 이용자',
    features: [
      { text: stockAnalysisText('pro'), included: true },
      { text: `기업 분석 월 ${PLAN_USAGE_LIMITS.pro.diagnosis}회`, included: true },
      { text: portfolioText(PLAN_USAGE_LIMITS.pro.portfolio), included: PLAN_USAGE_LIMITS.pro.portfolio > 0 },
      { text: '뉴스/시장 데이터 무제한', included: true },
      { text: '워치리스트', included: true },
      { text: '관심기업 주가 알림 (±5%, ±10%, ±20%, ±30%)', included: true },
      { text: '외국인/기관 수급 알림 (1,000억 이상 자금 유입·유출)', included: true },
      { text: '관심기업 일일 리포트 이메일 (AI 분석 포함)', included: true },
    ],
  },
};
