-- 2026-08-31 트래픽/부하 점검에서 발견: watchlist 테이블은 마이그레이션 이력에 CREATE
-- TABLE/INDEX가 없고(대시보드 초기에 수동 생성된 것으로 추정) 저장소 내 어떤 마이그레이션도
-- user_id 인덱스를 만들지 않는다. 그런데 이 테이블은
--   - /api/watchlist GET (홈 관심종목 위젯이 유저마다 주기 폴링)
--   - /api/cron/stock-alerts, daily-alert-email, morning-briefing (Pro 유저 전원 IN 조회)
-- 처럼 항상 user_id로 걸러 읽는 핫 테이블이다. 현재 17행이라 풀스캔이어도 티가 안
-- 나지만, 유저 수 × 종목 수(최대 15)로 선형 증가하면 매 폴링·매 크론 사이클마다 전체
-- 테이블을 훑게 되므로 지금 미리 붙여둔다. 이미 같은 인덱스(또는 (user_id, ...) 복합
-- PK)가 있다면 IF NOT EXISTS로 무해하게 지나간다.
--
-- 실행: Supabase SQL Editor에서 전문 실행 (service-role은 DDL 불가 — 이전 마이그레이션과 동일)

CREATE INDEX IF NOT EXISTS watchlist_user_id_idx
  ON public.watchlist (user_id);

-- dashboard_holdings는 20260812_dashboard_holdings.sql에서 이미 (user_id) 인덱스 보유 — 변경 없음.
