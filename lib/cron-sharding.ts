// 크론 유저 샤딩 (2026-09-03 트래픽점검 5번) — stock-alerts처럼 "전체 Pro 유저"를 매
// 실행마다 처리하는 크론이 유저 수에 비례해 처리량(KIS 호출)이 계속 늘어나는 구조일 때,
// Pro 유저 수에 따라 자동으로 N개 그룹(샤드)으로 나눠 실행 1회엔 그 중 한 그룹만
// 처리하기 위한 순수 함수들. app/api/cron/stock-alerts/route.ts에서 사용.
//
// Next App Router 라우트 파일(route.ts)은 GET/POST/dynamic/maxDuration 등 정해진
// 이름만 export할 수 있어(그 외 export가 있으면 타입 생성이 실패) 순수 로직을 별도
// lib 파일로 뺐다 — lib/market-day-context.ts와 같은 이유.

// USERS_PER_SHARD=60의 근거: stock-alerts/route.ts의 2026-08-31 실측 기반 주석
// ("15건/초 KIS 캡 안에서 Pro 30~60명부터 뒷부분이 밀림")의 상한을 그대로 "샤드 하나의
// 최대 인원"으로 삼았다 — 샤딩이 한 번 발동하면 그 즉시 각 샤드가 다시 안전 영역
// (<=60명)으로 돌아가도록 하는 임계값.
export const USERS_PER_SHARD = 60;
// 실제 크론 스케줄(vercel.json, 10분 주기)과 일치시켜야 한다 — 스케줄은 그대로 두고
// (배포타임 설정 자동화 없이) N을 "몇 틱에 한 번 도나"로만 반영하는 설계라, 여기 값이
// 틀리면 샤드 로테이션 주기가 실제 실행 주기와 어긋난다.
export const SHARD_TICK_MS = 10 * 60_000;

export function computeShardCount(proUserCount: number): number {
  return Math.max(1, Math.ceil(proUserCount / USERS_PER_SHARD));
}

// user_id(UUID 문자열)를 shardCount로 나눈 나머지로 결정론적 배정 — djb2 해시.
// 암호학적 강도는 필요 없고 그룹 간 대략 고르게만 분산되면 충분하다.
export function hashUserIdToShard(userId: string, shardCount: number): number {
  if (shardCount <= 1) return 0;
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash % shardCount);
}

// 지금이 몇 번째 10분 틱인지로 "이번 실행이 처리할 샤드"를 결정 — 별도 상태 저장 없이
// 벽시계 시각만으로 결정론적이라, 실행이 스킵되거나 재시도돼도 자연히 다음 틱에 다음
// 샤드로 넘어간다(크론 스케줄 자체가 10분 간격이라 매 실행마다 tick이 1씩 증가).
export function getCurrentShardIndex(shardCount: number, now: Date = new Date()): number {
  if (shardCount <= 1) return 0;
  const tick = Math.floor(now.getTime() / SHARD_TICK_MS);
  return tick % shardCount;
}
