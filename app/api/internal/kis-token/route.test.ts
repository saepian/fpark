// 내부 전용 KIS 토큰 공유 엔드포인트(2026-08-31)의 보안 경계 검증 — 이 라우트가 fpark
// 자체 보안에 구멍을 내지 않는지: 시크릿 없으면 닫힘(503), 틀리면 401(길이 달라도 같음),
// 맞으면 lib의 getAccessTokenWithExpiry()를 그대로 경유해 토큰+만료를 반환, KIS 발급
// 거부는 503+Retry-After로 전달(호출자가 자체 발급으로 우회하지 않도록).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockState = vi.hoisted(() => ({
  result: { token: 'SHARED_TOKEN', expiresAt: '2026-09-01T02:44:33.000Z' } as { token: string; expiresAt: string | null },
  throwIssueError: false,
  calls: 0,
}));

vi.mock('@/lib/kis-api', () => {
  class KisTokenIssueError extends Error {}
  return {
    KisTokenIssueError,
    getAccessTokenWithExpiry: vi.fn(async () => {
      mockState.calls++;
      if (mockState.throwIssueError) throw new KisTokenIssueError('KIS 토큰 발급 실패 [403]: EGW00133');
      return mockState.result;
    }),
  };
});

const { GET } = await import('./route');

const SECRET = 'test-share-secret-0123456789abcdef';

function req(auth?: string, client?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  if (client) headers['x-kis-client'] = client;
  return new NextRequest('http://localhost/api/internal/kis-token', { headers });
}

beforeEach(() => {
  process.env.KIS_TOKEN_SHARE_SECRET = SECRET;
  mockState.result = { token: 'SHARED_TOKEN', expiresAt: '2026-09-01T02:44:33.000Z' };
  mockState.throwIssueError = false;
  mockState.calls = 0;
});

describe('GET /api/internal/kis-token — 인증 경계', () => {
  it('시크릿 env가 없으면 503으로 닫혀 있고 토큰 로직을 아예 타지 않는다', async () => {
    delete process.env.KIS_TOKEN_SHARE_SECRET;
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(mockState.calls).toBe(0);
  });

  it('Authorization 헤더가 없으면 401', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockState.calls).toBe(0);
  });

  it('시크릿이 틀리면(길이 같음/다름 모두) 401', async () => {
    expect((await GET(req(`Bearer ${SECRET.slice(0, -1)}X`))).status).toBe(401);
    expect((await GET(req('Bearer short'))).status).toBe(401);
    expect((await GET(req(SECRET))).status).toBe(401); // Bearer 접두어 없음
    expect(mockState.calls).toBe(0);
  });
});

describe('GET /api/internal/kis-token — 정상/실패 응답', () => {
  it('시크릿이 맞으면 lib 경로를 그대로 경유해 access_token + expires_at을 no-store로 반환한다', async () => {
    const res = await GET(req(`Bearer ${SECRET}`, 'video-pipeline'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ access_token: 'SHARED_TOKEN', expires_at: '2026-09-01T02:44:33.000Z' });
    expect(mockState.calls).toBe(1);
  });

  it('KIS가 발급을 거부하면(KisTokenIssueError) 503 + Retry-After — 호출자는 대기 후 재시도해야 한다', async () => {
    mockState.throwIssueError = true;
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('65');
    expect(await res.json()).toEqual({ error: 'token_unavailable', retry_after_seconds: 65 });
  });
});
