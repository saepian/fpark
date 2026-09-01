// 2026-09-01 워치리스트 "불러오기" 속도 개선 — 시세 캐시를 IN 쿼리로 일괄 읽어 신선한 행만
// 즉시 쓰는 fetchStockPricesCached의 핵심 판정(selectFreshQuoteCacheRows)을 검증한다.
// 단건 경로(queryPriceCached)와 동일 규칙: TTL 이내 + "마감 전 생성분을 마감 후 처음 보면
// TTL 무관 무효"(2026-07-20 동시호가 잠정치 버그 대응).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({ adminClient: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { selectFreshQuoteCacheRows } from './kis-api';

const kst = (s: string) => new Date(`${s}+09:00`).toISOString(); // "2026-09-01T10:00:00" KST → ISO

describe('selectFreshQuoteCacheRows', () => {
  it('TTL 이내 행만 남긴다', () => {
    const now = new Date(kst('2026-09-01T10:00:00'));
    const rows = [
      { ticker: 'A', updatedAt: kst('2026-09-01T09:59:45') }, // 15초 전 — 장중 TTL(30초) 이내
      { ticker: 'B', updatedAt: kst('2026-09-01T09:59:20') }, // 40초 전 — 만료
    ];
    expect(selectFreshQuoteCacheRows(rows, now, 30_000).map(r => r.ticker)).toEqual(['A']);
  });

  it('장외 TTL(30분)이면 20분 전 행도 신선하다', () => {
    const now = new Date(kst('2026-09-01T20:00:00'));
    const rows = [{ ticker: 'A', updatedAt: kst('2026-09-01T19:40:00') }];
    expect(selectFreshQuoteCacheRows(rows, now, 30 * 60_000)).toHaveLength(1);
  });

  it('마감(15:30) 전에 만든 행을 마감 후 처음 보면 TTL 이내라도 버린다', () => {
    const now = new Date(kst('2026-09-01T15:31:00'));
    const rows = [
      { ticker: 'A', updatedAt: kst('2026-09-01T15:29:30') }, // 마감 직전 동시호가 잠정치
      { ticker: 'B', updatedAt: kst('2026-09-01T15:30:20') }, // 마감 후 생성 — 유효
    ];
    expect(selectFreshQuoteCacheRows(rows, now, 30 * 60_000).map(r => r.ticker)).toEqual(['B']);
  });

  it('빈 배열은 빈 배열', () => {
    expect(selectFreshQuoteCacheRows([], new Date(), 30_000)).toEqual([]);
  });
});
