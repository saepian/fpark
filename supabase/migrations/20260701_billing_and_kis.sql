-- billing_executions: cron/billing 중복 실행 방지 (item 9)
CREATE TABLE IF NOT EXISTS public.billing_executions (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_date DATE  NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- kis_tokens: KIS API 토큰 DB 캐싱 (item 11)
CREATE TABLE IF NOT EXISTS public.kis_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT        NOT NULL,
  expired_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- update_watchlist_order: 관심종목 순서 bulk update RPC (item 14)
CREATE OR REPLACE FUNCTION update_watchlist_order(
  p_user_id UUID,
  p_tickers TEXT[],
  p_orders  INT[]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  FOR i IN 1..array_length(p_tickers, 1) LOOP
    UPDATE public.watchlist
    SET sort_order = p_orders[i]
    WHERE user_id = p_user_id AND ticker = p_tickers[i];
  END LOOP;
END;
$$;
