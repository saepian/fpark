-- 연간결제 환불 로직 버그 수정의 일부: 활성 구독이 연간/월간인지를 users 테이블
-- 자체에도 안정적으로 기록. 지금까지는 bank_transfer_requests.is_annual에만 있어서
-- (승인 시점의 요청 행을 다시 조회해야만 알 수 있었음), users 테이블만 보고는
-- 결제 주기를 알 수 없었다. 계좌이체 승인 시(app/api/admin/bank-transfers/[id]/route.ts)
-- bank_transfer_requests.is_annual 값을 그대로 복사해서 저장한다.
--
-- 기존 유저(전부 월간 결제만 있었음, 2026-07-08 확인: is_annual=true인
-- bank_transfer_requests 0건)는 false로 백필해도 안전하다.

alter table public.users
  add column if not exists is_annual boolean not null default false;

update public.users
  set is_annual = true
  where id in (
    select user_id from public.bank_transfer_requests
    where is_annual = true and status = 'approved'
  );
