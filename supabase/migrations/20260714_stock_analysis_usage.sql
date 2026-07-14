-- ════════════════════════════════════════════════════════════════════════
-- stock_analysis_usage: 종목분석(stock/[ticker]/analysis) 사용자별 월간 이용 기록
--
-- 배경: 종목분석은 지금까지 인증도 사용량 제한도 없었다(2026-07-14 요금제
--       재구성). stock_analysis_history는 (ticker, report_date) 단위로 전체
--       사용자가 콘텐츠를 공유하는 캐시 테이블이라 "이 사용자가 이번 달 몇 번
--       조회했는지"를 셀 수 없다 — 그래서 사용자 단위 이용 기록을 별도로 둔다.
--       (user_id, ticker, usage_date) unique 제약으로 같은 종목을 같은 날 여러
--       번 열람해도 1회로만 집계되게 한다(캐시 히트/미스와 무관).
--       stock_diagnosis와 동일하게 uuid PK 사용 — bigint identity 시퀀스
--       이슈(kis_tokens 사고) 자체를 회피.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.stock_analysis_usage (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  ticker text not null,
  usage_date date not null,  -- KST 기준 날짜 (kstDateStr()과 동일 값, 앱에서 계산해 넣음)
  created_at timestamptz default now(),
  unique (user_id, ticker, usage_date)
);

create index if not exists stock_analysis_usage_user_date_idx
  on public.stock_analysis_usage (user_id, usage_date);

alter table public.stock_analysis_usage enable row level security;

create policy "본인 이용기록만 조회" on public.stock_analysis_usage
  for select using (auth.uid() = user_id);

create policy "본인 이용기록만 생성" on public.stock_analysis_usage
  for insert with check (auth.uid() = user_id);
