-- notifications 테이블 중복 방지 강화
-- 이전 migrations/notifications_is_active.sql과 중복 없이 실행 가능 (IF NOT EXISTS 사용)

-- 1. is_active 컬럼 (없을 경우 추가)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. notif_date: KST 기준 날짜 — 중복 방지 키에 사용
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS notif_date date;

-- 기존 행 backfill (KST 기준)
UPDATE public.notifications
SET notif_date = CAST((created_at AT TIME ZONE 'Asia/Seoul') AS date)
WHERE notif_date IS NULL;

-- 기본값 설정 후 NOT NULL 적용
ALTER TABLE public.notifications
  ALTER COLUMN notif_date SET DEFAULT CAST((NOW() AT TIME ZONE 'Asia/Seoul') AS date);

ALTER TABLE public.notifications
  ALTER COLUMN notif_date SET NOT NULL;

-- 3. 활성 알림 전용 중복 방지 인덱스
-- 같은 날(notif_date) 동일 조건(user_id, stock_code, type, threshold)은 is_active=true인 행 1개만 허용
-- is_active=false(비활성화)된 행은 인덱스에서 제외 → 조건 재충족 시 새 행 삽입 가능
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_active_daily
ON public.notifications (user_id, stock_code, type, threshold, notif_date)
WHERE is_active = true;

-- 4. 빠른 조회용 인덱스 (없을 경우 생성)
CREATE INDEX IF NOT EXISTS idx_notifications_active
ON public.notifications (user_id, is_active)
WHERE is_active = true;
