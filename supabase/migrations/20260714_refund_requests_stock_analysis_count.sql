-- 2026-07-14 요금제 재구성으로 환불 이용률 계산에 종목분석이 추가되면서
-- refund_requests 감사 컬럼(20260711_refund_usage_ratio.sql)에도 원자료를 남긴다.

alter table public.refund_requests
  add column if not exists stock_analysis_count int not null default 0;
