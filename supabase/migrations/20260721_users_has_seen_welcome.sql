-- 회원가입 직후 신규 유저에게 한 번만 보여주는 웰컴 페이지(/welcome) 노출 여부.
--
-- 컬럼 기본값은 true(= 이미 봤음/노출 안 함)로 잡아, 이 컬럼을 명시적으로
-- 다루지 않는 모든 경로(기존 유저 백필, 수동 INSERT 등)에서 안전하게 웰컴
-- 페이지가 노출되지 않도록 한다.
--
-- 실제로 웰컴 페이지를 봐야 하는 "신규" 가입자만 false로 시작해야 하므로,
-- handle_new_user() 트리거(20260710_auto_create_public_user.sql)에서 신규
-- 행을 만들 때 명시적으로 false를 지정하도록 같이 수정한다. 이 트리거는
-- auth.users INSERT 시점에 실행되어 이메일 회원가입/네이버 콜백/구글 OAuth
-- 전부를 코드 경로에 상관없이 커버하는 단일 지점이다.

alter table public.users
  add column if not exists has_seen_welcome boolean not null default true;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, has_seen_welcome)
  values (new.id, new.email, false)
  on conflict (id) do nothing;
  return new;
end;
$$;
