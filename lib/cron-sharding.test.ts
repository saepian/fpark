// lib/cron-sharding.ts 순수 함수 검증 — 트래픽점검 5번(stock-alerts 유저 샤딩).
import { describe, it, expect } from 'vitest';
import { computeShardCount, hashUserIdToShard, getCurrentShardIndex, USERS_PER_SHARD, SHARD_TICK_MS } from './cron-sharding';

describe('computeShardCount', () => {
  it('현재 규모(전체 가입자 31명, Pro는 그 이하)에서는 항상 1(샤딩 없음)', () => {
    expect(computeShardCount(0)).toBe(1);
    expect(computeShardCount(1)).toBe(1);
    expect(computeShardCount(31)).toBe(1);
  });

  it(`USERS_PER_SHARD(${USERS_PER_SHARD}명) 이하는 1`, () => {
    expect(computeShardCount(USERS_PER_SHARD)).toBe(1);
  });

  it(`USERS_PER_SHARD를 1명 넘으면 2개 그룹으로 분할`, () => {
    expect(computeShardCount(USERS_PER_SHARD + 1)).toBe(2);
  });

  it('2*USERS_PER_SHARD 이하는 2, 넘으면 3', () => {
    expect(computeShardCount(USERS_PER_SHARD * 2)).toBe(2);
    expect(computeShardCount(USERS_PER_SHARD * 2 + 1)).toBe(3);
  });

  it('항상 1 이상(0명이어도 최소 1개 그룹)', () => {
    expect(computeShardCount(0)).toBeGreaterThanOrEqual(1);
  });
});

describe('hashUserIdToShard', () => {
  it('shardCount<=1이면 항상 0(전원 유일한 그룹)', () => {
    expect(hashUserIdToShard('user-a', 1)).toBe(0);
    expect(hashUserIdToShard('user-b', 0)).toBe(0);
    expect(hashUserIdToShard('완전히-다른-아이디', 1)).toBe(0);
  });

  it('같은 userId는 항상 같은 샤드로 결정론적 배정(같은 실행 내 일관성)', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const first = hashUserIdToShard(id, 5);
    for (let i = 0; i < 20; i++) expect(hashUserIdToShard(id, 5)).toBe(first);
  });

  it('결과가 항상 [0, shardCount) 범위 안', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `user-${i}-${Math.random().toString(36).slice(2)}`);
    for (const shardCount of [2, 3, 5, 7]) {
      for (const id of ids) {
        const shard = hashUserIdToShard(id, shardCount);
        expect(shard).toBeGreaterThanOrEqual(0);
        expect(shard).toBeLessThan(shardCount);
      }
    }
  });

  it('대량 유저 아이디를 N개 그룹에 분산시키면 그룹별 인원이 대략 고르다(완전 균등은 아니어도 한쪽으로 쏠리지 않음)', () => {
    const N = 4;
    const counts = new Array(N).fill(0);
    const total = 4000;
    for (let i = 0; i < total; i++) {
      const id = `11111111-2222-3333-4444-${String(i).padStart(12, '0')}`;
      counts[hashUserIdToShard(id, N)]++;
    }
    const expected = total / N;
    for (const c of counts) {
      // 완전 균등(정확히 1/N)은 아니어도 각 그룹이 기대값의 절반~1.5배 범위 안엔 있어야 함
      expect(c).toBeGreaterThan(expected * 0.5);
      expect(c).toBeLessThan(expected * 1.5);
    }
  });
});

describe('getCurrentShardIndex', () => {
  it('shardCount<=1이면 항상 0(모든 실행이 유일한 샤드를 처리 = 샤딩 없음과 동일)', () => {
    expect(getCurrentShardIndex(1, new Date('2026-09-03T09:00:00+09:00'))).toBe(0);
    expect(getCurrentShardIndex(1, new Date('2026-09-03T09:10:00+09:00'))).toBe(0);
    expect(getCurrentShardIndex(0, new Date())).toBe(0);
  });

  it('실제 크론 스케줄(10분 간격) 연속 실행 시 shardCount=2면 0,1,0,1...로 정확히 교대한다', () => {
    const base = new Date('2026-09-03T09:00:00+09:00').getTime();
    const indices = Array.from({ length: 6 }, (_, i) => getCurrentShardIndex(2, new Date(base + i * SHARD_TICK_MS)));
    expect(indices).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('shardCount=3이면 10분 간격 실행마다 0,1,2를 순환한다', () => {
    const base = new Date('2026-09-03T09:00:00+09:00').getTime();
    const indices = Array.from({ length: 6 }, (_, i) => getCurrentShardIndex(3, new Date(base + i * SHARD_TICK_MS)));
    expect(indices).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('같은 10분 틱 안에서는 몇 초 차이가 나도 같은 샤드를 가리킨다(크론 실행이 정시에서 살짝 밀려도 안전)', () => {
    const t0 = new Date('2026-09-03T09:00:00+09:00');
    const t1 = new Date('2026-09-03T09:00:47+09:00'); // 47초 뒤, 같은 10분 틱
    expect(getCurrentShardIndex(2, t0)).toBe(getCurrentShardIndex(2, t1));
  });

  it('실행이 한 틱 스킵돼도(예: 배포 중 실패) 다음 실행은 자연히 그 다음 샤드를 가리킨다(상태 저장 불필요)', () => {
    const base = new Date('2026-09-03T09:00:00+09:00').getTime();
    const ranAt0 = getCurrentShardIndex(2, new Date(base));
    // 09:10 실행이 스킵됐다고 가정 — 다음 실제 실행은 09:20
    const ranAt2 = getCurrentShardIndex(2, new Date(base + 2 * SHARD_TICK_MS));
    expect(ranAt0).toBe(0);
    expect(ranAt2).toBe(0); // 짝수 틱은 항상 그룹 0 — 스킵되어도 그룹 배정 자체는 일관됨
  });
});
