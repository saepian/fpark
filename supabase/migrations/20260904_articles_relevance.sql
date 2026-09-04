-- ════════════════════════════════════════════════════════════════════════
-- articles: 수집 기사 관련성 플래그 (2026-09-04 메인 뉴스 품질 개선 B-1)
--
-- fetch-news 크론이 RSS로 모은 기사 제목/요약을 Haiku 1회 호출로 일괄 스코어링해
-- 투자/시장 관련성(0~10)과 홍보성 여부(보도자료·지역행사·이벤트·인사·MOU·[게시판]/
-- [포토] 등)를 저장한다. 삭제하지 않고 플래그만 두어 메인(/api/news)에서만 제외 —
-- 기존 행은 null/false로 남아 노출에 영향 없음(백필은 별도 스크립트).
-- ════════════════════════════════════════════════════════════════════════

alter table public.articles
  add column if not exists relevance_score smallint,
  add column if not exists is_promotional boolean not null default false;

-- 메인 목록은 항상 is_promotional=false 조건 + published_at 정렬이라 부분 인덱스로 충분
create index if not exists articles_visible_published_idx
  on public.articles (published_at desc)
  where is_promotional = false;
