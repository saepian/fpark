-- 계좌이체 구독 갱신 자동화 — 어제 만든 신규가입 승인 인프라(bank_transfer_requests,
-- 관리자 인증, 이메일 발송)를 그대로 재사용. 이 마이그레이션은:
--   1. bank_transfer_requests에 request_type('new'|'renewal') 추가
--   2. users.payment_method 체크 제약에 'BANK_TRANSFER' 추가 (기존 'CARD'/'VIRTUAL_ACCOUNT'는
--      각각 이니시스 카드결제/PG 가상계좌용 — 계좌이체 수동승인 구독자를 구분하기 위함)
--   3. 갱신 크론 조회 최적화 인덱스

alter table public.bank_transfer_requests
  add column if not exists request_type text not null default 'new'
    check (request_type in ('new', 'renewal'));

alter table public.users drop constraint if exists users_payment_method_check;
alter table public.users add constraint users_payment_method_check
  check (payment_method in ('CARD', 'VIRTUAL_ACCOUNT', 'BANK_TRANSFER'));

-- 갱신 알림 크론(cron/bank-transfer-renewal-notice)이 "결제일 3일 전 active 구독자"를
-- 찾을 때, 만료 크론(cron/bank-transfer-expire)이 "결제일 도달한 pending_renewal 구독자"를
-- 찾을 때 사용
create index if not exists users_renewal_lookup_idx
  on public.users(subscription_status, next_billed_at)
  where subscription_status in ('active', 'pending_renewal');
