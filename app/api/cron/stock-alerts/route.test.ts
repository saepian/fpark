// 2026-08-17(광복절 대체공휴일)에 관심기업 알림이 휴장일에도 발송된 장애의 수정 검증.
// route.ts의 isMarketOpen()은 요일+시각만 확인해 평일 공휴일을 걸러내지 못했다 —
// daily-alert-email/market-cache-warm과 동일하게 getDomesticMarketDayContext()로 앵커
// 종목(삼성전자) 차트를 확인해 조기 스킵하는 게이트를 추가했다. lib/market-day-context.test.ts가
// 판정 로직 자체(휴장일 인식이 정확한지)는 이미 검증하므로, 여기서는 route.ts가 그 판정
// 결과를 실제로 "언제 스킵하고 언제 진행하는지"에 맞게 배선했는지 GET 핸들러 전체를
// 목업 의존성으로 end-to-end 실행해 확인한다.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const CRON_SECRET = 'test-cron-secret';

const mockState = vi.hoisted(() => ({
  anchorChart: [] as { date: string }[],
  priceByTicker: {} as Record<string, { name: string; price: number; changeRate: number }>,
  upsertPayloads: [] as any[],
}));

vi.mock('@/lib/kis-api', () => ({
  fetchDailyChart: vi.fn(async () => mockState.anchorChart),
  fetchStockPrice: vi.fn(async (ticker: string) => {
    const hit = mockState.priceByTicker[ticker];
    if (!hit) throw new Error(`no mock price for ${ticker}`);
    return { ticker, name: hit.name, price: hit.price, changeRate: hit.changeRate, change: 0, volume: 0, tradingValue: '', sector: '', market: 'KOSPI' };
  }),
  getAccessToken: vi.fn(async () => 'FAKE_TOKEN'),
}));

vi.mock('@/lib/supabase-admin', () => {
  // users 조회: .select('id').eq('plan','pro') — 체인 마지막이 await되므로 Promise를 반환해야 함.
  const usersChain: any = { select: () => usersChain, eq: () => Promise.resolve({ data: [{ id: 'user-1' }], error: null }) };
  const watchlistChain: any = {
    select: () => watchlistChain,
    in: () => watchlistChain,
    or: () => Promise.resolve({ data: [{ user_id: 'user-1', ticker: '005930', name: '삼성전자' }], error: null }),
  };
  const notificationsSelectChain: any = {
    select: () => notificationsSelectChain,
    in: () => notificationsSelectChain,
    eq: () => Promise.resolve({ data: [], error: null }),
  };
  const notificationsUpsertChain: any = {
    select: () => Promise.resolve({ data: mockState.upsertPayloads.map((_, i) => ({ id: `n${i}` })), error: null }),
  };

  return {
    adminClient: {
      from: (table: string) => {
        if (table === 'users') return usersChain;
        if (table === 'watchlist') return watchlistChain;
        if (table === 'notifications') {
          return {
            select: () => notificationsSelectChain,
            update: () => ({ in: () => Promise.resolve({ error: null }) }),
            upsert: (payload: any[]) => {
              mockState.upsertPayloads.push(...payload);
              return notificationsUpsertChain;
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
  };
});

// fetchInvestorFlow는 kis-api.ts에 있지 않고 route.ts 내부에서 KIS inquire-investor를
// 직접 fetch()하므로, 전역 fetch를 스텁해 항상 임계값(1000억) 미만의 무의미한 수급으로
// 응답시켜 이 테스트가 가격 변동 알림 하나에만 집중하게 한다.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  json: async () => ({ rt_cd: '0', output: [{ frgn_ntby_tr_pbmn: '0', orgn_ntby_tr_pbmn: '0', stck_bsop_date: '20260814' }] }),
} as Response)));

const { GET } = await import('./route');

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/stock-alerts', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  mockState.anchorChart = [];
  mockState.priceByTicker = {};
  mockState.upsertPayloads.length = 0;
  vi.useFakeTimers();
});

describe('GET /api/cron/stock-alerts — 휴장일 게이트', () => {
  it('광복절 대체공휴일(2026-08-17, 월요일) 10:50 KST — 휴장으로 판정되어 조기 스킵하고 알림을 만들지 않는다', async () => {
    vi.setSystemTime(new Date('2026-08-17T10:50:00+09:00'));
    mockState.anchorChart = [{ date: '2026-08-12' }, { date: '2026-08-13' }, { date: '2026-08-14' }]; // 마지막 거래일 8/14(금)
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 70000, changeRate: 6 }; // 스킵되면 이 값은 쓰이지 않아야 함

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body).toEqual({ ok: true, skipped: true, reason: 'holiday' });
    expect(mockState.upsertPayloads.length).toBe(0);
  });

  it('정상 거래일(2026-08-18, 화요일) 10:50 KST — 스킵하지 않고 +5% 가격 알림을 정상적으로 생성한다(회귀 없음)', async () => {
    vi.setSystemTime(new Date('2026-08-18T10:50:00+09:00'));
    mockState.anchorChart = [{ date: '2026-08-14' }, { date: '2026-08-18' }]; // 오늘(8/18) 행이 있음 → 거래일
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 74000, changeRate: 6 }; // +5%/+6% 임계값 돌파

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.skipped).toBeUndefined();
    expect(body.ok).toBe(true);
    expect(mockState.upsertPayloads.length).toBeGreaterThan(0);
    const priceAlert = mockState.upsertPayloads.find((a) => a.type === 'price_up' && a.threshold === 5);
    expect(priceAlert).toBeTruthy();
    expect(priceAlert.stock_code).toBe('005930');
  });
});
