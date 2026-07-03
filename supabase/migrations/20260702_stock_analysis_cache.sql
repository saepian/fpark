-- ════════════════════════════════════════════════════════════════════════
-- stock_analysis: 국내/해외 종목 "FPARK AI" 카드의 당일 캐시 테이블
--
-- 배경: app/api/stock/[ticker]/analysis/route.ts(국내)와
--       app/api/stock/overseas/[ticker]/analysis/route.ts(해외) 둘 다
--       이 테이블에서 "같은 종목 + 오늘 생성분"을 조회해 재사용하려 하는데,
--       테이블이 없어서 매번 캐시 미스 → 요청마다 Claude를 새로 호출하고 있었음
--       (해외는 8~11초, 응답마다 비용 발생)
-- ════════════════════════════════════════════════════════════════════════

-- 1단계: 테이블 생성 — ticker를 기본키로 둬서 종목당 최신 1건만 유지 (upsert로 자동 갱신)
create table if not exists public.stock_analysis (
  ticker     text        primary key,  -- 국내: '005930', 해외: 'overseas_NVDA' 형태로 구분
  summary    text,                     -- 한줄 요약
  details    text,                     -- 전체 분석 결과 JSON 문자열
  keywords   text[],                   -- 태그 목록
  sentiment  text,                     -- bullish | bearish | neutral
  created_at timestamptz default now() -- 생성 시각 — "오늘 자정 이후"인지로 캐시 유효성 판단
);

-- 2단계: RLS 켜기 — 서비스 롤 키를 쓰는 서버 코드만 접근 가능해짐 (별도 정책 없음)
alter table public.stock_analysis enable row level security;
