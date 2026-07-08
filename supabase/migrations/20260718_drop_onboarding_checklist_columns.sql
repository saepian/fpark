-- 대시보드 온보딩 체크리스트(20260717_onboarding_checklist.sql) 기능을 폐기하고
-- 회원가입 직후 1회성 "웰컴 페이지"로 방향을 바꾸면서, 더 이상 쓰지 않는 컬럼 제거.
-- 실행은 Supabase 대시보드 SQL Editor에서 직접 할 것 — 이 파일은 준비만 해둔다.
alter table public.users
  drop column if exists onboarding_watchlist_added,
  drop column if exists onboarding_report_viewed,
  drop column if exists onboarding_alert_enabled,
  drop column if exists onboarding_dismissed;
