-- notifications 테이블에 is_active 컬럼 추가
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 기존 데이터 활성화 처리
UPDATE public.notifications SET is_active = true WHERE is_active IS NULL;

-- 활성 알림 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_notifications_active
  ON public.notifications (user_id, is_active)
  WHERE is_active = true;
