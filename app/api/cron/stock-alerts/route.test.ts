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
import { computeShardCount, hashUserIdToShard, getCurrentShardIndex, USERS_PER_SHARD } from '@/lib/cron-sharding';

const CRON_SECRET = 'test-cron-secret';

type FakeRow = {
  id: string;
  user_id: string;
  stock_code: string;
  type: string;
  threshold: number;
  notif_date: string;
  is_active: boolean;
  telegram_sent_at: string | null;
};

function makeFakeUpsertStore() {
  const rows: FakeRow[] = [];
  let seq = 0;
  return {
    rows,
    // upsert_stock_alert RPC(supabase/migrations/20260831_notifications_atomic_upsert.sql,
    // 20260831_notifications_telegram_retry.sql)의 동작을 그대로 흉내낸다: 오늘 이 키로
    // 비활성 row가 있으면 스킵, 활성 row가 있으면 갱신(is_new=false, 기존
    // telegram_sent_at을 그대로 반환), 없으면 신규 삽입(is_new=true, telegram_sent_at=null).
    upsertStockAlert(args: { p_user_id: string; p_stock_code: string; p_type: string; p_threshold: number; p_notif_date: string }) {
      const match = (r: FakeRow) =>
        r.user_id === args.p_user_id && r.stock_code === args.p_stock_code &&
        r.type === args.p_type && r.threshold === args.p_threshold && r.notif_date === args.p_notif_date;

      const inactive = rows.find(r => match(r) && !r.is_active);
      if (inactive) return { id: null, is_new: false, skipped: true, telegram_sent_at: null };

      const active = rows.find(r => match(r) && r.is_active);
      if (active) return { id: active.id, is_new: false, skipped: false, telegram_sent_at: active.telegram_sent_at };

      const row: FakeRow = { id: `n${++seq}`, user_id: args.p_user_id, stock_code: args.p_stock_code, type: args.p_type, threshold: args.p_threshold, notif_date: args.p_notif_date, is_active: true, telegram_sent_at: null };
      rows.push(row);
      return { id: row.id, is_new: true, skipped: false, telegram_sent_at: null };
    },
    // 5-1(조건 미충족 비활성화)의 SELECT(오늘자 활성 row 조회) 흉내 — route.ts가 실제로
    // 넘기는 user_id/stock_code 필터(affectedUserIds/affectedStocks)를 그대로 받는다.
    selectActive(userIds: string[], stockCodes: string[], notifDate: string) {
      return rows.filter(r => userIds.includes(r.user_id) && stockCodes.includes(r.stock_code) && r.notif_date === notifDate && r.is_active);
    },
    deactivate(ids: string[]) {
      for (const r of rows) if (ids.includes(r.id)) r.is_active = false;
    },
    markTelegramSent(id: string, sentAt: string) {
      const row = rows.find(r => r.id === id);
      if (row) row.telegram_sent_at = sentAt;
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
  // 비어있으면(기본) 기존처럼 watchlist의 유니크 user_id로 Pro 목록을 유도한다 — 샤딩
  // 테스트(전체 Pro 유저 수가 watchlist에 등장하는 유저 수보다 훨씬 많아야 함)만 명시적으로 채운다.
  proUsers: [] as string[],
  // 기관/외국인 수급알림 재설계(2026-09-03) 검증용 — ticker별 fetchInvestorTrend 응답을
  // 직접 제어한다. 비어있으면(기본) apiError:false, latest:null(수급 알림 없음)로 처리.
  investorTrendByTicker: {} as Record<string, { latest: { date: string; foreign: { qty: number; amount: number }; institution: { qty: number; amount: number }; individual: { qty: number; amount: number } } | null; trend: { date: string; foreign: number; institution: number; individual: number }[]; apiError: boolean }>,
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

// computeFlowMultiple은 순수 함수라 실제 구현을 그대로 쓰고(importOriginal), fetchInvestorTrend
// (KIS 네트워크 호출)만 목업한다 — 기관/외국인 수급알림 재설계(2026-09-03) 통합 검증용.
vi.mock('@/lib/stock-analysis-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stock-analysis-data')>();
  return {
    ...actual,
    fetchInvestorTrend: vi.fn(async (ticker: string) => {
      return mockState.investorTrendByTicker[ticker] ?? { latest: null, trend: [], apiError: false };
    }),
  };
});

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
      const ids = mockState.proUsers.length > 0
        ? mockState.proUsers
        : [...new Set(mockState.watchlist.map(w => w.user_id))];
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
            update: (payload: { is_active?: boolean; telegram_sent_at?: string }) => ({
              in: (_col: string, ids: string[]) => {
                if (payload.is_active === false) mockState.store!.deactivate(ids);
                return Promise.resolve({ error: null });
              },
              // 5-3(텔레그램 발송 성공 직후 telegram_sent_at 기록)이 쓰는 .eq('id', id) 경로.
              eq: (_col: string, id: string) => {
                if (payload.telegram_sent_at) mockState.store!.markTelegramSent(id, payload.telegram_sent_at);
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
  mockState.proUsers = [];
  mockState.investorTrendByTicker = {};
  mockState.store = makeFakeUpsertStore();
  vi.useFakeTimers();
});

// 2026-09-03 재설계 이후 수급 조회는 fetchInvestorTrend(위에서 목업)를 거쳐 route.ts가
// 직접 fetch()하지 않는다 — 그래도 혹시 모를 미목업 fetch 호출이 실제 네트워크로
// 새나가지 않도록 안전망으로 전역 fetch는 계속 스텁해 둔다.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  json: async () => ({ rt_cd: '0', output: [] }),
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

describe('GET /api/cron/stock-alerts — telegram_sent_at 기반 재시도(2026-08-31 오후 긴급 수정)', () => {
  const CYCLE_1 = '2026-08-18T09:10:00+09:00';
  const CYCLE_2 = '2026-08-18T09:20:00+09:00';

  beforeEach(() => {
    mockState.watchlist = [{ user_id: 'user-1', ticker: '005930', name: '삼성전자' }];
    mockState.anchorChart = [{ date: '2026-08-14' }, { date: '2026-08-18' }];
    mockState.telegramChatIdByUser = { 'user-1': 'chat-1' };
  });

  it(
    '실제 8/31 사고 재현 — 최초 삽입 시점에 텔레그램이 실패해도(is_new는 그 뒤 영원히 false) ' +
    '조건이 유지되는 한 다음 사이클에 자동 재시도된다',
    async () => {
      const { sendTelegramMessage } = await import('@/lib/telegram');
      // 사이클 1: -5% 돌파(신규 삽입) + 텔레그램 전송이 실패한다고 가정.
      vi.setSystemTime(new Date(CYCLE_1));
      mockState.priceByTicker['005930'] = { name: '삼성전자', price: 100000, changeRate: -5 };
      vi.mocked(sendTelegramMessage).mockResolvedValueOnce({ ok: false, description: 'network error' } as any);
      const res1 = await GET(makeRequest());
      const body1 = await res1.json();
      expect(body1.telegramSent).toBe(0);
      expect(body1.telegramFailed).toBe(1); // 발송 시도는 했으나 실패
      expect(mockState.telegramSent.length).toBe(0);

      // is_new는 최초 삽입 이후 계속 false이지만, telegram_sent_at이 여전히 null이므로
      // 사이클 2에서 조건이 그대로 유지되면(-5% 지속) 재시도돼야 한다 — is_new만 보던
      // 예전 로직이었다면 여기서 telegramSent가 0으로 남아 실제 사고가 재현됐을 것.
      vi.setSystemTime(new Date(CYCLE_2));
      const res2 = await GET(makeRequest());
      const body2 = await res2.json();
      expect(body2.telegramSent).toBe(1);
      expect(mockState.telegramSent.length).toBe(1);
      expect(mockState.telegramSent[0].text).toContain('삼성전자');

      // 성공한 뒤엔 telegram_sent_at이 기록돼 있어야(=다음 사이클엔 재시도 대상에서 빠짐).
      const row = mockState.store!.rows.find(r => r.stock_code === '005930' && r.threshold === 5);
      expect(row?.telegram_sent_at).toBeTruthy();
    },
  );
});

describe('GET /api/cron/stock-alerts — 유저 샤딩(2026-09-03 트래픽점검 5번)', () => {
  const CYCLE_1 = '2026-08-18T09:10:00+09:00'; // 화요일, 거래일
  const CYCLE_2 = '2026-08-18T09:20:00+09:00'; // 10분 뒤 — 다음 샤드 차례

  it(`현재 규모(USERS_PER_SHARD=${USERS_PER_SHARD}명 이하)에서는 샤딩 없이 전원 처리된다(회귀 없음)`, async () => {
    const userIds = Array.from({ length: 10 }, (_, i) => `user-${i}`);
    mockState.proUsers = userIds;
    mockState.watchlist = userIds.map((id) => ({ user_id: id, ticker: '005930', name: '삼성전자' }));
    mockState.telegramChatIdByUser = Object.fromEntries(userIds.map((id) => [id, `chat-${id}`]));
    mockState.anchorChart = [{ date: '2026-08-14' }, { date: '2026-08-18' }];
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 74000, changeRate: 6 };
    vi.setSystemTime(new Date(CYCLE_1));

    // 알림 10건이면 텔레그램 발송 루프(3개씩·300ms 간격 청크)가 여러 청크로 나뉘어
    // 실제 setTimeout을 기다린다 — 기존 소규모(≤3건) 테스트들과 달리 fake timer를
    // 명시적으로 흘려보내야 한다.
    const resultPromise = GET(makeRequest());
    await vi.runAllTimersAsync();
    const res = await resultPromise;
    const body = await res.json();

    expect(computeShardCount(userIds.length)).toBe(1);
    expect(body.telegramSent).toBe(10); // 전원 발송 — 아무도 제외되지 않음
    expect(new Set(mockState.telegramSent.map((t) => t.chatId)).size).toBe(10);
  });

  it(`Pro 유저가 ${USERS_PER_SHARD + 1}명(샤딩 임계값 초과)이면 자동으로 2개 그룹으로 나뉘어, 한 사이클엔 그중 한 그룹만 처리되고 10분 뒤 다음 사이클엔 나머지 그룹이 처리된다`, async () => {
    const userIds = Array.from({ length: USERS_PER_SHARD + 1 }, (_, i) => `user-${String(i).padStart(3, '0')}`);
    mockState.proUsers = userIds;
    mockState.watchlist = userIds.map((id) => ({ user_id: id, ticker: '005930', name: '삼성전자' }));
    mockState.telegramChatIdByUser = Object.fromEntries(userIds.map((id) => [id, `chat-${id}`]));
    mockState.anchorChart = [{ date: '2026-08-14' }, { date: '2026-08-18' }];
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 74000, changeRate: 6 };

    const shardCount = computeShardCount(userIds.length);
    expect(shardCount).toBe(2);

    // 사이클 1
    vi.setSystemTime(new Date(CYCLE_1));
    const shardIndex1 = getCurrentShardIndex(shardCount, new Date(CYCLE_1));
    const shard1Users = userIds.filter((id) => hashUserIdToShard(id, shardCount) === shardIndex1);
    const notShard1Users = userIds.filter((id) => hashUserIdToShard(id, shardCount) !== shardIndex1);
    expect(shard1Users.length).toBeGreaterThan(0);
    expect(notShard1Users.length).toBeGreaterThan(0);

    const result1Promise = GET(makeRequest());
    await vi.runAllTimersAsync();
    const res1 = await result1Promise;
    const body1 = await res1.json();
    expect(body1.telegramSent).toBe(shard1Users.length);
    const sentChatIds1 = new Set(mockState.telegramSent.map((t) => t.chatId));
    for (const id of shard1Users) expect(sentChatIds1.has(`chat-${id}`)).toBe(true);
    for (const id of notShard1Users) expect(sentChatIds1.has(`chat-${id}`)).toBe(false);

    // 사이클 2(10분 뒤) — 다른 그룹 차례
    mockState.telegramSent.length = 0;
    vi.setSystemTime(new Date(CYCLE_2));
    const shardIndex2 = getCurrentShardIndex(shardCount, new Date(CYCLE_2));
    expect(shardIndex2).not.toBe(shardIndex1); // 그룹이 실제로 교대됐는지 확인

    const result2Promise = GET(makeRequest());
    await vi.runAllTimersAsync();
    const res2 = await result2Promise;
    const body2 = await res2.json();
    const shard2Users = userIds.filter((id) => hashUserIdToShard(id, shardCount) === shardIndex2);
    expect(body2.telegramSent).toBe(shard2Users.length);
    const sentChatIds2 = new Set(mockState.telegramSent.map((t) => t.chatId));
    for (const id of shard2Users) expect(sentChatIds2.has(`chat-${id}`)).toBe(true);

    // 2개 그룹뿐이므로 두 사이클을 합치면 전체 유저를 정확히 한 번씩 커버해야 함
    expect(shard1Users.length + shard2Users.length).toBe(userIds.length);
  });
});

describe('GET /api/cron/stock-alerts — 기관/외국인 수급알림 재설계(2026-09-03, 대형주 편중 수정)', () => {
  const CYCLE_1 = '2026-08-18T09:10:00+09:00';

  // trend[0]=오늘(latest와 동일), trend[1..]=과거 20거래일 — fetchInvestorTrend(ticker, 21)의
  // 실제 반환 형태를 그대로 흉내낸다.
  function makeTrend(todayForeign: number, todayInstitution: number, priorForeign: number[], priorInstitution: number[]) {
    const trend = [
      { date: '2026-08-18', foreign: todayForeign, institution: todayInstitution, individual: 0 },
      ...priorForeign.map((f, i) => ({ date: `prior-${i}`, foreign: f, institution: priorInstitution[i], individual: 0 })),
    ];
    return {
      latest: {
        date: '2026-08-18',
        foreign: { qty: 0, amount: todayForeign },
        institution: { qty: 0, amount: todayInstitution },
        individual: { qty: 0, amount: 0 },
      },
      trend,
      apiError: false,
    };
  }

  beforeEach(() => {
    // 가격 변동 알림과 섞이지 않도록 모든 종목을 무의미한 변동(1%)으로 고정.
    mockState.anchorChart = [{ date: '2026-08-14' }, { date: '2026-08-18' }];
    vi.setSystemTime(new Date(CYCLE_1));
  });

  it('삼성전자처럼 절대금액은 압도적이어도 평소(20일 평균) 흐름 대비로는 이례적이지 않으면 알림이 안 나간다(구 설계의 대형주 편중 재현 방지)', async () => {
    mockState.watchlist = [{ user_id: 'user-1', ticker: '005930', name: '삼성전자' }];
    mockState.telegramChatIdByUser = { 'user-1': 'chat-1' };
    mockState.priceByTicker['005930'] = { name: '삼성전자', price: 70000, changeRate: 1 };
    // 평소에도 기관 순매수가 크게 오르내리는 초대형주(절대값 평균 4,500억) — 오늘
    // -7,526억은 절대금액 임계값(옛 1,000억)은 가볍게 넘지만 배수는 2.5 미만(약 1.67배).
    const prior = Array(20).fill(0).map((_, i) => (i % 2 === 0 ? 4500 : -4500));
    mockState.investorTrendByTicker['005930'] = makeTrend(-3327, -7526, prior, prior);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.total).toBe(0); // 가격도 1%라 변동 알림 없음 — 수급 알림도 없어야 함
    expect(mockState.rpcCalls.some(c => c.p_type.startsWith('foreign_') || c.p_type.startsWith('institution_'))).toBe(false);
  });

  it('중형주처럼 절대금액은 작아도 평소 대비 크게 쏠리면(배수≥2.5) 알림이 나간다(구 설계에서는 임계값 미달로 항상 누락됐음)', async () => {
    mockState.watchlist = [{ user_id: 'user-1', ticker: '047040', name: '대우건설' }];
    mockState.telegramChatIdByUser = { 'user-1': 'chat-1' };
    mockState.priceByTicker['047040'] = { name: '대우건설', price: 5000, changeRate: 1 };
    // 평소 기관 순매수 절대값 평균 20억 — 오늘 -75억은 절대금액 임계값(옛 1,000억)에는
    // 한참 못 미치지만 배수로는 3.75배(≥2.5).
    const prior = Array(20).fill(0).map((_, i) => (i % 2 === 0 ? 20 : -20));
    mockState.investorTrendByTicker['047040'] = makeTrend(0, -75, prior, prior);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.total).toBe(1);
    const institutionAlert = mockState.rpcCalls.find(c => c.p_type === 'institution_sell');
    expect(institutionAlert).toBeTruthy();
    expect(mockState.telegramSent.some(t => t.text.includes('대우건설') && t.text.includes('배)'))).toBe(true);
  });

  it('과거 데이터가 15거래일 미만(신규상장 등)이면 배수를 계산하지 않고 수급 알림을 보류한다', async () => {
    mockState.watchlist = [{ user_id: 'user-1', ticker: '999999', name: '신규상장주' }];
    mockState.priceByTicker['999999'] = { name: '신규상장주', price: 10000, changeRate: 1 };
    const shortPrior = Array(5).fill(100); // 최소 15일 미만
    mockState.investorTrendByTicker['999999'] = makeTrend(500, 500, shortPrior, shortPrior);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.total).toBe(0);
  });
});
