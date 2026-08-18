-- stock_master: 국내(KOSPI/KOSDAQ) 종목 검색용 자체 마스터 테이블
--
-- 배경: app/api/search가 지금까지 매 검색요청마다 kind.krx.co.kr(KRX 상장법인목록
-- 다운로드 페이지)을 실시간 스크래핑했는데, KRX가 Vercel 서버리스 IP를 403으로
-- 차단하기 시작해(2026-08-18 실측) 국내 종목 검색이 완전히 막혔다. KRX 스크래핑을
-- 매 요청이 아니라 크론(app/api/cron/stock-master-refresh)이 하루 1회만 수행해서
-- 이 테이블에 upsert해두고, 검색 API는 이 테이블만 읽도록 분리한다 — KRX가 다시
-- 막혀도 크론 그날 갱신만 건너뛰고 테이블에 있는 어제 데이터로 검색은 계속된다.
--
-- market_cache(키-값 JSONB 캐시)와 달리 종목명 부분검색이 목적이라 컬럼형 테이블로
-- 설계했다 — 전체가 3천건 이하라 인덱스 없이도 매 요청 전체 조회 후 앱 단에서
-- 필터링(app/api/search/route.ts의 기존 정규화/스코어링 로직 그대로 재사용)이면 충분하다.
create table if not exists public.stock_master (
  ticker     text        primary key,
  name       text        not null,
  market     text        not null check (market in ('KOSPI', 'KOSDAQ')),
  updated_at timestamptz not null default now()
);
