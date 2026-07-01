-- Pro 구독자 관심종목 알림 테이블

create table if not exists public.notifications (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  stock_code    text        not null,
  stock_name    text        not null,
  type          text        not null check (type in ('price_up','price_down','foreign_buy','foreign_sell','institution_buy','institution_sell')),
  message       text        not null,
  threshold     numeric     not null,
  current_value numeric     not null,
  is_read       boolean     not null default false,
  created_at    timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "본인 알림 조회" on public.notifications
  for select using (auth.uid() = user_id);

create policy "본인 알림 수정" on public.notifications
  for update using (auth.uid() = user_id);

create policy "서비스 롤 insert" on public.notifications
  for insert with check (auth.role() = 'service_role');

create index if not exists notifications_user_id_idx    on public.notifications(user_id);
create index if not exists notifications_created_at_idx on public.notifications(created_at desc);
create index if not exists notifications_unread_idx     on public.notifications(user_id, is_read)
  where is_read = false;
