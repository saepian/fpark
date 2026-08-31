// 2026-08-17(광복절 대체공휴일)에 관심기업 알림이 휴장일에도 발송된 장애의 수정 검증.
// route.ts의 isMarketOpen()은 요일+시각만 확인해 평일 공휴일을 걸러내지 못했다 —
// daily-alert-email/market-cache-warm과 동일하게 getDomesticMarketDayContext()로 앵커
// 종목(삼성전자) 차트를 확인해 조기 스킵하는 게이트를 추가했다. lib/market-day-context.test.ts가
// 판정 로직 자체(휴장일 인식이 정확한지)는 이미 검증하므로, 여기서는 route.ts가 그 판정
// 결과를 실제로 "언제 스킵하고 언제 진행하는지"에 맞게 배선했는지 GET 핸들러 전체를
// 목업 의존성으로 end-to-end 실행해 확인한다.
//
// 2026-08-31 추가: "오늘 새로 발생한 알림인가" 판별을 SELECT+메모리Map 대조(existingByKey/
// newlyTriggered) 방식에서 upsert_stock_alert RPC(원자적 INSERT...ON CONFLICT...RETURNING
// (xmax=0))로 교체한 뒤의 회귀 검증. 실측에서 이 SELECT+Map 구조가 같은 배치 안에 기존
// 활성 알림과 신규 알림이 섞였을 때 신규 3건을 "이미 존재"로 오분류해 텔레그램 발송이
// 통째로 스킵된 적이 있어(정확한 결함 라인은 특정 못함), 그 재발생 형태(같은 사이클에
// 기존+신규 혼재, 3사이클 연속 실행)를 그대로 재현해서 검증한다. 아래 fakeUpsertStore는
// upsert_stock_alert SQL 함수의 동작을 인메모리로 흉내낸 것 — Postgres ON CONFLICT/xmax
// 자체의 정확성은 이 테스트로 검증되지 않는다(실제 DB 라이브 검증이 담당).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const CRON_SECRET = 'test-cron-secret';

type FakeRow = {
  id: string;
  user_id: string;
  stock_code: string;
  type: string;
  threshold: number;
  notif_date: string;
  is_active: boolean;
};

function makeFakeUpsertStore() {
  const rows: FakeRow[] = [];
  let seq = 0;
  return {
    rows,
    // upsert_stock_alert RPC(supabase/migrations/20260831_notifications_atomic_upsert.sql)의
    // 동작을 그대로 흉내낸다: 오늘 이 키로 비활성 row가 있으면 스킵, 활성 row가 있으면
    // 갱신(is_new=false), 없으면 신규 삽입(is_new=true).
    upsertStockAlert(args: { p_user_id: string; p_stock_code: string; p_type: string; p_threshold: number; p_notif_date: string }) {
      const match = (r: FakeRow) =>
        r.user_id === args.p_user_id && r.stock_code === args.p_stock_code &&
        r.type === args.p_type && r.threshold === args.p_threshold && r.notif_date === args.p_notif_date;

      const inactive = rows.find(r => match(r) && !r.is_active);
      if (inactive) return { id: null, is_new: false, skipped: true };

      const active = rows.find(r => match(r) && r.is_active);
      if (active) return { id: active.id, is_new: false, skipped: false };

      const row: FakeRow = { id: `n${++seq}`, user_id: args.p_user_id, stock_code: args.p_stock_code, type: args.p_type, threshold: args.p_threshold, notif_date: args.p_notif_date, is_active: true };
      rows.push(row);
      return { id: row.id, is_new: true, skipped: false };
    },
    // 5-1(조건 미충족 비활성화)의 SELECT(오늘자 활성 row 조회) 흉내 — route.ts가 실제로
    // 넘기는 user_id/stock_code 필터(affectedUserIds/affectedStocks)를 그대로 받는다.
    selectActive(userIds: string[], stockCodes: string[], notifDate: string) {
      return rows.filter(r => userIds.includes(r.user_id) && stockCodes.includes(r.stock_code) && r.notif_date === notifDate && r.is_active);
    },
    deactivate(ids: string[]) {
      for (const r of rows) if (ids.includes(r.id)) r.is_active = false;
    },
  };
}

const mockState = vi.hoisted(() => ({
  anchorChart: [] as { date: string }[],
  priceByTicker: {} as Record<string, { name: string; price: number; changeRate: number }>,
  watchlist: [{ user_id: 'user-1', ticker: '005930', name: '삼성전자' }] as { user_id: string; ticker: string; name: string }[],
  rpcCalls: [] as { p_stock_code: string; p_type: string; p_threshold: number }[],
  telegramSent: [] as { chatId: string; text: string }[],
  telegramChatIdByUser: {} as Record<string, string | null>,
  store: null as ReturnType<typeof makeFakeUpsertStore> | null,
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

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: vi.fn(async (chatId: string, text: string) => {
    mockState.telegramSent.push({ chatId, text });
    return { ok: true };
  }),
  isBlockedByUser: () => false,
}));

vi.mock('@/lib/supabase-admin', () => {
  const usersChain: any = {
    select: () => usersChain,
    eq: () => {
      const ids = [...new Set(mockState.watchlist.map(w => w.user_id))];
      return Promise.resolve({
        data: ids.map(id => ({ id, telegram_chat_id: mockState.telegramChatIdByUser[id] ?? null })),
        error: null,
      });
    },
  };
  const watchlistChain: any = {
    select: () => watchlistChain,
    in: () => watchlistChain,
    or: () => Promise.resolve({ data: mockState.watchlist, error: null }),
  };
  // 5-1(조건 미충족 비활성화) 조회 체인 — select().in(user_id).in(stock_code).eq(notif_date).eq(is_active).
  const notificationsSelectChain: any = {
    __userIds: [] as string[],
    __stockCodes: [] as string[],
    __notifDate: '',
    select: () => notificationsSelectChain,
    in: (col: string, vals: string[]) => {
      if (col === 'user_id') notificationsSelectChain.__userIds = vals;
      if (col === 'stock_code') notificationsSelectChain.__stockCodes = vals;
      return notificationsSelectChain;
    },
    eq: (col: string, val: unknown) => {
      if (col === 'notif_date') {
        notificationsSelectChain.__notifDate = val;
        return notificationsSelectChain;
      }
      // col === 'is_active'
      return Promise.resolve({
        data: mockState.store!.selectActive(notificationsSelectChain.__userIds, notificationsSelectChain.__stockCodes, notificationsSelectChain.__notifDate),
        error: null,
      });
    },
  };

  return {
    adminClient: {
      from: (table: string) => {
        if (table === 'users') return usersChain;
        if (table === 'watchlist') return watchlistChain;
        if (table === 'notifications') {
          return {
            select: () => notificationsSelectChain,
            update: (payload: { is_active: boolean }) => ({
              in: (_col: string, ids: string[]) => {
                if (payload.is_active === false) mockState.store!.deactivate(ids);
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      rpc: (fn: string, args: any) => {
        if (fn !== 'upsert_stock_alert') throw new Error(`unexpected rpc ${fn}`);
        mockState.rpcCalls.push({ p_stock_code: args.p_stock_code, p_type: args.p_type, p_threshold: args.p_threshold });
        return Promise.resolve({ data: [mockState.store!.upsertStockAlert(args)], error: null });
      },
    },
  };
});

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
  mockState.watchlist = [{ user_id: 'user-1', ticker: '005930', name: '삼성전자' }];
  mockState.rpcCalls.length = 0;
  mockState.telegramSent.length = 0;
  mockState.telegramChatIdByUser = {};
  mockState.store = makeFakeUpsertStore();
  vi.useFakeTimers();
});

// 수급 알림(fetchInvestorFlow)은 route.ts 내부에서 KIS inquire-investor를 직접 fetch()하므로,
// 전역 fetch를 스텁해 항상 임계값(1000억) 미만의 무의미한 수급으로 응답시켜 가격 변동
// 알림에만 집중한다.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  json: async () => ({ rt_cd: '0', output: [{ frgn_ntby_tr_pbmn: '0', orgn_ntby_tr_pbmn: '0', stck_bsop_date: '20260814' }] }),
} as Response)));

describe('GET /api/cron/stock-alerts — 휴장일 게이트', () => {
  it('광복절 대체공휴일(2026-08-17, 월요일) 10:50 KST — 휴장으로 판정되어 조기 스킵하고 알림을 만들지 않는다', async () => {
    vi.setSystemTime(new Date('2026-08-17T10:50:00+09:00'));
    mockState.anchorChart = [{ date: '2026-08-12' }, { date: '2026-08-13' }, { date: '2026-08-14' }]; // 마지막 거래일 8/14(금)
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 70000, changeRate: 6 }; // 스킵되면 이 값은 쓰이지 않아야 함

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body).toEqual({ ok: true, skipped: true, reason: 'holiday' });
    expect(mockState.rpcCalls.length).toBe(0);
  });

  it('정상 거래일(2026-08-18, 화요일) 10:50 KST — 스킵하지 않고 +5% 가격 알림을 정상적으로 생성한다(회귀 없음)', async () => {
    vi.setSystemTime(new Date('2026-08-18T10:50:00+09:00'));
    mockState.anchorChart = [{ date: '2026-08-14' }, { date: '2026-08-18' }]; // 오늘(8/18) 행이 있음 → 거래일
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 74000, changeRate: 6 }; // +5%/+6% 임계값 돌파

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.skipped).toBeUndefined();
    expect(body.ok).toBe(true);
    expect(mockState.rpcCalls.length).toBeGreaterThan(0);
    const priceAlert = mockState.rpcCalls.find((a) => a.p_type === 'price_up' && a.p_threshold === 5);
    expect(priceAlert).toBeTruthy();
    expect(priceAlert!.p_stock_code).toBe('005930');
  });
});

describe('GET /api/cron/stock-alerts — 원자적 upsert 신규/기존 판별(2026-08-31 재설계)', () => {
  const CYCLE_1 = '2026-08-18T09:10:00+09:00'; // 화요일, 거래일
  const CYCLE_2 = '2026-08-18T09:20:00+09:00';
  const CYCLE_3 = '2026-08-18T09:30:00+09:00';

  beforeEach(() => {
    mockState.watchlist = [
      { user_id: 'user-1', ticker: '005930', name: '삼성전자' },
      { user_id: 'user-1', ticker: '000660', name: 'SK하이닉스' },
      { user_id: 'user-1', ticker: '005380', name: '현대차' },
    ];
    mockState.anchorChart = [{ date: '2026-08-14' }, { date: '2026-08-18' }];
    mockState.telegramChatIdByUser = { 'user-1': 'chat-1' };
  });

  it('실제 8/31 사고 재현 — 같은 사이클에 "기존 활성 알림"과 "신규 알림"이 섞여도 신규만 텔레그램 발송된다', async () => {
    // 사이클 1: 005930만 -5% 돌파(기존 발생시켜둠), 000660/005380은 아직 임계값 미달.
    vi.setSystemTime(new Date(CYCLE_1));
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 100000, changeRate: -5 };
    mockState.priceByTicker['000660'] = { name: 'SK하이닉스', price: 200000, changeRate: -1 };
    mockState.priceByTicker['005380'] = { name: '현대차', price: 300000, changeRate: -1 };
    await GET(makeRequest());
    expect(mockState.telegramSent.length).toBe(1);
    expect(mockState.telegramSent[0].text).toContain('삼성전자');
    mockState.telegramSent.length = 0;

    // 사이클 2(10분 뒤): 005930은 계속 -5%(기존 유지), 000660·005380이 처음으로 -5% 돌파(신규).
    // → 실제 8/31 사고와 동일한 모양: 배치 3건(005930 유지 + 000660/005380 신규) 중 신규만 발송돼야 함.
    vi.setSystemTime(new Date(CYCLE_2));
    mockState.priceByTicker['000660'] = { name: 'SK하이닉스', price: 190000, changeRate: -5.5 };
    mockState.priceByTicker['005380'] = { name: '현대차', price: 285000, changeRate: -5.2 };
    const res2 = await GET(makeRequest());
    const body2 = await res2.json();

    expect(body2.telegramSent).toBe(2); // 000660, 005380만
    expect(body2.telegramFailed).toBe(0);
    expect(mockState.telegramSent.length).toBe(2);
    const texts = mockState.telegramSent.map(t => t.text);
    expect(texts.some(t => t.includes('SK하이닉스'))).toBe(true);
    expect(texts.some(t => t.includes('현대차'))).toBe(true);
    expect(texts.some(t => t.includes('삼성전자'))).toBe(false); // 기존 유지분은 재발송 안 됨
  });

  it('3사이클 연속 실행 — 매 사이클 신규/기존/비활성화가 정확히 구분된다', async () => {
    // 사이클 1: 005930이 -12%(price_down 5%·10% 두 티어 동시 돌파) → 신규 2건 발송.
    vi.setSystemTime(new Date(CYCLE_1));
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 88000, changeRate: -12 };
    mockState.priceByTicker['000660'] = { name: 'SK하이닉스', price: 200000, changeRate: -1 };
    mockState.priceByTicker['005380'] = { name: '현대차', price: 300000, changeRate: -1 };
    const res1 = await GET(makeRequest());
    expect((await res1.json()).telegramSent).toBe(2);
    mockState.telegramSent.length = 0;

    // 사이클 2: 005930이 -7%로 회복(5% 티어는 유지, 10% 티어는 조건 미충족 → 비활성화 대상)
    // + 000660이 신규로 -5% 돌파. → 신규 1건(000660)만 발송, 005930의 10% 알림은 꺼져야 함.
    vi.setSystemTime(new Date(CYCLE_2));
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 93000, changeRate: -7 };
    mockState.priceByTicker['000660'] = { name: 'SK하이닉스', price: 190000, changeRate: -5.5 };
    const res2 = await GET(makeRequest());
    const body2 = await res2.json();
    expect(body2.telegramSent).toBe(1);
    expect(mockState.telegramSent[0].text).toContain('SK하이닉스');
    mockState.telegramSent.length = 0;

    const samsung10 = mockState.store!.rows.find(r => r.stock_code === '005930' && r.threshold === 10);
    const samsung5   = mockState.store!.rows.find(r => r.stock_code === '005930' && r.threshold === 5);
    expect(samsung10?.is_active).toBe(false); // 조건 미충족 → 비활성화
    expect(samsung5?.is_active).toBe(true);   // 여전히 -5% 이하라 유지

    // 사이클 3: 005930·000660 계속 유지(재발송 안 됨) + 005380이 신규로 -5% 돌파.
    vi.setSystemTime(new Date(CYCLE_3));
    mockState.priceByTicker['005380'] = { name: '현대차', price: 285000, changeRate: -5.2 };
    const res3 = await GET(makeRequest());
    const body3 = await res3.json();
    expect(body3.telegramSent).toBe(1);
    expect(mockState.telegramSent[0].text).toContain('현대차');
  });

  it('오늘 이미 알린 뒤 비활성화된 임계값을 재돌파해도 재알림하지 않는다(일 단위 리셋 정책, 회귀 없음)', async () => {
    mockState.watchlist = [{ user_id: 'user-1', ticker: '005930', name: '삼성전자' }];

    // 사이클 1: -5% 돌파 → 발송.
    vi.setSystemTime(new Date(CYCLE_1));
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 100000, changeRate: -5 };
    await GET(makeRequest());
    expect(mockState.telegramSent.length).toBe(1);
    mockState.telegramSent.length = 0;

    // 사이클 2: -3%로 회복 → 비활성화.
    vi.setSystemTime(new Date(CYCLE_2));
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 103000, changeRate: -3 };
    await GET(makeRequest());

    // 사이클 3: 다시 -5% 재돌파 → 오늘 안엔 재알림하지 않아야 함(스킵).
    vi.setSystemTime(new Date(CYCLE_3));
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 100000, changeRate: -5.2 };
    const res3 = await GET(makeRequest());
    const body3 = await res3.json();

    expect(body3.telegramSent).toBe(0);
    expect(mockState.telegramSent.length).toBe(0);
  });
});
