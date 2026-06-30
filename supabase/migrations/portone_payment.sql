-- PortOne 결제 연동을 위한 Supabase 마이그레이션
-- Supabase SQL Editor 또는 CLI(supabase db push)로 실행
--
-- mypage API가 이미 payments 테이블의 id, created_at, plan, amount, status 를
-- 참조하고 있으므로, 테이블이 없으면 생성하고 있으면 누락 컬럼만 추가함.

-- ── 1. payments 테이블 ────────────────────────────────────────────────────────

create table if not exists public.payments (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  plan           text        not null check (plan in ('basic', 'pro')),
  amount         int         not null,
  payment_id     text        not null unique,  -- PortOne paymentId (UUID)
  status         text        not null default 'pending'
                             check (status in ('pending','paid','failed','cancelled','partial_cancelled')),
  payment_method text,                         -- 'CARD' | 'BILLING_KEY' | 'EASY_PAY' 등
  billing_key    text,                         -- 정기결제용 빌링키 (nullable)
  is_annual      boolean     not null default false,
  created_at     timestamptz not null default now()
);

-- 테이블이 이미 존재하는 경우: 누락 컬럼만 개별 추가
alter table public.payments
  add column if not exists payment_id     text unique,
  add column if not exists payment_method text,
  add column if not exists billing_key    text,
  add column if not exists is_annual      boolean not null default false;

-- ── 2. RLS ────────────────────────────────────────────────────────────────────

alter table public.payments enable row level security;

-- 동일 정책이 이미 있으면 아래 주석 해제 후 drop 먼저 실행
-- drop policy if exists "본인 결제 내역 조회" on public.payments;
-- drop policy if exists "서비스 롤 insert"    on public.payments;
-- drop policy if exists "서비스 롤 update"    on public.payments;

create policy "본인 결제 내역 조회" on public.payments
  for select using (auth.uid() = user_id);

-- 서비스 롤만 insert/update 가능 (클라이언트 직접 접근 차단)
create policy "서비스 롤 insert" on public.payments
  for insert with check (auth.role() = 'service_role');

create policy "서비스 롤 update" on public.payments
  for update using (auth.role() = 'service_role');

-- ── 3. users 테이블 컬럼 추가 ─────────────────────────────────────────────────

alter table public.users
  add column if not exists subscription_plan   text    default 'free',
  add column if not exists subscription_status text    default 'inactive',
  add column if not exists billing_key         text,
  add column if not exists next_billed_at      timestamptz;

-- ── 4. 인덱스 ────────────────────────────────────────────────────────────────

create index if not exists payments_user_id_idx     on public.payments(user_id);
create index if not exists payments_payment_id_idx  on public.payments(payment_id);

-- 다음 청구일 기준으로 활성 구독자만 빠르게 조회 (cron 성능 최적화)
create index if not exists users_next_billed_at_idx on public.users(next_billed_at)
  where subscription_status = 'active';
