// 2026-08-03: 종목분석/기업분석 화면의 카드·섹션 제목 폰트 크기가 파일마다 제각각
// (10px/12px/14px 혼재)이라 "기간별 등락률"(PriceChangeTable.tsx) 기준으로 통일.
// 색상·대문자·자간(tracking)·여백은 섹션마다 다르므로 여기 포함하지 않고, 사용하는
// 곳에서 이 값 뒤에 이어붙인다 — 새 섹션을 추가할 때도 이 상수를 재사용할 것.
export const SECTION_TITLE_CLASS = 'text-xs font-bold';
