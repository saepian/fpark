-- uniq_notifications_active_daily를 partial index(WHERE is_active = true)에서
-- 일반 unique index로 변경 — Postgres는 partial unique index를 ON CONFLICT 대상으로
-- 쓰려면 ON CONFLICT 절에도 동일한 WHERE 조건을 명시해야 하는데, PostgREST/Supabase
-- upsert()는 이를 지원하지 않아 upsert가 항상 실패함.
-- is_active를 false로 바꾸는 로직이 현재 코드에 없어 이 변경은 안전함(항상 true로만 저장됨).
DROP INDEX IF EXISTS uniq_notifications_active_daily;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_active_daily
ON public.notifications (user_id, stock_code, type, threshold, notif_date);
