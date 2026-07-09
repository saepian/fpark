-- codef_connected_accounts: CODEF 계정 등록(계좌 연결) 성공 시 발급되는 connectedId 저장.
-- codef_tokens와 마찬가지로 서버 라우트(adminClient, service_role)에서만 접근하므로
-- RLS 없이 생성한다(anon/authenticated 클라이언트에는 노출되지 않음).
create table if not exists public.codef_connected_accounts (
  id                           uuid        primary key default gen_random_uuid(),
  connected_id                 text        not null,
  bank_name                    text        not null,
  business_registration_number text,       -- 법인 계좌 식별용(사업자등록번호) — 필요 없으면 비워둬도 됨
  created_at                   timestamptz not null default now()
);

create unique index if not exists codef_connected_accounts_connected_id_idx
  on public.codef_connected_accounts(connected_id);
