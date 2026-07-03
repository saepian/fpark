-- daily_picks를 가격 모멘텀 기반 선정에서 외국인/기관 수급 기준 스크리너로 재정의하며
-- 실제 선정 사유(수치)를 저장할 컬럼 추가
ALTER TABLE public.daily_picks
  ADD COLUMN IF NOT EXISTS pick_reason TEXT,
  ADD COLUMN IF NOT EXISTS foreign_net_buy_auk NUMERIC,
  ADD COLUMN IF NOT EXISTS institution_net_buy_auk NUMERIC,
  ADD COLUMN IF NOT EXISTS foreign_consecutive_days INTEGER,
  ADD COLUMN IF NOT EXISTS institution_consecutive_days INTEGER,
  ADD COLUMN IF NOT EXISTS week52_high NUMERIC,
  ADD COLUMN IF NOT EXISTS week52_low NUMERIC;
