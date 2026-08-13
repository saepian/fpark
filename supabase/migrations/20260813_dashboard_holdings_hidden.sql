-- ════════════════════════════════════════════════════════════════════════
-- dashboard_holdings.hidden: "숨기기" 기능 — 종목 등록(row)은 유지한 채 카드
-- 목록·스탯카드·차트 계산에서만 제외하는 표시 플래그. 삭제와 달리 데이터를
-- 보존해 "다시 보이기"로 원상복구 가능. 숨김 여부와 무관하게 row는 계속
-- 존재하므로 등록 한도(무료 2개/유료 15개) 계산에는 그대로 포함된다
-- (2026-08-13 설계 검토 — "숨김은 안 보이게이지 한도에서 빠지는 게 아니다").
--
-- update 정책도 이번에 같이 추가한다 — 기존에는 select/insert/delete만 있고
-- update가 없어서, "동일 종목 재등록 시 매수정보 갱신"(app/api/dashboard/
-- holdings/route.ts POST의 update 분기)이 RLS에 막혀 조용히 실패하고
-- 있었을 가능성이 있다(이번 hidden 토글에도 update가 필요해 같이 고침).
-- ════════════════════════════════════════════════════════════════════════

alter table public.dashboard_holdings
  add column if not exists hidden boolean not null default false;

create policy "본인 대시보드 보유종목만 수정" on public.dashboard_holdings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
