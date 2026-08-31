-- uniq_notifications_active_daily가 실제로는 부분 인덱스(WHERE is_active = true)가 아니라
-- 전체 행에 걸리는 완전 유니크 인덱스로 프로덕션에 존재하던 스키마 드리프트 수정.
--
-- notifications_unique.sql이 CREATE UNIQUE INDEX IF NOT EXISTS ... WHERE is_active = true로
-- 부분 인덱스를 의도했으나, 2026-08-31 알림 시스템 QA에서 실제 프로덕션엔 WHERE절 없는
-- 완전 유니크 인덱스로 존재하는 걸 실측 확인했다(비활성 행 2개를 같은 키로 직접 insert해도
-- 유니크 위반이 발생함 — 진짜 부분 인덱스라면 나면 안 되는 충돌). 과거 어느 시점에 같은
-- 이름의 완전 인덱스가 먼저 생겼고, 이후 notifications_unique.sql의 "IF NOT EXISTS" 때문에
-- partial 재정의가 조용히 no-op됐던 것으로 추정된다.
--
-- 이 드리프트 자체가 당장 사용자에게 보이는 버그를 일으키진 않았다 — upsert_stock_alert
-- RPC(20260831_notifications_atomic_upsert.sql)가 비활성 행이 있으면 INSERT/UPDATE를 아예
-- 시도하지 않고 먼저 EXISTS 체크로 걸러서, 이 유니크 제약을 실제로 건드릴 상황 자체가
-- 없었다. 다만 스키마가 문서/코드 주석이 전제하는 것과 실제로 다른 채로 남아있는 건 향후
-- 이 영역을 만질 사람에게 함정이 된다. 완전 인덱스를 부분 인덱스로 교체해도 기존 데이터는
-- 항상 안전하다 — 완전 제약을 만족하는 데이터는 그보다 느슨한 부분 제약도 항상 만족하므로
-- 교체 시 충돌 가능성이 없다.
DROP INDEX IF EXISTS public.uniq_notifications_active_daily;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_active_daily
ON public.notifications (user_id, stock_code, type, threshold, notif_date)
WHERE is_active = true;
