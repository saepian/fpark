// 카테고리 차트 팔레트 (2026-09-01 components/dashboard/DashboardCharts.tsx에서 분리) —
// dataviz 스킬 카테고리 팔레트(dark, adjacent-pair 검증 통과 순서). 대시보드 도넛(종목별
// 투자비중/산업군별 비중)과 포트폴리오분석 도넛(섹터 편중도/변동성 기여도)이 같은 색 순서를
// 써야 화면 간 일관성이 유지되므로 한 곳에서만 정의한다.
export const SLICE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const OTHER_COLOR = '#64748b';
export const MAX_DIRECT_SLICES = 7;

// 8색을 순환시키고(등록 한도 15개까지 최대 2바퀴) 반복될 때마다 살짝 옅게 만들어 구분을
// 돕는다 — 정확한 구분은 어차피 범례 텍스트가 담당.
export function sliceColorCycled(i: number): string {
  const base = SLICE_COLORS[i % SLICE_COLORS.length];
  const cycle = Math.floor(i / SLICE_COLORS.length);
  if (cycle === 0) return base;
  const alphaHex = Math.round(Math.max(0.55, 1 - cycle * 0.25) * 255).toString(16).padStart(2, '0');
  return `${base}${alphaHex}`;
}
