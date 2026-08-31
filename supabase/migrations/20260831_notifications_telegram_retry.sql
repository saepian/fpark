-- 2026-08-31 오후 긴급 조사에서 발견: 오전에 원자적 UPSERT로 재설계한 로직
-- (20260831_notifications_atomic_upsert.sql)이 "오늘 새로 발생한 알림인가"는
-- 정확히 판별하게 됐지만, 그 판단(is_new)을 그대로 "텔레그램을 보내야 하는가"의
-- 판단으로도 재사용하고 있었다 — 이 둘은 서로 다른 개념인데 하나로 취급된 것이
-- 근본 원인이다. INSERT가 한 번 성공해서 행이 생기고 나면(is_active=true), 그 뒤로는
-- 영원히 is_new=false이므로, 그 최초 삽입 시점에 텔레그램 발송이 실패했거나 아예
-- 시도되지 못했더라도 이후 어떤 사이클에서도 재시도할 방법이 없었다.
--
-- 실측: 오늘 아침 09:50:39(KST)에 생성된 6건(005930/foreign_sell,
-- 005930/institution_sell, 000660/foreign_sell, 000660/institution_sell,
-- 174900(앱클론)/price_down, 047040(대우건설)/price_down) — 이 중 앱클론·대우건설은
-- 오전에 사용자가 "텔레그램 안 왔다"고 신고한 정확히 그 3건 중 2건과 일치. 원자적
-- UPSERT 수정 커밋(09:56:08)보다 6분 앞서 생성돼 있어, 이후 14:10까지 계속
-- is_active=true로 갱신만 되고(사이트 알림은 정상) 텔레그램은 단 한 번도 재시도되지
-- 않은 채 방치돼 있었다.
--
-- 수정: notifications에 telegram_sent_at을 추가해 "텔레그램이 실제로 성공했는가"를
-- INSERT 성공 여부와 완전히 분리한다. 매 사이클 upsert_stock_alert가 이 값을 함께
-- 돌려주면, 호출부(stock-alerts 크론)는 is_new가 아니라
-- "skipped가 아니고 telegram_sent_at이 NULL인가"로 텔레그램 대상을 판단한다 — 이러면
-- 최초 삽입 시점에 텔레그램이 실패해도 조건이 계속 유지되는 한 다음 사이클(10분 뒤)에
-- 자동으로 재시도된다.

-- 1. telegram_sent_at 컬럼 추가.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS telegram_sent_at timestamptz;

-- 2. 기존 행 전체는 "이미 처리된 과거"로 간주해 일괄 backfill — 안 그러면 이 마이그레이션
--    적용 즉시 그동안 쌓인 모든 유저의 활성 알림이 한꺼번에 재발송(플러드) 대상이 된다.
UPDATE public.notifications
SET telegram_sent_at = updated_at
WHERE telegram_sent_at IS NULL;

-- 3. 위 2번으로 전부 "처리됨"이 됐으니, 오늘 실제로 텔레그램이 막혀 있던 것으로 확인된
--    6건만 명시적으로 다시 NULL로 되돌려 다음 크론 사이클(최대 10분 이내)에 자동
--    재시도되게 한다 — 조건(외국인/기관 수급, 하락률)이 그때도 여전히 유지되고 있어야
--    실제로 재발송된다(조건 미충족이면 5-1 단계에서 이미 비활성화됐을 것).
UPDATE public.notifications
SET telegram_sent_at = NULL
WHERE user_id = 'ecc85bde-5f4f-4106-b122-f23c39b0bce2'
  AND notif_date = '2026-08-31'
  AND is_active = true
  AND (stock_code, type, threshold) IN (
    ('005930', 'foreign_sell', 1000),
    ('005930', 'institution_sell', 1000),
    ('000660', 'foreign_sell', 1000),
    ('000660', 'institution_sell', 1000),
    ('174900', 'price_down', 5),
    ('047040', 'price_down', 5)
  );

-- 4. upsert_stock_alert RPC — telegram_sent_at을 함께 반환하도록 재정의. is_new
--    필드는 하위호환을 위해 남겨두되(당장은 호출부에서 안 쓰게 되지만 디버깅/로그용으로
--    의미가 있어 유지), 텔레그램 대상 판단은 호출부에서 telegram_sent_at IS NULL로 한다.
CREATE OR REPLACE FUNCTION public.upsert_stock_alert(
  p_user_id       uuid,
  p_stock_code    text,
  p_stock_name    text,
  p_type          text,
  p_message       text,
  p_threshold     numeric,
  p_current_value numeric,
  p_notif_date    date
) RETURNS TABLE(id uuid, is_new boolean, skipped boolean, telegram_sent_at timestamptz)
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = p_user_id AND stock_code = p_stock_code AND type = p_type
      AND threshold = p_threshold AND notif_date = p_notif_date AND is_active = false
  ) THEN
    RETURN QUERY SELECT NULL::uuid, false, true, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.notifications (
    user_id, stock_code, stock_name, type, message, threshold, current_value,
    is_active, notif_date, created_at, updated_at
  ) VALUES (
    p_user_id, p_stock_code, p_stock_name, p_type, p_message, p_threshold, p_current_value,
    true, p_notif_date, now(), now()
  )
  ON CONFLICT (user_id, stock_code, type, threshold, notif_date) WHERE is_active = true
  DO UPDATE SET
    stock_name    = EXCLUDED.stock_name,
    message       = EXCLUDED.message,
    current_value = EXCLUDED.current_value,
    updated_at    = now()
  RETURNING notifications.id, (xmax = 0), false, notifications.telegram_sent_at;
END;
$$;
