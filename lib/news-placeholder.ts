// 뉴스 카드 썸네일 플레이스홀더 (2026-09-04 메인 뉴스 품질 개선 B-2).
// RSS에 이미지가 없으면 예전엔 국내/해외 모두 같은 캔들차트 unsplash 사진으로 폴백돼 메인 카드가 전부
// 똑같아 보였다. 외부 이미지 대신 카테고리별 그라데이션 플레이스홀더 2종씩(총 4종)을 기사 id로
// 결정적으로 골라 분산시킨다 — 네트워크 의존 없음, 레이아웃(썸네일 슬롯)은 그대로 유지.

// fetch-news가 예전에 image_url에 박아 넣던 폴백 URL — 이 값이면 "이미지 없음"으로 취급한다.
const LEGACY_FALLBACK_IDS = ['photo-1611974789855-9c2a0a7236a3', 'photo-1590283603385-17ffb3a7f29f', 'photo-1526304640581-d334cdbbf45e', 'photo-1560518883-ce09059eeffa'];

export function isLegacyFallbackImage(url: string | null | undefined): boolean {
  if (!url) return true;
  return LEGACY_FALLBACK_IDS.some((id) => url.includes(id));
}

export interface NewsPlaceholder {
  key: string;         // 스타일 키(테스트/스냅샷용)
  label: string;       // 슬롯 안에 표시할 짧은 라벨
  background: string;  // CSS background
}

const VARIANTS: Record<'domestic' | 'global' | 'other', NewsPlaceholder[]> = {
  domestic: [
    { key: 'domestic-a', label: '국내', background: 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)' },
    { key: 'domestic-b', label: '국내', background: 'linear-gradient(135deg, #7f1d1d 0%, #1f2937 100%)' },
  ],
  global: [
    { key: 'global-a', label: '해외', background: 'linear-gradient(135deg, #065f46 0%, #0f172a 100%)' },
    { key: 'global-b', label: '해외', background: 'linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)' },
  ],
  other: [
    { key: 'other-a', label: '경제', background: 'linear-gradient(135deg, #78350f 0%, #1c1917 100%)' },
    { key: 'other-b', label: '경제', background: 'linear-gradient(135deg, #334155 0%, #0f172a 100%)' },
  ],
};

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function pickNewsPlaceholder(category: string | null | undefined, seed: string): NewsPlaceholder {
  const group = category === 'domestic' || category === '국내주식' || category === '경제' ? 'domestic'
    : category === 'global' || category === '해외주식' || category === '글로벌' ? 'global'
    : 'other';
  const list = VARIANTS[group];
  return list[hashString(seed) % list.length];
}
