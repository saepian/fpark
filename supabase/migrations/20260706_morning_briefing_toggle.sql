-- 아침 뉴스 브리핑 수신 여부를 저녁 리포트(email_alert_enabled)와 별도로 관리하기 위한 컬럼.
-- 기존 email_alert_enabled는 이제 "장 마감 후 분석 리포트" 전용으로 의미를 한정한다.
-- NOT NULL + DEFAULT true 조합이라 기존 행에도 자동으로 true가 채워진다 (신규/기존 유저 모두 기본 수신).
alter table public.users
  add column if not exists morning_briefing_enabled boolean not null default true;
