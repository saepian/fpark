-- 신규 가입자 온보딩 체크리스트: 대시보드에서 관심종목 추가·AI 진단 리포트 조회·알림 켜기를
-- 유도하기 위해 진행 상태를 users 테이블에 명시적 플래그로 기록한다. 커뮤니티 홍보로 수백명이
-- 동시에 유입될 상황을 대비한 사전 작업 — 가입 직후 이탈을 줄이기 위한 목적.
-- 노출 조건(가입 7일 이내 + onboarding_dismissed=false)은 애플리케이션(app/api/onboarding)에서
-- 판단하고, 여기서는 진행 상태만 저장한다. 각 플래그는 완료 후 재호출되어도 덮어쓰지 않도록
-- 훅에서 이미 true면 갱신을 건너뛴다(app/api/watchlist, app/api/diagnosis, app/api/mypage 참고).
alter table public.users
  add column if not exists onboarding_watchlist_added boolean not null default false,
  add column if not exists onboarding_report_viewed   boolean not null default false,
  add column if not exists onboarding_alert_enabled    boolean not null default false,
  add column if not exists onboarding_dismissed        boolean not null default false;
