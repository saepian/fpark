// 내부 전용: 같은 KIS 앱키를 쓰는 외부 프로젝트(video-pipeline)에 fpark의 단일 토큰 캐시를
// 공유하는 엔드포인트 — 2026-08-31 재발급 사고(두 프로젝트가 각자 캐시를 관리하다 서로의
// 토큰을 무효화하며 하루 4회 발급) 대응. docs/kis-token-sharing.md 참고.
//
// 설계 원칙
// - 별도 발급 경로가 아니다: lib/kis-api.ts getAccessTokenWithExpiry() → getAccessToken()의
//   인메모리→kis_tokens→분산락→발급 경로를 그대로 탄다. 따라서 이 엔드포인트를 아무리 자주
//   호출해도 "캐시 히트"일 뿐 KIS tokenP 호출 횟수를 늘리지 못한다(남용 방지의 핵심).
// - 인증은 전용 시크릿(KIS_TOKEN_SHARE_SECRET) — CRON_SECRET과 분리해 독립적으로 폐기·교체
//   가능. 비교는 timingSafeEqual(길이 다르면 즉시 불일치).
// - 시크릿 미설정 시 503으로 기능 자체를 닫는다(잘못된 배포로 무방비 노출되는 것 방지).
// - GET만, 파라미터 없음, no-store. 호출자 식별용 X-KIS-Client 헤더를 로그에 남긴다.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAccessTokenWithExpiry, KisTokenIssueError } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

function secretMatches(header: string | null, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest) {
  const secret = process.env.KIS_TOKEN_SHARE_SECRET;
  if (!secret) {
    console.error('[internal/kis-token] KIS_TOKEN_SHARE_SECRET 미설정 — 엔드포인트 비활성');
    return NextResponse.json({ error: 'disabled' }, { status: 503 });
  }
  if (!secretMatches(request.headers.get('authorization'), secret)) {
    console.warn('[internal/kis-token] Unauthorized:', request.headers.get('authorization') ? 'wrong secret' : 'missing Authorization');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = request.headers.get('x-kis-client') ?? 'unknown';
  try {
    // waitForLock:true — 다른 인스턴스가 발급 중이면 잠깐 기다렸다가 그 결과를 재사용한다
    // (외부 호출자가 성급히 실패해 자체 발급으로 돌아가는 일이 없어야 하므로).
    const { token, expiresAt } = await getAccessTokenWithExpiry({ waitForLock: true });
    console.log(`[internal/kis-token] 토큰 공유 — client=${client} expiresAt=${expiresAt}`);
    return NextResponse.json(
      { access_token: token, expires_at: expiresAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    // KIS 발급 자체가 거부된 경우(주로 EGW00133 "1분당 1회") — 호출자는 잠시 후 재시도해야
    // 하며, 절대 자체 발급으로 우회하면 안 된다(그게 오늘 사고의 원인).
    const status = e instanceof KisTokenIssueError ? 503 : 500;
    console.error(`[internal/kis-token] 실패 — client=${client}:`, e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'token_unavailable', retry_after_seconds: 65 },
      { status, headers: { 'Cache-Control': 'no-store', 'Retry-After': '65' } },
    );
  }
}
