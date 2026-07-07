-- 크레딧 시스템(1회권) 정식 반영 + 원자적 증감 RPC
-- 배경: stock_credits/portfolio_credits는 그동안 코드(app/api/diagnosis,
--       app/api/portfolio-diagnosis)에서 참조만 되고 실제 users 테이블에는
--       없던 dead column이었음 (PostgREST 에러로 조용히 무시되던 상태).
--       "1회권" 결제는 아직 PG/MoR가 확정되지 않아 미판매 중이지만,
--       스키마·차감 로직은 특정 PG와 무관하게 지금 정리해둔다.
--
-- 실행: Supabase SQL Editor 또는 CLI(supabase db push)

-- ── 1. users 테이블 컬럼 추가 ─────────────────────────────────────────────────

alter table public.users
  add column if not exists stock_credits     int not null default 0,
  add column if not exists portfolio_credits int not null default 0,
  add column if not exists subscription_start_date timestamptz;

comment on column public.users.stock_credits is
  '기업 분석 1회권 잔여 개수 — grantCredits()로 충전, deduct_credit() RPC로 원자적 차감';
comment on column public.users.portfolio_credits is
  '포트폴리오 분석 1회권 잔여 개수 — grantCredits()로 충전, deduct_credit() RPC로 원자적 차감';
comment on column public.users.subscription_start_date is
  '구독 최초 시작일 — 월간 사용량 한도 계산의 청구 주기 기준일(app/api/portfolio-diagnosis
   getBillingCycleStart). null이면 매월 1일 기준으로 폴백';

-- ── 2. 크레딧 차감 (atomic, race condition 방지) ────────────────────────────────
-- 기존 코드는 "SELECT credits → JS에서 -1 계산 → UPDATE"의 read-modify-write라
-- 동시 요청 시 이중 사용이 가능했음. UPDATE ... WHERE credits > 0 RETURNING으로
-- 단일 원자적 문장 안에서 조건 확인과 차감을 동시에 수행해 경쟁 조건을 제거한다.
-- 반환값이 null이면 "크레딧 부족으로 차감 실패"를 의미.

create or replace function public.deduct_credit(
  p_user_id     uuid,
  p_credit_type text  -- 'stock' | 'portfolio'
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  if p_credit_type = 'stock' then
    update public.users
      set stock_credits = stock_credits - 1
      where id = p_user_id and stock_credits > 0
      returning stock_credits into v_remaining;
  elsif p_credit_type = 'portfolio' then
    update public.users
      set portfolio_credits = portfolio_credits - 1
      where id = p_user_id and portfolio_credits > 0
      returning portfolio_credits into v_remaining;
  else
    raise exception 'invalid credit type: %', p_credit_type;
  end if;

  return v_remaining; -- null = 크레딧 0 이하라 차감 실패
end;
$$;

-- ── 3. 크레딧 충전 (atomic, PG 무관 공용 함수) ──────────────────────────────────
-- 어떤 PG의 결제 완료 웹훅이 호출하든 이 함수 하나만 거치면 되도록 설계.
-- lib/credits.ts의 grantCredits()가 이 RPC를 감싼다.

create or replace function public.add_credit(
  p_user_id     uuid,
  p_credit_type text,  -- 'stock' | 'portfolio'
  p_amount      int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_value int;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive: %', p_amount;
  end if;

  if p_credit_type = 'stock' then
    update public.users
      set stock_credits = stock_credits + p_amount
      where id = p_user_id
      returning stock_credits into v_new_value;
  elsif p_credit_type = 'portfolio' then
    update public.users
      set portfolio_credits = portfolio_credits + p_amount
      where id = p_user_id
      returning portfolio_credits into v_new_value;
  else
    raise exception 'invalid credit type: %', p_credit_type;
  end if;

  if v_new_value is null then
    raise exception 'user not found: %', p_user_id;
  end if;

  return v_new_value;
end;
$$;

-- 서비스 롤(서버 라우트/웹훅)만 호출 — 클라이언트에서 직접 호출 금지
revoke execute on function public.deduct_credit(uuid, text) from anon, authenticated;
revoke execute on function public.add_credit(uuid, text, int) from anon, authenticated;
grant execute on function public.deduct_credit(uuid, text) to service_role;
grant execute on function public.add_credit(uuid, text, int) to service_role;
