-- kis_rate_limiter: KIS API 전역 초당 호출 제한
--
-- 배경: 대시보드/관심종목 라우트와 크론 3개(market-cache-warm, daily-alert-email,
-- stock-alerts)가 같은 KIS_APP_KEY를 공유하는데, 각자 로컬 청크 스로틀링(3개씩/250ms)만
-- 적용해 서로의 존재를 모르고 동시에 KIS를 두드린다. 2026-08-24 실측: 단독 호출자는
-- 로컬 스로틀링만으로 0건 실패, 여러 청크를 간격 없이 겹쳐 쏘면(=여러 서버리스 인스턴스가
-- 동시에 호출하는 상황 재현) 즉시 EGW00201(초당 거래건수 초과) 발생 — 매번 다른 종목이
-- 무작위로 걸려 특정 티커 문제가 아님을 확인.
--
-- Vercel 서버리스는 인스턴스 간 메모리 공유가 안 되므로 인메모리 리미터는 불가능하다.
-- kis_tokens의 발급 락(sentinel row INSERT 충돌로 인스턴스 간 직렬화)과 같은 결로,
-- 이 테이블은 단일 행(id=1)만 유지하는 토큰버킷 상태를 저장하고, 아래
-- kis_acquire_rate_slot() 함수가 그 행을 FOR UPDATE로 잠가 여러 인스턴스의 동시
-- 호출을 자동으로 직렬화한다.
create table if not exists public.kis_rate_limiter (
  id         smallint primary key,
  tokens     double precision not null,
  updated_at timestamptz not null default now()
);

insert into public.kis_rate_limiter (id, tokens, updated_at)
values (1, 15, now())
on conflict (id) do nothing;

alter table public.kis_rate_limiter enable row level security;
-- 정책 없음 — service role 서버 코드(lib/kis-api.ts의 acquireKisRateSlot)만 접근
-- (kis_tokens/stock_analysis_history와 동일 관행)
