-- Gmail dot/plus 별칭 어뷰징 재발 방지 — 정규화된 이메일 기준 DB 레벨 유니크 제약.
-- app/api/auth/signup/route.ts의 normalizeGmail()과 동일한 규칙(gmail.com/googlemail.com만
-- '+' 이후 제거 + '.' 제거, 그 외 도메인은 소문자 변환만)을 SQL 함수로 그대로 미러링한다.
--
-- 이미 존재하는 6개 중복 계정(radtechmomo@gmail.com 계열, 접속 이력 없어 그대로 둠, 2026-07-14
-- 조사 결정)은 이 제약을 테이블 전체에 걸면 즉시 위반되어 인덱스 생성 자체가 실패한다.
-- 그래서 created_at 기준 부분(partial) 유니크 인덱스로 "이 마이그레이션 적용 시점 이후"
-- 신규가입자에게만 적용한다 — 과거 데이터는 건드리지 않는다.
--
-- 이 제약의 실질적 가치는 signup/route.ts의 "조회 후 가입" 순차 체크가 막지 못하는
-- 동시 요청 경합(두 dot-변형 요청이 거의 동시에 들어와 서로의 존재를 못 보고 통과하는
-- 경우)까지 DB 레벨에서 원자적으로 막아주는 것이다 — 애플리케이션 체크와 DB 제약
-- 두 겹 방어.

create or replace function public.normalize_email(input_email text)
returns text
language sql
immutable
as $$
  select case
    when split_part(lower(trim(input_email)), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(trim(input_email)), '@', 1), '+', 1), '.', '')
           || '@' || split_part(lower(trim(input_email)), '@', 2)
    else lower(trim(input_email))
  end;
$$;

create unique index if not exists users_normalized_email_unique_idx
  on public.users (public.normalize_email(email))
  where created_at >= '2026-07-14T15:10:00+09:00';
