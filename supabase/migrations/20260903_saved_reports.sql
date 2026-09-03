-- ════════════════════════════════════════════════════════════════════════
-- saved_reports: 기업분석/포트폴리오분석 "저장" 기능
--
-- 원본 데이터를 복제하지 않고 stock_diagnosis/portfolio_diagnosis 행을
-- 참조만 한다(source_id) — 두 원본 테이블은 이미 영구 보관(청소 크론 없음)이라
-- 참조만으로 충분하고, JSON 복제로 인한 원본과의 불일치 위험도 없앤다.
--
-- 매일 자정(00시 KST) "오늘 하루 다시보기" 개념 — 물리 삭제는 하지 않고 조회
-- 시점에 saved_at이 오늘(KST)인 것만 필터링하는 게 1차 방어선(크론이 하루
-- 실패해도 항상 정확), notifications-cleanup 크론에 얹은 물리 삭제는 위생
-- 관리용 2차 방어선(테이블이 무한정 커지는 것 방지) — 2026-09-03 설계 확정.
-- ════════════════════════════════════════════════════════════════════════

create table public.saved_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  report_type text not null check (report_type in ('stock', 'portfolio')),
  source_id   uuid not null,  -- stock_diagnosis.id 또는 portfolio_diagnosis.id (report_type으로 구분)
  saved_at    timestamptz not null default now(),
  unique (user_id, report_type, source_id)
);

create index saved_reports_user_saved_at_idx on public.saved_reports (user_id, saved_at);

alter table public.saved_reports enable row level security;

create policy "본인 저장내역만 조회" on public.saved_reports
  for select using (auth.uid() = user_id);

create policy "본인 저장내역만 생성" on public.saved_reports
  for insert with check (auth.uid() = user_id);

create policy "본인 저장내역만 삭제" on public.saved_reports
  for delete using (auth.uid() = user_id);
