'use client';

import { useState } from 'react';

// 대시보드 차트(도넛/막대, 추후 라인 등)가 공유하는 진입 애니메이션 설정 — 체감
// 0.5~1초 내외로 통일하기 위한 공용 상수. 새 차트 추가 시 이 값을 그대로 재사용한다.
export const CHART_ANIMATION_DURATION_MS = 700;
export const CHART_ANIMATION_EASING = 'ease-out';

// 최초 마운트 시 1회만 재생하고, 이후 데이터가 갱신(5분 폴링 등)돼도 다시 재생하지
// 않도록 애니메이션 종료 시점에 스스로 꺼지는 recharts용 훅. 각 차트 컴포넌트가
// 자기 자신의 <Pie>/<Bar> 등에 스프레드해서 쓴다.
export function useChartEntranceAnimation() {
  const [active, setActive] = useState(true);
  return {
    isAnimationActive: active,
    animationDuration: CHART_ANIMATION_DURATION_MS,
    animationEasing: CHART_ANIMATION_EASING,
    onAnimationEnd: () => setActive(false),
  } as const;
}
