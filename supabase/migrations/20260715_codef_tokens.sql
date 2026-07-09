-- codef_tokens: CODEF API 토큰 DB 캐싱 (lib/kis-api.ts의 kis_tokens와 동일한 패턴).
-- serverless invocation 간 토큰을 공유해 재발급 횟수를 줄이기 위한 영속 캐시.
-- 서버 라우트(adminClient, service_role)에서만 접근하므로 kis_tokens와 마찬가지로
-- RLS 없이 생성한다(anon/authenticated 클라이언트에는 노출되지 않음).
create table if not exists public.codef_tokens (
  id           uuid        primary key default gen_random_uuid(),
  access_token text        not null,
  expired_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
