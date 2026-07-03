-- ════════════════════════════════════════════════════════════════════════
-- contact_submissions: 문의 폼(제휴 문의 등) 제출 기록 테이블
--
-- 배경: app/api/contact/route.ts가 이 테이블에 insert를 시도하는데,
--       테이블이 애초에 없어서 저장이 매번 조용히 실패하고 있었음.
--       (이메일 발송은 되니까 겉으로는 정상 작동하는 것처럼 보였음)
-- ════════════════════════════════════════════════════════════════════════

-- 1단계: 테이블 생성 — 문의 폼에 입력하는 값 + IP 주소 + 제출 시각을 저장
create table if not exists public.contact_submissions (
  id         uuid        default gen_random_uuid() primary key,  -- 각 문의의 고유 ID (자동 생성)
  name       text        not null,                                -- 이름
  email      text        not null,                                -- 이메일
  category   text,                                                 -- 문의 유형 (선택 항목이라 not null 아님)
  subject    text        not null,                                -- 제목
  message    text        not null,                                -- 문의 내용
  ip_address text,                                                 -- 제출한 사람의 IP (스팸 추적·rate limiting용)
  created_at timestamptz default now()                            -- 제출 시각 (자동 기록)
);

-- 2단계: 인덱스 생성 — "이 IP가 최근 1시간 동안 몇 번 제출했는지" 조회를 빠르게 하기 위함
--        (rate limiting 기능이 매 요청마다 이 조건으로 조회하므로 필요)
create index if not exists contact_submissions_ip_created_idx
  on public.contact_submissions (ip_address, created_at);

-- 3단계: RLS(Row Level Security) 켜기 — 별도 접근 허용 규칙을 안 만들었으므로
--        결과적으로 "서버 쪽 서비스 롤 키를 가진 코드만 접근 가능, 브라우저에서 직접 접근 불가"가 됨
--        (지금 API 라우트는 서비스 롤 키를 쓰니 문제없이 계속 동작함)
alter table public.contact_submissions enable row level security;
