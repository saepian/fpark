// 범용 DB 기반(Supabase) 레이트리밋 — market_cache 테이블에 CAS(compare-and-swap,
// PostgREST의 update().eq(읽은 updated_at))로 토큰버킷을 근사 구현한다.
//
// 2026-09-03 트래픽점검 4번(lib/kis-api.ts의 trySoftUserSlot — KIS 유저 소프트캡)에서
// 검증한 패턴을 범용화했다. 전용 테이블+RPC(FOR UPDATE 행 잠금, kis_rate_limiter와
// 동일 방식)가 원칙적으로 더 깔끔하지만, 이 세션엔 Supabase 마이그레이션을 적용할
// CLI/DB 접근 권한이 없어(lib/cache-lock.ts와 동일한 제약) 새 테이블/함수를 만들 수
// 없다 — 대신 이미 있는 market_cache 테이블에 낙관적 동시성 제어(CAS)로 구현한다.
// UPDATE...WHERE 자체는 Postgres 행 단위로 원자적이라 "내가 읽은 시점 그대로인 행만
// 갱신"이 보장되고, 매치 실패(그 사이 다른 요청이 먼저 갱신)하면 재시도(최대 5회, 새로
// 읽은 상태로 다시 계산)한다.
//
// 실패 정책: DB 조회/쓰기 자체가 에러나면 허용 쪽으로 샌다(가용성 우선 — 레이트리밋
// 인프라 장애가 기능 전체를 막으면 안 됨). 반면 CAS 재시도를 전부 소진(=매번 경쟁으로
// 실패)했다면 이건 판단 불가가 아니라 "지금 이 키를 자주 두드리고 있다"는 신호이므로
// 거부 쪽으로 처리한다(트래픽점검 4번과 동일한 판단).
import { supabase } from './supabase';
import type { Json } from './database.types';

const CAS_RETRIES = 5;

export async function tryConsumeRateLimit(
  key: string,
  ratePerSec: number,
  burst: number,
): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
      const now = Date.now();
      const { data: row } = await supabase
        .from('market_cache')
        .select('data, updated_at')
        .eq('key', key)
        .maybeSingle();

      const prevTokens = row ? Number((row.data as { tokens?: number } | null)?.tokens ?? burst) : burst;
      const lastRefillMs = row ? new Date(row.updated_at).getTime() : now;
      const elapsedSec = Math.max(0, (now - lastRefillMs) / 1000);
      const tokens = Math.min(burst, prevTokens + elapsedSec * ratePerSec);
      const allowed = tokens >= 1;
      const nextTokens = allowed ? tokens - 1 : tokens;
      const nowIso = new Date(now).toISOString();

      if (!row) {
        // 이 key로 첫 요청 — INSERT 시도, PK 충돌(23505)이면 다른 요청이 방금 먼저
        // 만든 것이니 재시도(이번엔 read에서 그 행을 보게 된다).
        const { error } = await supabase
          .from('market_cache')
          .insert({ key, data: { tokens: nextTokens } as unknown as Json, updated_at: nowIso });
        if (!error) return allowed;
        if (error.code === '23505') continue;
        return true; // 그 외 에러 — 허용(가용성 우선)
      }

      const { data: updated, error } = await supabase
        .from('market_cache')
        .update({ data: { tokens: nextTokens } as unknown as Json, updated_at: nowIso })
        .eq('key', key)
        .eq('updated_at', row.updated_at)
        .select('key');
      if (error) return true; // DB 에러 — 허용(가용성 우선, 판단 불가)
      if (updated && updated.length > 0) return allowed; // CAS 성공
      // CAS 실패(경쟁) — 짧게 쉬고 새 상태로 재시도
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 15));
    }
    // 재시도를 다 썼는데도 매번 경쟁으로 실패했다는 건 이 키가 지금 자주 눌리고 있다는
    // 신호다 — 허용 쪽으로 새면 막으려던 상황을 못 막으므로 거부 쪽으로 판단한다.
    return false;
  } catch (e) {
    console.warn(`[rate-limit] ${key} 확인 실패, 허용으로 처리:`, e instanceof Error ? e.message : e);
    return true;
  }
}
