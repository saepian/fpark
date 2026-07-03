-- 1. users 테이블: 이메일 수신 동의 컬럼 추가
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. 이메일 발송 로그 테이블
CREATE TABLE IF NOT EXISTS public.email_send_logs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stock_count         INTEGER     NOT NULL DEFAULT 0,
  notification_count  INTEGER     NOT NULL DEFAULT 0,
  ai_comment          TEXT,
  status              TEXT        NOT NULL DEFAULT 'sent'  -- 'sent' | 'failed'
);

CREATE INDEX IF NOT EXISTS email_send_logs_user_id_idx ON public.email_send_logs (user_id);
CREATE INDEX IF NOT EXISTS email_send_logs_sent_at_idx  ON public.email_send_logs (sent_at DESC);
