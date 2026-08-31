-- stock-alerts 크론의 "오늘 새로 발생한 알림인가" 판별을 원자적 방식으로 재설계.
--
-- 배경: 기존 방식은 SELECT로 오늘자 기존 알림을 조회해 메모리 Map(existingByKey)에
-- 올린 뒤 신규 트리거와 대조해 "기존에 없던 것만" 텔레그램 발송 대상으로 필터링하는
-- 2단계 구조였다(app/api/cron/stock-alerts/route.ts). 2026-08-31 실측에서 이 구조
-- 어딘가가 실제로 신규였던 알림 3건(앱클론/대우건설/다날 price_down 5%)을 "이미 존재"로
-- 오분류해 텔레그램 발송이 통째로 스킵되는 문제가 발생했다(사이트 알림 자체는 정상
-- upsert됨 — 판단과 실제 DB 상태 사이의 불일치). 정확한 결함 라인은 특정하지 못했으나,
-- "판단 시점(SELECT)"과 "쓰기 시점(UPSERT)"이 분리돼 있는 구조 자체가 근본 원인이라고
-- 보고, 판단과 쓰기를 하나의 원자적 SQL 문으로 합친다 — INSERT ... ON CONFLICT ... DO
-- UPDATE ... RETURNING (xmax = 0)로 "이번 호출이 실제 INSERT였는지"를 DB가 그 자리에서
-- 바로 알려준다(Postgres UPSERT 관용구 — DO UPDATE로 처리된 행은 xmax가 현재 트랜잭션
-- ID로 채워지고, 진짜 새로 삽입된 행만 xmax=0으로 남는다).
--
-- 동시에, upsert마다 created_at을 new Date()로 덮어써 "최초 발생 시각"을 잃어버리던
-- 문제도 같이 고친다 — updated_at을 분리해 created_at은 최초 삽입 시각으로 고정 보존.

-- 1. updated_at 컬럼 추가 (created_at과 분리)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 기존 행 backfill — 더 정확한 "마지막 갱신 시각" 정보가 없으므로 created_at으로 채운다.
UPDATE public.notifications
SET updated_at = created_at
WHERE updated_at IS DISTINCT FROM created_at;

-- 2. 원자적 upsert RPC.
--
-- "오늘 이 (user, stock, type, threshold)로 이미 알렸다가 조건 미충족으로 꺼진 행"이
-- 있으면(is_active=false) 재알림하지 않는 일 단위 리셋 정책(2026-08-01 재설계, 8/28
-- 재확인)은 그대로 유지하되, 이 판단도 함수 안의 EXISTS 체크로 원자적으로 처리해
-- 호출부(JS)가 별도 SELECT를 할 필요를 없앤다.
--
-- ON CONFLICT 대상은 uniq_notifications_active_daily 부분 유니크 인덱스
-- (WHERE is_active = true, notifications_unique.sql)와 정확히 일치해야 한다 — 부분
-- 인덱스는 WHERE절을 ON CONFLICT에도 명시해야 충돌 대상(arbiter)으로 추론된다.
CREATE OR REPLACE FUNCTION public.upsert_stock_alert(
  p_user_id       uuid,
  p_stock_code    text,
  p_stock_name    text,
  p_type          text,
  p_message       text,
  p_threshold     numeric,
  p_current_value numeric,
  p_notif_date    date
) RETURNS TABLE(id uuid, is_new boolean, skipped boolean)
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = p_user_id AND stock_code = p_stock_code AND type = p_type
      AND threshold = p_threshold AND notif_date = p_notif_date AND is_active = false
  ) THEN
    RETURN QUERY SELECT NULL::uuid, false, true;
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
  RETURNING notifications.id, (xmax = 0), false;
END;
$$;
