-- 계좌이체(가상계좌) 결제수단 지원
-- 배경: 국내 카드사 업종 심사 거부 + Paddle "financial services" 미지원으로
--       CMS 자동이체(사용자 심리적 거부감으로 미채택) 대신 가상계좌 방식 확정.
--       KG이니시스(PortOne V2)가 이미 지원하는 결제수단이라 신규 PG 계약 불필요.

alter table public.users
  add column if not exists payment_method text default 'CARD' check (payment_method in ('CARD', 'VIRTUAL_ACCOUNT')),
  add column if not exists phone          text;  -- 가상계좌 발급 시 PortOne이 요구하는 customer.phoneNumber, 갱신 발급 시 재사용

-- payments: 가상계좌 발급 정보 (은행/계좌번호/입금기한)
alter table public.payments
  add column if not exists va_bank           text,
  add column if not exists va_account_number text,
  add column if not exists va_due_at         timestamptz;

-- 입금 기한 초과 시 'expired' 상태로 표시하기 위해 허용 상태값 확장
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('pending', 'paid', 'failed', 'cancelled', 'partial_cancelled', 'expired'));

-- 가상계좌 입금기한 임박/초과 조회용 (cron/virtual-account-renewal)
create index if not exists payments_va_due_at_idx on public.payments(va_due_at)
  where payment_method = 'VIRTUAL_ACCOUNT' and status = 'pending';
