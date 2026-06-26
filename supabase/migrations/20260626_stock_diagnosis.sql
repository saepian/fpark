create table stock_diagnosis (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  ticker text not null,
  name text not null,
  avg_price integer not null,
  quantity integer not null,
  buy_date date,
  result jsonb,
  created_at timestamptz default now()
);

alter table stock_diagnosis enable row level security;

create policy "본인 진단만 조회" on stock_diagnosis
  for select using (auth.uid() = user_id);

create policy "본인 진단만 생성" on stock_diagnosis
  for insert with check (auth.uid() = user_id);
