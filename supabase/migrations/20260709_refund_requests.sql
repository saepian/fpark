-- 구독 취소/환불 시스템 — 계좌이체 특성상 자동 송금이 불가능해
-- "취소 접수 → 자동 계산 → 관리자 확인 후 수동 송금 → 완료 처리" 흐름으로 설계.
-- bank_transfer_requests와 완전히 별개 테이블(취소는 결제 승인과 반대 방향 액션이라
-- 상태값 의미가 섞이면 혼란스러우므로 분리).
--
-- users.subscription_status에 새로 쓰이는 값(CHECK 제약 없는 자유 text 컬럼이라 마이그레이션 불필요):
--   'cancelled'             — 7일 이내 취소, 즉시 해지+환불 대상(전액 또는 일할)
--   'pending_cancellation'  — 7일 초과 취소, 다음 결제일까지는 이용 가능한 해지예약 상태

create table if not exists public.refund_requests (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null references auth.users(id) on delete cascade,
  plan                    text        not null check (plan in ('basic', 'pro')),
  paid_amount             int         not null,        -- 환불 계산의 기준이 된 결제금액(가장 최근 승인된 계좌이체 금액)
  subscription_start_date timestamptz not null,         -- 계산에 사용한 "결제일" 스냅샷(구독 시작일)
  usage_detected          boolean     not null,         -- stock_diagnosis/portfolio_diagnosis 사용 이력 존재 여부
  elapsed_days            int         not null,         -- 취소 신청일 - 결제일 (일 단위)
  refund_amount           int         not null default 0,
  refund_reason           text,                          -- 계산 근거 서술(관리자 확인용)
  refund_status           text        not null default 'none'
                                      check (refund_status in ('none', 'requested', 'completed', 'rejected')),
  refund_account_bank     text,
  refund_account_number   text,
  refund_account_holder   text,
  requested_at            timestamptz not null default now(),  -- 취소 신청 시각
  processed_at            timestamptz,                          -- 관리자가 송금완료 처리한 시각
  processed_by            text,                                 -- 처리한 관리자 이메일
  created_at              timestamptz not null default now()
);

create index if not exists refund_requests_status_idx
  on public.refund_requests(refund_status);
create index if not exists refund_requests_user_id_idx
  on public.refund_requests(user_id);
-- 관리자 "환불 대기" 목록 조회(신청일시 최신순) 최적화
create index if not exists refund_requests_requested_idx
  on public.refund_requests(requested_at desc)
  where refund_status = 'requested';

alter table public.refund_requests enable row level security;

create policy "본인 환불 신청 내역 조회" on public.refund_requests
  for select using (auth.uid() = user_id);

-- 생성/처리는 전부 서버 라우트(adminClient, service_role)를 통해서만
create policy "서비스 롤 전체 접근" on public.refund_requests
  for all using (auth.role() = 'service_role');
