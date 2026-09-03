// 2026-09-03 뉴스 논조 추이 크론 정지 검증 — NEWS_SENTIMENT_CRON_DISABLED 가드가
// 인증 통과 후에도 실제 처리(KIS/Naver 호출, DB upsert)로 진입하지 않고 skipped를
// 반환하는지 확인한다. supabase-admin/kis-api/news-selection/news-sentiment는
// 가드가 먼저 return하면 절대 호출되지 않아야 하므로 모킹하지 않고 spy로만 확인한다.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';

const originalEnv = process.env.CRON_SECRET;

describe('GET /api/cron/news-sentiment — 정지 가드', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
  });

  it('인증 헤더 없으면 401', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('https://fpark.com/api/cron/news-sentiment');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('인증 통과해도 정지 가드에 걸려 실제 처리 없이 skipped:true 반환', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('https://fpark.com/api/cron/news-sentiment', {
      headers: { authorization: 'Bearer test-secret' },
    });
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: true, reason: 'disabled' });
  });

  it('정지 상태에서는 supabase/KIS/뉴스 모듈을 전혀 건드리지 않는다', async () => {
    vi.resetModules();
    const supabaseSpy = vi.fn();
    vi.doMock('@/lib/supabase-admin', () => ({
      adminClient: new Proxy({}, { get: () => supabaseSpy }),
    }));
    const kisSpy = vi.fn();
    vi.doMock('@/lib/kis-api', () => ({
      CURATED_TICKERS_MKT: [['005930', 'KOSPI']],
      STOCK_NAMES: { '005930': '삼성전자' },
      fetchStockPrice: kisSpy,
    }));
    const newsSpy = vi.fn();
    vi.doMock('@/lib/news-selection', () => ({ selectRelevantNews: newsSpy }));
    const sentimentSpy = vi.fn();
    vi.doMock('@/lib/news-sentiment', () => ({
      classifyNewsSentiment: sentimentSpy,
      computeSentimentScore: sentimentSpy,
    }));

    const { GET } = await import('./route');
    const req = new NextRequest('https://fpark.com/api/cron/news-sentiment', {
      headers: { authorization: 'Bearer test-secret' },
    });
    await GET(req);

    expect(supabaseSpy).not.toHaveBeenCalled();
    expect(kisSpy).not.toHaveBeenCalled();
    expect(newsSpy).not.toHaveBeenCalled();
    expect(sentimentSpy).not.toHaveBeenCalled();

    vi.doUnmock('@/lib/supabase-admin');
    vi.doUnmock('@/lib/kis-api');
    vi.doUnmock('@/lib/news-selection');
    vi.doUnmock('@/lib/news-sentiment');
  });

  afterAll(() => {
    process.env.CRON_SECRET = originalEnv;
  });
});
