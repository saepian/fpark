-- market_cache: 시세 데이터(급등락 TOP, 순위) 폴백용 캐시
-- app/api/market/movers, app/api/market/ranking 에서 참조하지만 테이블이 없어 캐시 폴백이 항상 실패하던 문제 수정
CREATE TABLE IF NOT EXISTS public.market_cache (
  key        TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
