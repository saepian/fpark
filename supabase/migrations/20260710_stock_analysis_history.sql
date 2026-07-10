-- ════════════════════════════════════════════════════════════════════════
-- stock_analysis_history: 종목 AI 리포트 하루 1건 히스토리 테이블
--
-- 배경: 기존 stock_analysis는 ticker를 기본키로 매번 upsert하는 구조라
--       히스토리가 전혀 없었고, 국내물 라우트(app/api/stock/[ticker]/analysis)는
--       당일 캐시조차 없어 방문할 때마다 재생성됐다 — "어제와 오늘 리포트를
--       비교"하는 기능이 구조적으로 불가능했다(2026-07-10 리포트 재설계).
--       이 테이블은 (ticker, report_date) unique 제약으로 종목당 하루 1건만
--       남기고, id는 kis_tokens 시퀀스 사고 재발 방지를 위해 identity로 만든다.
--       stock_analysis 테이블은 다른 소비자가 없음을 확인했으나 그대로 둔다
--       (드롭하지 않음 — 위험 없는 비활성 테이블로 남김).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.stock_analysis_history (
  id bigint generated always as identity primary key,
  ticker text not null,               -- 국내: '005930', 해외: 'overseas_NVDA' (기존 컨벤션 유지)
  report_date date not null,          -- KST 기준 날짜
  report_type text not null,          -- 'news-driven' | 'data-driven'
  headline text not null,
  main_analysis text not null,
  yesterday_delta text,
  risk_factor text,
  tags text[],
  current_price numeric,
  price_change_pct numeric,
  reference_metrics jsonb not null default '{}',
  internal_metrics jsonb not null default '{}',
  signal text,                        -- 내부 집계용, UI 비노출 (기존 stock_analysis 관행 유지)
  sentiment text,
  disclaimer text,
  created_at timestamptz not null default now(),
  unique (ticker, report_date)
);

create index if not exists stock_analysis_history_ticker_date_idx
  on public.stock_analysis_history (ticker, report_date desc);

alter table public.stock_analysis_history enable row level security;
-- 정책 없음 — service role 서버 코드만 접근 (기존 stock_analysis와 동일 관행)
