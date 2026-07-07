-- 회원가입~탈퇴 라이프사이클 메일 보완: "웰컴 메일 발송 여부" 마커 컬럼.
-- 이메일 인증 완료(이메일 가입) 또는 최초 로그인(소셜) 시점에 1회만 환영 메일을 보내기 위한 컬럼.
-- terms_agreed_at과 동일한 원칙: 기존 유저는 created_at으로 백필하여
-- "다음 로그인 때 갑자기 웰컴 메일을 다시 받는" 일이 없도록 한다.

alter table public.users
  add column if not exists welcome_email_sent_at timestamptz;

update public.users
  set welcome_email_sent_at = created_at
  where welcome_email_sent_at is null;
