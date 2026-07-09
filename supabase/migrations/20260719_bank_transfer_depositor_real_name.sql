-- 계좌이체 자동 매칭을 이메일ID 기반(depositor_name)에서 예금주 실명 기반으로 전환.
-- users.depositor_real_name: 유저가 신청 시 입력한 실명을 영구 저장 — 갱신 신청은 화면이
-- 없으므로(크론이 자동 생성) 여기 저장된 값을 재사용한다. 마이페이지에서 수정 가능.
-- bank_transfer_requests.depositor_real_name: 신청 시점 스냅샷 — 나중에 users쪽 값이
-- 바뀌어도 이미 접수된 신청의 매칭 근거는 그대로 유지되도록 별도 보관.
-- 기존 depositor_name 컬럼은 삭제하지 않음(관리자 화면 표시용으로 계속 사용).
alter table public.users
  add column if not exists depositor_real_name text;

alter table public.bank_transfer_requests
  add column if not exists depositor_real_name text;
