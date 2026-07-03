-- portfolio_diagnosis: 포트폴리오 진단 실행 기록 (마이페이지 사용 횟수 카운팅용)
-- app/api/portfolio-diagnosis, app/api/mypage 에서 참조하지만 테이블이 없어
-- insert/count가 항상 조용히 실패하고 있던 문제 수정
create table if not exists public.portfolio_diagnosis (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        references auth.users(id) on delete cascade,
  result     jsonb,
  created_at timestamptz default now()
);

alter table public.portfolio_diagnosis enable row level security;

create policy "본인 포트폴리오 진단만 조회" on public.portfolio_diagnosis
  for select using (auth.uid() = user_id);

create policy "본인 포트폴리오 진단만 생성" on public.portfolio_diagnosis
  for insert with check (auth.uid() = user_id);
