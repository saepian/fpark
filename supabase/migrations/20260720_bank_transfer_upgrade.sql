-- Basic → Pro 업그레이드 시 잔여 기간 크레딧을 차감한 차액만 청구하는 기능 지원.
-- 1) request_type 체크 제약에 'upgrade' 추가 (기존엔 'new'|'renewal'만 허용)
-- 2) superseded_by: 업그레이드로 대체된 이전 승인 건을 가리킴(삭제 없이 이력 보존)
alter table public.bank_transfer_requests
  drop constraint if exists bank_transfer_requests_request_type_check;
alter table public.bank_transfer_requests
  add constraint bank_transfer_requests_request_type_check
    check (request_type in ('new', 'renewal', 'upgrade'));

alter table public.bank_transfer_requests
  add column if not exists superseded_by uuid references public.bank_transfer_requests(id);
