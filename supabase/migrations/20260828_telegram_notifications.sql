-- 텔레그램 알림 연동
-- users에 연동된 채팅 ID를 저장하고, 연동 과정에서만 쓰이는 1회용 짧은 토큰은 별도
-- 테이블(telegram_link_tokens)로 분리한다(kis_rate_limiter·kis_tokens 등 이 프로젝트의
-- "짧은 수명 상태는 전용 테이블" 관례와 동일).

alter table public.users
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_linked_at timestamptz;

create index if not exists idx_users_telegram_chat_id
  on public.users(telegram_chat_id)
  where telegram_chat_id is not null;

create table if not exists public.telegram_link_tokens (
  token       text        primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

alter table public.telegram_link_tokens enable row level security;

-- 전부 서버 라우트(마이페이지 API·텔레그램 웹훅)를 경유해서만 접근 — 클라이언트가
-- 직접 이 테이블을 읽거나 쓸 일이 없으므로 서비스 롤 전용으로 잠근다.
create policy "서비스 롤 전용" on public.telegram_link_tokens
  for all using (auth.role() = 'service_role');

create index if not exists idx_telegram_link_tokens_user on public.telegram_link_tokens(user_id);
