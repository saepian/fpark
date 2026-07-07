-- 계좌이체(무통장입금) 수동 승인 시스템
-- 배경: PG(PortOne) 가상계좌 자동 승인이 계속 불확실해(VA_ENABLED=false) PG와 무관하게
--       지금 바로 판매 가능한 대안으로, 회사 명의 고정 계좌 + 입금자명 매칭 + 관리자
--       수동 승인 방식을 도입한다. credit_system(stock_credits/portfolio_credits)과는
--       완전히 별개 — 이 테이블은 subscription_plan/subscription_status만 다룬다.

create table if not exists public.bank_transfer_requests (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  plan           text        not null check (plan in ('basic', 'pro')),
  is_annual      boolean     not null default false,
  amount         int         not null,
  depositor_name text        not null,  -- 안내된 입금자명(가입 이메일 아이디 부분) — 관리자 매칭용
  status         text        not null default 'pending'
                             check (status in ('pending', 'approved', 'rejected', 'expired')),
  requested_at   timestamptz not null default now(),
  processed_at   timestamptz,
  processed_by   text,  -- 승인/거절 처리한 관리자 이메일
  created_at     timestamptz not null default now()
);

create index if not exists bank_transfer_requests_status_idx
  on public.bank_transfer_requests(status);
create index if not exists bank_transfer_requests_user_id_idx
  on public.bank_transfer_requests(user_id);
-- 관리자 목록 조회(대기중, 신청일시 최신순) 최적화
create index if not exists bank_transfer_requests_pending_idx
  on public.bank_transfer_requests(requested_at desc)
  where status = 'pending';

alter table public.bank_transfer_requests enable row level security;

create policy "본인 신청 내역 조회" on public.bank_transfer_requests
  for select using (auth.uid() = user_id);

-- 생성/승인/거절/만료 처리는 전부 서버 라우트(adminClient, service_role)를 통해서만 —
-- 클라이언트가 직접 insert/update 하지 못하도록 별도의 authenticated insert 정책을 두지 않는다.
create policy "서비스 롤 전체 접근" on public.bank_transfer_requests
  for all using (auth.role() = 'service_role');
