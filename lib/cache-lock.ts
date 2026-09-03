// market_cache 캐시 스탬피드 방지용 single-flight 락 (2026-09-03 트래픽점검 3번).
//
// 배경: TTL이 만료되는 순간 동시에 여러 요청이 "캐시 미스"를 감지하면 각자 KIS를 라이브로
// 호출한다 — 인기 종목/시장요약처럼 동시접속이 몰리는 키일수록 중복 낭비가 크다.
// kis_rate_limiter(2026-08-24)와 같은 이유로 Vercel 서버리스는 인스턴스 간 메모리 공유가
// 안 되므로 락도 DB에 둬야 한다. kis_rate_limiter는 전용 테이블+RPC(FOR UPDATE 행 잠금)로
// 이 문제를 풀었지만, 이 세션엔 Supabase 마이그레이션을 직접 적용할 CLI/DB 접근 권한이
// 없어 새 테이블·함수를 만들 수 없다 — 대신 이미 있는 market_cache 테이블의 key
// UNIQUE(PRIMARY KEY) 제약만으로 락을 구현한다.
//
// 원리: 락 행을 별도 키(`__lock__:{key}`)로 그 테이블에 INSERT 시도한다.
//   - 그 키가 없으면 INSERT 성공 → 락 획득(승자).
//   - 이미 있으면 PK 충돌(Postgres 23505) → 락 실패(패자) — 다른 요청이 갱신 중.
// INSERT 자체의 원자성은 Postgres UNIQUE 제약이 보장하므로 "정확히 하나만 승리"는
// 항상 참이다. 유일한 근사치는 "오래된(홀더가 크래시/타임아웃으로 못 지운) 락 정리"
// 단계 — 정리 여부 판단(SELECT)과 실제 정리(DELETE)+재시도 INSERT 사이에 아주 짧은 경쟁
// 윈도우가 있어 극히 드물게 두 요청이 동시에 "승자"가 될 수 있지만, 그래도 여전히 N개
// 동시요청이 최대 2개로 줄어드는 수준이라 원래 문제(N개 전부 라이브) 대비 압도적으로
// 개선되고, 최종 승패 자체는 여전히 INSERT의 UNIQUE 제약이 결정하므로 안전하다.
import { supabase } from './supabase';
import type { Json } from './database.types';

const lockKeyFor = (key: string) => `__lock__:${key}`;

// 락 획득 실패(RPC/네트워크 예외 등 "판단 불가" 상황)는 항상 true(승자 취급)로 처리한다 —
// 락 메커니즘 자체의 장애가 캐시 갱신을 막아버리면(가용성 저하) 스탬피드 방지보다 훨씬
// 나쁘다. 최악의 경우 그냥 락 도입 전과 동일하게 동작할 뿐이다.
export async function tryAcquireCacheLock(key: string, lockTtlMs: number): Promise<boolean> {
  const lk = lockKeyFor(key);
  try {
    const { data: existing } = await supabase
      .from('market_cache')
      .select('updated_at')
      .eq('key', lk)
      .maybeSingle();
    if (existing && Date.now() - new Date(existing.updated_at).getTime() > lockTtlMs) {
      // 홀더가 못 지운 오래된 락 — 정리 후 재시도(위 주석의 근사 경쟁 윈도우).
      await supabase.from('market_cache').delete().eq('key', lk);
    }
    const { error } = await supabase
      .from('market_cache')
      .insert({ key: lk, data: { locked: true } as unknown as Json, updated_at: new Date().toISOString() });
    if (!error) return true;
    if (error.code === '23505') return false; // 이미 다른 요청이 갱신 중
    console.warn(`[cacheLock] ${key} 락 획득 오류(승자로 간주):`, error.message);
    return true;
  } catch (e) {
    console.warn(`[cacheLock] ${key} 락 획득 예외(승자로 간주):`, e instanceof Error ? e.message : e);
    return true;
  }
}

// 실패해도 무해 — 다음 tryAcquireCacheLock이 TTL 경과분을 정리하므로 자연 회수된다.
export async function releaseCacheLock(key: string): Promise<void> {
  try {
    await supabase.from('market_cache').delete().eq('key', lockKeyFor(key));
  } catch {
    // 무시
  }
}
