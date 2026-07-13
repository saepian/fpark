-- ════════════════════════════════════════════════════════════════════════
-- portfolio_diagnosis.report_date: 포트폴리오 분석 히스토리 비교용 날짜 컬럼
--
-- 배경: 기업분석(stock_diagnosis)과 동일한 이유 — 포트폴리오 분석도 진단마다
--       새 row를 쌓는 히스토리 테이블이지만 날짜 단위 조회 컬럼이 없어
--       "직전 진단 대비" 비교가 불가능했다(2026-07-13 포트폴리오 분석
--       재설계). created_at은 있지만 KST 날짜 단위 비교에 매번 타임존
--       변환이 필요해 report_date(date, KST 기준)를 별도로 둔다. 월간
--       사용 한도(getBillingCycleStart)와는 별개 개념이라 unique 제약은
--       걸지 않는다 — 직전 진단 조회는 "report_date < 오늘 중 가장 최근
--       1건"으로 한다.
-- ════════════════════════════════════════════════════════════════════════

-- 1단계: 컬럼 추가
alter table public.portfolio_diagnosis
  add column if not exists report_date date;

-- 2단계: 기존 row 백필 (created_at → KST 날짜)
update public.portfolio_diagnosis
set report_date = (created_at at time zone 'Asia/Seoul')::date
where report_date is null;

-- 3단계: 직전 진단 조회용 인덱스
create index if not exists portfolio_diagnosis_user_date_idx
  on public.portfolio_diagnosis (user_id, report_date desc);
