-- 회원가입 시 약관/개인정보처리방침 동의 이력 기록.
-- 기존 가입자는 소급 동의 대상이 아니므로 created_at으로 백필해서
-- "이 컬럼이 생긴 뒤 가입했는데 아직 동의 안 한 유저"(NULL)와 구분한다.
-- 이후로는 terms_agreed_at IS NULL == 신규가입인데 미동의 상태, 로 단순하게 판별 가능.

alter table public.users
  add column if not exists terms_agreed_at timestamptz,
  add column if not exists privacy_agreed_at timestamptz;

update public.users
set terms_agreed_at = created_at, privacy_agreed_at = created_at
where terms_agreed_at is null;

-- 이메일 회원가입은 supabase.auth.signUp() 시점에 세션이 없을 수 있어(이메일 확인
-- 대기) 가입 직후 별도 API로 동의 시각을 기록할 수 없다. signUp의 user_metadata에
-- 동의 시각을 실어 보내고, 트리거가 auth.users INSERT 시점에 그대로 옮겨 담도록 한다.
-- 소셜 로그인(네이버/구글)은 이 메타데이터가 없으므로 NULL로 생성되고,
-- app/auth/agree-terms 페이지에서 로그인 후 별도로 기록한다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, terms_agreed_at, privacy_agreed_at)
  values (
    new.id,
    new.email,
    (new.raw_user_meta_data->>'terms_agreed_at')::timestamptz,
    (new.raw_user_meta_data->>'privacy_agreed_at')::timestamptz
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
