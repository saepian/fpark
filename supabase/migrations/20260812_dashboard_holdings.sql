-- ════════════════════════════════════════════════════════════════════════
-- dashboard_holdings / dashboard_analysis: 신규 "대시보드" 메뉴용 테이블 2종
--
-- 배경: 기존 watchlist(관심종목)는 매수가/매수일/수량 컬럼이 없고(가격 알림용),
--       portfolio_diagnosis는 진단마다 새 row를 쌓는 히스토리 로그라 (user_id,
--       report_date) unique 제약이 없다(재진단마다 새 row가 정상 동작) — 둘 다
--       "최초 1회 입력 후 계속 유지되는 보유종목 상태 + 당일 캐시 조회"라는
--       대시보드 요구사항에 맞지 않아 신규 테이블이 필요하다(2026-08-12 설계 검토).
--
-- dashboard_holdings: watchlist와 거의 동형이나 매수정보(avg_price/buy_date/
--   quantity) 컬럼이 추가된 독립 테이블 — 워치리스트 알림 로직과 뒤섞이지 않게 분리.
--
-- dashboard_analysis: stock_analysis_history와 동일한 "당일 캐시" 패턴 —
--   (user_id, report_date) unique로, 그날 첫 AI분석 클릭에서만 생성하고
--   이후 재클릭은 이 테이블에서 즉시 반환한다. 보유종목 변경 시 당일 캐시가
--   갱신되지 않는 트레이드오프는 감수(다음날 자동 해소).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.dashboard_holdings (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        references auth.users(id) on delete cascade,
  ticker     text        not null,
  name       text        not null,
  market     text        default 'kr',  -- 'kr' | 해외 시장 코드('us' 등, watchlist와 동일 컨벤션)
  avg_price  numeric     not null,
  buy_date   date,
  quantity   numeric     not null,
  created_at timestamptz default now()
);

create index if not exists dashboard_holdings_user_idx
  on public.dashboard_holdings (user_id);

alter table public.dashboard_holdings enable row level security;

create policy "본인 대시보드 보유종목만 조회" on public.dashboard_holdings
  for select using (auth.uid() = user_id);

create policy "본인 대시보드 보유종목만 생성" on public.dashboard_holdings
  for insert with check (auth.uid() = user_id);

create policy "본인 대시보드 보유종목만 삭제" on public.dashboard_holdings
  for delete using (auth.uid() = user_id);

create table if not exists public.dashboard_analysis (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade,
  report_date date        not null,  -- KST 기준 날짜 (kstDateStr()과 동일 값)
  result      jsonb,
  created_at  timestamptz default now(),
  unique (user_id, report_date)
);

alter table public.dashboard_analysis enable row level security;

create policy "본인 대시보드 분석만 조회" on public.dashboard_analysis
  for select using (auth.uid() = user_id);

create policy "본인 대시보드 분석만 생성" on public.dashboard_analysis
  for insert with check (auth.uid() = user_id);
