-- 회원가입 시 public.users 행이 생성되지 않는 구조적 버그 수정.
-- 이메일 회원가입, 네이버 콜백(app/api/auth/naver/callback), 구글 OAuth 전부
-- auth.users에만 유저를 만들고 public.users는 아무도 INSERT하지 않아서,
-- 결제 승인 등 public.users를 UPDATE하는 로직이 매칭 행이 없어 조용히
-- 0건 처리되는 문제가 있었다 (2026-07-07 junge1mini@gmail.com 사례로 발견).
--
-- auth.users는 Supabase Auth 내부 스키마라 모든 가입 경로(이메일 signUp,
-- OAuth 콜백, admin.createUser)가 결국 여기 INSERT 한 번을 거치므로,
-- DB 트리거 하나로 코드 경로에 상관없이 전부 커버된다.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
