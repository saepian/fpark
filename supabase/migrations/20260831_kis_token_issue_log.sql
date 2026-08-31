-- 2026-08-31 KIS 토큰 재발급 재조사 후속.
--
-- 배경: 같은 날 KIS 알림톡으로 확인된 토큰 발급이 4회(11:44, 12:47, 16:07, 17:22)였는데
-- kis_tokens 테이블에는 1행(16:07)만 남아 있어, 1차 조사에서 "DB에 1건뿐이니 정상"으로
-- 오판했다. 원인 조사 결과:
--   - kis_tokens는 "저장에 성공한 새 토큰"만 남기는 테이블이라 tokenP 호출 이력이 아니다.
--   - KIS는 유효기간 내 재요청 시 기존 토큰을 그대로 돌려주는데(실측: 16:07 프로덕션이 받은
--     토큰이 다른 프로세스가 11:44에 받은 것과 문자열까지 동일), 이 경우에도 알림톡은 온다.
--   - 같은 앱키를 별도 프로젝트(video-pipeline, 파일 캐시)도 쓰고 있어 fpark 밖의 발급은
--     fpark 어디에도 안 남는다.
-- 그래서 "fpark가 실제로 tokenP를 호출한 모든 시도"를 kis_tokens 저장 성패와 무관하게
-- 빠짐없이 기록하는 감사 로그를 둔다 — lib/kis-api.ts getAccessToken()의 finally에서
-- 성공/실패/예외 전부 1행씩 insert한다. 다음번 "몇 번 발급됐나" 조사는 이 테이블 한 곳을
-- 보면 된다(단, fpark 밖 프로세스의 발급은 여전히 KIS 알림톡/포털로만 확인 가능).
--
-- 실행: Supabase SQL Editor (service-role은 DDL 불가 — 기존 마이그레이션과 동일)

CREATE TABLE IF NOT EXISTS public.kis_token_issue_log (
  id               bigserial PRIMARY KEY,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  reason           text NOT NULL,          -- expiring-soon | no-db-token | db-read-failed | unknown
  wait_for_lock    boolean NOT NULL DEFAULT true,
  outcome          text NOT NULL,          -- succeeded | failed(KIS 4xx/5xx) | exception
  http_status      integer,
  message          text,                   -- 실패 본문 / 저장 예외 등
  token_tail       text,                   -- 받은 토큰의 마지막 8자(동일 토큰 반환 여부 대조용)
  kis_expired_at   timestamptz,            -- KIS 응답 access_token_token_expired (진실源)
  same_as_previous boolean,               -- KIS가 kis_tokens 최신 행과 같은 토큰을 돌려줬는지
  source           text                    -- VERCEL_URL / VERCEL_ENV / 'local'
);

CREATE INDEX IF NOT EXISTS kis_token_issue_log_requested_at_idx
  ON public.kis_token_issue_log (requested_at DESC);

ALTER TABLE public.kis_token_issue_log ENABLE ROW LEVEL SECURITY;
-- 정책 없음 — service-role 서버 코드만 접근(kis_tokens/kis_rate_limiter와 동일 관행)

-- 오늘(2026-08-31) 확인된 실측을 근거로 kis_tokens id=53의 만료시각을 KIS 기준으로 보정:
-- 16:07에 프로덕션이 받은 토큰은 11:44에 발급된 것과 동일하므로 실제 만료는
-- 2026-09-01 11:44:33 KST(=02:44:33Z)인데 now+expires_in으로 07:07:57Z로 저장돼 있었다.
-- 이대로 두면 내일 11:44~16:07 사이 이미 만료된 토큰을 유효한 줄 알고 쓰다 EGW00123
-- 연쇄 재발급이 난다. 토큰 tail(qVSQuwZA) 일치를 조건으로 걸어 다른 행은 건드리지 않는다.
UPDATE public.kis_tokens
SET expired_at = '2026-09-01T02:44:33+00:00'
WHERE id = 53 AND access_token LIKE '%qVSQuwZA';
