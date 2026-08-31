// 2026-09-01 배당 요약 캐시 오염 사고(삼성전자 005930 등 배당이 있는 종목 10건이 8/28
// "무배당"으로 7일 캐싱돼 기업분석 "요약" 탭이 통째로 사라짐) 이후 추가한 회귀 테스트.
// 실제 DART/Supabase에 붙지 않고 fetch와 supabase createClient를 목업해서,
// "DART가 확정해 준 결과(000/013)"만 캐싱되고 "일시 실패(HTTP 오류·타임아웃·한도 초과·
// corp_code 맵 로드 실패)"는 null을 돌려주되 캐시에는 남기지 않는지 검증한다.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  corpMapRow: { data: { '005930': '00126380', '000660': '00164779' }, updated_at: new Date().toISOString() } as
    | { data: Record<string, string>; updated_at: string }
    | null,
  corpMapFails: false,
  upserts: [] as any[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      let key = '';
      const chain: any = {
        select: () => chain,
        eq: (_col: string, v: string) => { key = v; return chain; },
        single: () => {
          if (key === 'dart_corp_code_map') {
            if (mockState.corpMapFails) return Promise.reject(new Error('supabase down'));
            return Promise.resolve({ data: mockState.corpMapRow, error: null });
          }
          // dart_dividend_* — 항상 캐시 미스
          return Promise.resolve({ data: null, error: { message: 'no rows' } });
        },
        upsert: (payload: any) => { mockState.upserts.push(payload); return Promise.resolve({ error: null }); },
      };
      return chain;
    },
  }),
}));

const SAMSUNG_ROWS = [
  { se: '(연결)현금배당성향(%)', stock_knd: '-', thstrm: '25.10' },
  { se: '현금배당수익률(%)', stock_knd: '보통주', thstrm: '1.50' },
  { se: '현금배당수익률(%)', stock_knd: '우선주', thstrm: '1.90' },
  { se: '주당 현금배당금(원)', stock_knd: '보통주', thstrm: '1,668' },
  { se: '주당 현금배당금(원)', stock_knd: '우선주', thstrm: '1,669' },
];
const NO_DIVIDEND_ROWS = [
  { se: '(연결)현금배당성향(%)', stock_knd: '-', thstrm: '-' },
  { se: '현금배당수익률(%)', stock_knd: '보통주', thstrm: '-' },
  { se: '주당 현금배당금(원)', stock_knd: '보통주', thstrm: '-' },
];

type FetchPlan = (url: string) => { status?: number; body?: any; throws?: Error };
function stubFetch(plan: FetchPlan) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input);
    const r = plan(url);
    if (r.throws) throw r.throws;
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as Response;
  }));
}
const yearOf = (url: string) => new URL(url).searchParams.get('bsns_year');
const LAST_YEAR = String(new Date().getFullYear() - 1);
const YEAR_BEFORE = String(new Date().getFullYear() - 2);

async function loadFresh() {
  vi.resetModules(); // 모듈 레벨 corp_code 메모리 캐시(_memCache)를 테스트마다 초기화
  return await import('./dart-api');
}

beforeEach(() => {
  process.env.DART_API_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
  mockState.upserts = [];
  mockState.corpMapFails = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('fetchDividendSummary — 확정 결과만 캐싱', () => {
  it('정상 응답(보통주 행 존재)은 요약을 만들고 캐싱한다 (삼성전자 실측 형태)', async () => {
    stubFetch(() => ({ body: { status: '000', list: SAMSUNG_ROWS } }));
    const { fetchDividendSummary } = await loadFresh();
    const r = await fetchDividendSummary('005930');
    expect(r).toEqual({ year: LAST_YEAR, dividendYield: 1.5, dividendPerShare: 1668, payoutRatio: 25.1 });
    expect(mockState.upserts).toHaveLength(1);
    expect(mockState.upserts[0].data).toEqual({ dividendSummary: r });
  });

  it('DART가 013(데이터 없음)을 두 해 모두 돌려주면 "확정 무배당" null을 캐싱한다', async () => {
    stubFetch(() => ({ body: { status: '013', message: '조회된 데이타가 없습니다.' } }));
    const { fetchDividendSummary } = await loadFresh();
    expect(await fetchDividendSummary('005930')).toBeNull();
    expect(mockState.upserts).toHaveLength(1);
    expect(mockState.upserts[0].data).toEqual({ dividendSummary: null });
  });

  it('보고서는 있는데 값이 전부 "-"인 무배당 종목도 null을 캐싱한다', async () => {
    stubFetch(() => ({ body: { status: '000', list: NO_DIVIDEND_ROWS } }));
    const { fetchDividendSummary } = await loadFresh();
    expect(await fetchDividendSummary('005930')).toBeNull();
    expect(mockState.upserts).toHaveLength(1);
  });

  it('작년이 013이면 재작년으로 폴백하고 캐싱한다', async () => {
    stubFetch((url) => yearOf(url) === LAST_YEAR
      ? { body: { status: '013' } }
      : { body: { status: '000', list: SAMSUNG_ROWS } });
    const { fetchDividendSummary } = await loadFresh();
    const r = await fetchDividendSummary('005930');
    expect(r?.year).toBe(YEAR_BEFORE);
    expect(mockState.upserts).toHaveLength(1);
  });

  it('HTTP 오류(두 해 모두)는 null을 돌려주되 캐싱하지 않는다', async () => {
    stubFetch(() => ({ status: 503, body: {} }));
    const { fetchDividendSummary } = await loadFresh();
    expect(await fetchDividendSummary('005930')).toBeNull();
    expect(mockState.upserts).toHaveLength(0);
  });

  it('타임아웃(fetch reject)은 null을 돌려주되 캐싱하지 않는다', async () => {
    stubFetch(() => ({ throws: Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) }));
    const { fetchDividendSummary } = await loadFresh();
    expect(await fetchDividendSummary('005930')).toBeNull();
    expect(mockState.upserts).toHaveLength(0);
  });

  it('DART 한도 초과(status 020)는 null을 돌려주되 캐싱하지 않는다', async () => {
    stubFetch(() => ({ body: { status: '020', message: '요청 제한을 초과하였습니다.' } }));
    const { fetchDividendSummary } = await loadFresh();
    expect(await fetchDividendSummary('005930')).toBeNull();
    expect(mockState.upserts).toHaveLength(0);
  });

  it('작년만 일시 실패하고 재작년은 성공하면 재작년 값을 돌려주되 캐싱은 하지 않는다', async () => {
    stubFetch((url) => yearOf(url) === LAST_YEAR
      ? { status: 500, body: {} }
      : { body: { status: '000', list: SAMSUNG_ROWS } });
    const { fetchDividendSummary } = await loadFresh();
    const r = await fetchDividendSummary('005930');
    expect(r?.year).toBe(YEAR_BEFORE);
    expect(mockState.upserts).toHaveLength(0);
  });

  it('corp_code 맵 로드 실패(Supabase 오류 + 다운로드 실패)는 캐싱하지 않는다', async () => {
    mockState.corpMapFails = true;
    stubFetch((url) => url.includes('corpCode.xml')
      ? { status: 500, body: {} }
      : { body: { status: '000', list: SAMSUNG_ROWS } });
    const { fetchDividendSummary } = await loadFresh();
    expect(await fetchDividendSummary('005930')).toBeNull();
    expect(mockState.upserts).toHaveLength(0);
  });

  it('맵은 정상인데 종목이 없으면(ETF 등) DART 조회 없이 null을 확정 캐싱한다', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: '000', list: SAMSUNG_ROWS }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchDividendSummary } = await loadFresh();
    expect(await fetchDividendSummary('999999')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockState.upserts).toHaveLength(1);
    expect(mockState.upserts[0].data).toEqual({ dividendSummary: null });
  });
});
