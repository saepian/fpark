-- ════════════════════════════════════════════════════════════════════════
-- stock_diagnosis.report_date: 기업분석(진단) 히스토리 비교용 날짜 컬럼
--
-- 배경: 기업분석 페이지("어제 대비" 개념 부재)를 종목 리포트와 동일한 원칙으로
--       재설계하면서, 직전 진단 대비 평가손익/수급/주가 변화를 보여주려면 날짜
--       기준 조회가 필요하다. stock_diagnosis는 이미 진단마다 새 row를 쌓는
--       히스토리 테이블이므로 새 테이블 대신 이 컬럼만 추가해 재사용한다
--       (2026-07-13 기업분석 재설계). created_at은 있지만 KST 날짜 단위 비교에
--       매번 타임존 변환이 필요해 report_date(date, KST 기준)를 별도로 둔다.
--       하루 여러 번 진단을 허용하는 기존 동작은 유지하므로 unique 제약은 걸지
--       않는다 — 직전 리포트 조회는 "report_date < 오늘 중 가장 최근 1건"으로 한다.
-- ════════════════════════════════════════════════════════════════════════

-- 1단계: 컬럼 추가
alter table public.stock_diagnosis
  add column if not exists report_date date;

-- 2단계: 기존 row 백필 (created_at → KST 날짜)
update public.stock_diagnosis
set report_date = (created_at at time zone 'Asia/Seoul')::date
where report_date is null;

-- 3단계: 직전 리포트 조회용 인덱스
create index if not exists stock_diagnosis_user_ticker_date_idx
  on public.stock_diagnosis (user_id, ticker, report_date desc);
