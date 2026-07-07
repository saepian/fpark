-- 환불 계산에 "경과일수" 외 "실제 이용량" 기준을 하이브리드로 추가하면서
-- 계산 상세를 감사 가능하도록 refund_requests에 원자료 컬럼 추가.
-- (refund_reason에 이미 사람이 읽는 요약 문자열이 저장되지만, 원본 수치를
-- 별도 컬럼으로 남겨야 나중에 계산식이 바뀌어도 과거 데이터를 재검증할 수 있다.)

alter table public.refund_requests
  add column if not exists diagnosis_count int not null default 0,
  add column if not exists portfolio_count int not null default 0,
  add column if not exists usage_ratio numeric not null default 0,
  add column if not exists elapsed_ratio numeric not null default 0,
  add column if not exists final_ratio numeric not null default 0;
