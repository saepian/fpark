-- kis_acquire_rate_slot: kis_rate_limiter 행에서 토큰 1개를 원자적으로 확보 시도.
--
-- SELECT ... FOR UPDATE로 id=1 행을 잠근 뒤, 경과 시간만큼 토큰을 리필(초당 p_rate개,
-- 최대 p_burst개 캡)하고 1개 이상이면 즉시 차감해 허용(allowed=true), 없으면 거부하고
-- "다음 토큰까지 남은 ms"(wait_ms)를 계산해 돌려준다 — 호출부(lib/kis-api.ts의
-- acquireKisRateSlot)가 이 값만큼 정확히 대기했다가 재시도하면 되므로 맹목적 폴링보다
-- DB 부하가 훨씬 적다.
--
-- FOR UPDATE 행 잠금은 동시에 여러 서버리스 인스턴스가 호출해도 Postgres가 자동으로
-- 한 번에 하나씩만 처리하게 해준다(먼저 잠근 트랜잭션이 끝날 때까지 나머지는 대기) —
-- kis_tokens의 발급 락과 같은 원리로 별도 락 테이블 없이 원자성을 보장한다.
create or replace function public.kis_acquire_rate_slot(p_rate double precision, p_burst double precision)
returns table(allowed boolean, wait_ms integer)
language plpgsql
as $$
declare
  v_tokens     double precision;
  v_updated_at timestamptz;
  v_now        timestamptz := clock_timestamp();
  v_elapsed    double precision;
  v_deficit    double precision;
begin
  select tokens, updated_at into v_tokens, v_updated_at
  from public.kis_rate_limiter
  where id = 1
  for update;

  v_elapsed := greatest(extract(epoch from (v_now - v_updated_at)), 0);
  v_tokens := least(p_burst, v_tokens + v_elapsed * p_rate);

  if v_tokens >= 1 then
    update public.kis_rate_limiter set tokens = v_tokens - 1, updated_at = v_now where id = 1;
    return query select true, 0;
  else
    update public.kis_rate_limiter set tokens = v_tokens, updated_at = v_now where id = 1;
    v_deficit := (1 - v_tokens) / p_rate;
    return query select false, ceil(v_deficit * 1000)::int;
  end if;
end;
$$;
