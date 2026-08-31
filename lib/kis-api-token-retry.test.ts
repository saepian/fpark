// 2026-07-10 KIS 토큰 연쇄 재발급 사고 이후 코드 리뷰에서 발견한 H1(만료 감지 누락)
// 수정을 검증하는 테스트. 실제 KIS/Supabase에 붙지 않고 fetch와 supabaseAdmin을
// 전부 목업해서, "요청 도중 토큰이 조기 만료됐다"는 상황을 인위적으로 재현한다.
//
// 검증 대상:
// 1) assertKisTokenValid가 EGW00123/EGW00121만 KisTokenExpiredError로 분류하는지
// 2) withKisTokenRetry가 KisTokenExpiredError일 때만 정확히 한 번 재시도하는지
//    (그 외 에러는 재시도 없이 즉시 전파 — "실패가 또 다른 실패를 유발"하지 않는지)
// 3) 실제로 고친 함수들(fetchMarketIndex, fetchCuratedMovers)이 만료 감지 →
//    재발급 → 재시도 → 성공까지 끝까지 이어지는지 (end-to-end)

import { describe, it, expect, vi, beforeEach } from 'vitest';

// kis_tokens 조회는 "이미 유효한(24시간 남은) 캐시 토큰이 있다"고 답해서
// getAccessToken()이 실제 KIS 발급 엔드포인트(oauth2/tokenP)까지 가지 않고
// 캐시 경로로 바로 빠지게 한다 — 이 테스트가 보려는 건 발급 로직이 아니라
// "발급받은 토큰이 개별 조회 도중 조기 만료 판정났을 때의 재시도 동작"이다.
//
// mockState.tokenRow를 null로 바꾸면 "유효한 캐시 토큰 없음" 상황을,
// mockState.lockHeld를 true로 바꾸면 "다른 프로세스가 발급 락을 쥐고 있음"
// 상황을 시뮬레이션할 수 있다 (waitForLock:false 즉시 폴백 테스트용).
const mockState = vi.hoisted(() => ({
  tokenRow: null as { access_token: string; expired_at: string } | null,
  lockHeld: false,
  // 2026-08-31 추가: 발급 직후 "kis_tokens 최신 행"(KIS가 기존 토큰을 그대로 돌려줬는지
  // 대조용)과, 저장/감사로그 insert·update 페이로드 캡처.
  latestRow: null as { id: number; access_token: string; expired_at: string } | null,
  inserts: [] as any[],
  updates: [] as any[],
  saveTokenFails: false, // 2026-07-10 kis_tokens.id 시퀀스 미설정으로 실제 발생했던
                          // "토큰 저장 insert 실패"를 재현하기 위한 스위치.
}));

vi.mock('@/lib/supabase-admin', () => {
  const chain: any = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    gt: () => chain, // getAccessToken()이 발급 락 sentinel(id=-1)을 제외할 때 씀
    range: () => Promise.resolve({ data: [], error: null }),
    single: () => Promise.resolve(
      mockState.tokenRow
        ? { data: mockState.tokenRow, error: null }
        : { data: null, error: new Error('no rows') }
    ),
    maybeSingle: () => Promise.resolve(
      mockState.lockHeld
        ? { data: { expired_at: new Date(Date.now() + 8000).toISOString() }, error: null }
        : mockState.latestRow
          ? { data: mockState.latestRow, error: null }
          : { data: null, error: null }
    ),
    delete: () => chain,
    // 2026-08-31: KIS가 기존 토큰을 그대로 돌려준 경우 기존 행의 expired_at만 보정하는
    // update().eq() 경로 — bare-await되므로 chain 반환이면 충분하다(페이로드는 검증용 캡처).
    update: (payload: any) => { mockState.updates.push(payload); return chain; },
    // acquireIssueLock()이 insert 실패 후 .select().eq().maybeSingle()로 체이닝하므로
    // eq()는 (bare-await되는 delete().eq() 호출도 여전히 성립하도록) chain을 반환한다.
    eq: () => chain,
    // 락 sentinel(id=-1) insert는 lockHeld로, 새 토큰 저장 insert(id 미지정)는
    // saveTokenFails로 각각 독립적으로 실패를 흉내낼 수 있도록 payload로 구분한다.
    insert: (payload: any) => {
      mockState.inserts.push(payload);
      if (payload?.id === -1) {
        return Promise.resolve(mockState.lockHeld ? { error: new Error('conflict') } : { error: null });
      }
      return Promise.resolve(
        mockState.saveTokenFails
          ? { error: { code: '23505', message: 'duplicate key value violates unique constraint "kis_tokens_pkey"' } }
          : { error: null }
      );
    },
  };
  return { adminClient: { from: () => chain } };
});

import {
  assertKisTokenValid,
  withKisTokenRetry,
  KisTokenExpiredError,
  KisTokenIssueError,
  getAccessToken,
  invalidateAccessToken,
  parseKisTokenExpiry,
  fetchMarketIndex,
  fetchCuratedMovers,
} from './kis-api';

beforeEach(() => {
  mockState.tokenRow = { access_token: 'FAKE_VALID_TOKEN', expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
  mockState.lockHeld = false;
  mockState.saveTokenFails = false;
  mockState.latestRow = null;
  mockState.inserts.length = 0;
  mockState.updates.length = 0;
});

describe('assertKisTokenValid — 조기 만료 코드 분류', () => {
  it('EGW00123은 KisTokenExpiredError를 던진다', () => {
    expect(() => assertKisTokenValid({ msg_cd: 'EGW00123' }, 'test')).toThrow(KisTokenExpiredError);
  });
  it('EGW00121도 KisTokenExpiredError를 던진다', () => {
    expect(() => assertKisTokenValid({ msg_cd: 'EGW00121' }, 'test')).toThrow(KisTokenExpiredError);
  });
  it('무관한 코드는 던지지 않는다', () => {
    expect(() => assertKisTokenValid({ msg_cd: 'APBK0013' }, 'test')).not.toThrow();
  });
  it('msg_cd가 없으면 던지지 않는다', () => {
    expect(() => assertKisTokenValid({ rt_cd: '0' }, 'test')).not.toThrow();
  });
});

describe('withKisTokenRetry — 재시도 범위', () => {
  it('KisTokenExpiredError면 정확히 한 번만 재시도하고 두 번째 호출의 성공값을 반환한다', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new KisTokenExpiredError('만료');
      return 'ok';
    });
    const result = await withKisTokenRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('KisTokenExpiredError가 아닌 에러는 재시도 없이 즉시 전파한다', async () => {
    const fn = vi.fn(async () => { throw new Error('그냥 네트워크 에러'); });
    await expect(withKisTokenRetry(fn)).rejects.toThrow('그냥 네트워크 에러');
    expect(fn).toHaveBeenCalledTimes(1); // 재시도 안 함 — 실패가 또 다른 시도를 유발하지 않음
  });

  it('재시도까지도 실패하면 두 번만 호출되고 에러가 전파된다(무한 재시도 아님)', async () => {
    const fn = vi.fn(async () => { throw new KisTokenExpiredError('계속 만료'); });
    await expect(withKisTokenRetry(fn)).rejects.toThrow(KisTokenExpiredError);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('fetchMarketIndex — 만료 감지 후 실제 재시도 (end-to-end)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('첫 응답이 EGW00123이면 재발급 후 재시도해서 두 번째 응답을 반환한다', async () => {
    const expiredResponse = { rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다' };
    const okResponse = {
      rt_cd: '0',
      output: { bstp_nmix_prpr: '2500.12', bstp_nmix_prdy_vrss: '10.50', bstp_nmix_prdy_ctrt: '0.42', prdy_vrss_sign: '2' },
    };
    let fetchCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCalls++;
      const body = fetchCalls === 1 ? expiredResponse : okResponse;
      return { ok: true, json: async () => body } as Response;
    }));

    const result = await fetchMarketIndex('0001');
    expect(result.value).toBe(2500.12);
    expect(fetchCalls).toBe(2); // 첫 시도(만료 감지) + 재시도(성공) — 딱 2번
  });

  it('계속 EGW00123이면 두 번만 시도하고 KisTokenExpiredError로 실패한다(폭주 안 함)', async () => {
    const expiredResponse = { rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다' };
    let fetchCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCalls++;
      return { ok: true, json: async () => expiredResponse } as Response;
    }));

    await expect(fetchMarketIndex('0001')).rejects.toThrow(KisTokenExpiredError);
    expect(fetchCalls).toBe(2);
  });
});

describe('fetchCuratedMovers — 배치 중간 만료 감지 (end-to-end)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('첫 배치에서 만료를 감지하면 전체를 재시도해서 정상 결과를 반환한다', async () => {
    const expiredResponse = { rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다' };
    const okResponse = (price: number, rate: number) => ({
      rt_cd: '0',
      output: {
        hts_kor_isnm: '테스트종목', stck_prpr: String(price),
        prdy_ctrt: String(Math.abs(rate)), prdy_vrss_sign: rate >= 0 ? '2' : '5',
      },
    });

    let round = 0; // 1회차 = 전부 만료, 2회차(재시도) = 전부 성공
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      // 배치 경계(10개)를 지나면 1회차 안에서도 "라운드"를 넘긴 것으로 취급하지 않도록,
      // round는 fetchCuratedMovers가 통째로 재호출될 때만(withKisTokenRetry) 넘어가야
      // 하므로, 첫 호출부터 몇 번째 fetch인지로 판단한다.
      round++;
      if (round === 1) return { ok: true, json: async () => expiredResponse } as Response;
      return { ok: true, json: async () => okResponse(1000 + round, 1.5) } as Response;
    }));

    const result = await fetchCuratedMovers(3);
    // 재시도 이후엔 전부 성공 응답이라 gainers가 채워져야 한다
    expect(result.gainers.length).toBeGreaterThan(0);
  });
});

// 2026-07-10 락 대기 폴링(최대 약 9.6초)이 /api/market의 8초 타임아웃과 충돌해
// 진행 중이던 발급 요청이 통째로 잘리던 문제 수정 검증. waitForLock:false로
// 호출하면 락이 걸려 있을 때 대기 없이 즉시 실패해야, 호출부(캐시/야후 폴백 등)가
// 자기 타임아웃 예산 안에서 빠르게 대체 경로로 넘어갈 수 있다.
describe('getAccessToken — waitForLock:false 즉시 폴백', () => {
  it('유효한 캐시 토큰이 없고 다른 프로세스가 발급 락을 쥐고 있으면, 대기하지 않고 즉시 KisTokenIssueError를 던진다', async () => {
    vi.resetModules();
    mockState.tokenRow = null; // Supabase에 재사용 가능한 캐시 토큰 없음 → 락 획득 시도로 진행
    mockState.lockHeld = true; // 다른 프로세스가 이미 유효한 락을 쥐고 있음

    const before = Date.now();
    const fresh = await import('./kis-api');
    await expect(fresh.getAccessToken({ waitForLock: false })).rejects.toThrow(fresh.KisTokenIssueError);
    // 락 대기 폴링(최대 12회 * ~650~800ms ≈ 9.6초)을 타지 않고 즉시 실패해야 한다
    expect(Date.now() - before).toBeLessThan(2000);
  });
});

// 2026-07-10 kis_tokens.id 시퀀스 미설정으로 새 토큰 저장 insert가 매번 PK 충돌로
// 실패했는데도, insert()의 error 반환값을 확인하지 않아 "[KIS] 새 토큰 저장 완료"
// 성공 로그가 계속 찍히던 버그의 수정을 검증한다 — 실패면 실패 로그만, 성공이면
// 성공 로그만 찍혀야 하고 둘이 같은 경로에서 동시에 찍히면 안 된다.
describe('getAccessToken — 토큰 저장 insert 실패 시 로그 정확성', () => {
  it('insert가 실패하면 실패 로그만 남기고 성공 로그는 찍지 않는다 (그래도 발급 자체는 KIS에서 받은 토큰을 반환)', async () => {
    vi.resetModules();
    mockState.tokenRow = null; // 유효한 캐시 토큰 없음 → 새로 발급하는 경로로 진행
    mockState.lockHeld = false; // 락은 정상 획득
    mockState.saveTokenFails = true; // DB insert만 실패 시뮬레이션(PK 충돌 재현)

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'NEW_TOKEN_FROM_KIS', expires_in: 86400 }),
    } as Response)));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const fresh = await import('./kis-api');
    const token = await fresh.getAccessToken();

    // DB 저장은 실패해도 KIS에서 실제로 받은 토큰은 정상 반환된다(인메모리 캐시는 살아있음)
    expect(token).toBe('NEW_TOKEN_FROM_KIS');

    const allLogMessages = logSpy.mock.calls.map((c) => c[0]);
    const allErrorMessages = errorSpy.mock.calls.map((c) => c[0]);
    expect(allLogMessages).not.toContain('[KIS] 새 토큰 저장 완료, 만료:');
    expect(allErrorMessages).toContain('[KIS] 토큰 저장 실패(insert 에러):');

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('insert가 성공하면 성공 로그가 찍히고 실패 로그는 찍히지 않는다', async () => {
    vi.resetModules();
    mockState.tokenRow = null;
    mockState.lockHeld = false;
    mockState.saveTokenFails = false; // 정상 저장

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'NEW_TOKEN_FROM_KIS_2', expires_in: 86400 }),
    } as Response)));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const fresh = await import('./kis-api');
    const token = await fresh.getAccessToken();
    expect(token).toBe('NEW_TOKEN_FROM_KIS_2');

    const allLogMessages = logSpy.mock.calls.map((c) => c[0]);
    const allErrorMessages = errorSpy.mock.calls.map((c) => c[0]);
    expect(allLogMessages).toContain('[KIS] 새 토큰 저장 완료, 만료:');
    expect(allErrorMessages).not.toContain('[KIS] 토큰 저장 실패(insert 에러):');

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});

// 2026-08-31 KIS 토큰 재발급 재조사 후속 — 발급 응답 처리 회귀 테스트.
// 실측 배경: KIS는 유효기간 내 재요청 시 "기존 토큰을 그대로" 돌려준다(같은 날 16:07
// 프로덕션이 받은 토큰이 다른 프로세스가 11:44에 받은 것과 문자열까지 동일). 그런데
// 만료를 now+expires_in으로 계산해 저장하면 실제 만료보다 늦게 기록돼 죽은 토큰을
// 유효한 줄 알고 쓰는 구간이 생긴다. 또 tokenP 호출 이력이 kis_tokens 저장 성패와
// 무관하게 남아야 "몇 번 발급됐는지"를 DB로 정확히 알 수 있다.
describe('getAccessToken — 발급 응답 처리 (2026-08-31)', () => {
  const kisIssueResponse = {
    access_token: 'ISSUED_TOKEN_qVSQuwZA',
    token_type: 'Bearer',
    expires_in: 86400,
    access_token_token_expired: '2026-09-01 11:44:33', // KIS 벽시계(KST)
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockState.tokenRow = null; // DB에 유효 토큰 없음 → 발급 경로로 진입
    await invalidateAccessToken(); // 이전 테스트가 남긴 인메모리 캐시 제거
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => kisIssueResponse, text: async () => '',
    } as Response)));
  });

  it('parseKisTokenExpiry — KIS "YYYY-MM-DD HH:mm:ss"(KST)를 절대시각으로 변환, 이상 형식은 null', () => {
    expect(parseKisTokenExpiry('2026-09-01 11:44:33')?.toISOString()).toBe('2026-09-01T02:44:33.000Z');
    expect(parseKisTokenExpiry('2026-09-01T11:44:33')?.toISOString()).toBe('2026-09-01T02:44:33.000Z');
    expect(parseKisTokenExpiry('')).toBeNull();
    expect(parseKisTokenExpiry(undefined)).toBeNull();
    expect(parseKisTokenExpiry('9/1/2026')).toBeNull();
  });

  it('만료시각은 expires_in 계산이 아니라 KIS access_token_token_expired를 그대로 저장한다', async () => {
    const token = await getAccessToken();
    expect(token).toBe('ISSUED_TOKEN_qVSQuwZA');
    const saved = mockState.inserts.find((p) => p?.access_token === 'ISSUED_TOKEN_qVSQuwZA');
    expect(saved).toBeTruthy();
    expect(saved.expired_at).toBe('2026-09-01T02:44:33.000Z'); // now+86400s가 아님
  });

  it('KIS가 kis_tokens 최신 행과 동일한 토큰을 돌려주면 새 행을 만들지 않고 만료시각만 보정한다', async () => {
    mockState.latestRow = { id: 53, access_token: 'ISSUED_TOKEN_qVSQuwZA', expired_at: '2026-09-01T07:07:57.945+00:00' };
    await getAccessToken();
    expect(mockState.inserts.some((p) => p?.access_token === 'ISSUED_TOKEN_qVSQuwZA')).toBe(false); // 중복 행 없음
    expect(mockState.updates).toEqual([{ expired_at: '2026-09-01T02:44:33.000Z' }]);
    const audit = mockState.inserts.find((p) => p?.outcome !== undefined);
    expect(audit.same_as_previous).toBe(true);
  });

  it('발급 성공 시 kis_token_issue_log에 outcome=succeeded 감사 행이 남는다(사유·토큰tail·KIS만료 포함)', async () => {
    await getAccessToken();
    const audit = mockState.inserts.find((p) => p?.outcome !== undefined);
    expect(audit).toMatchObject({
      outcome: 'succeeded', reason: 'no-db-token', http_status: 200,
      token_tail: 'qVSQuwZA', kis_expired_at: '2026-09-01T02:44:33.000Z', same_as_previous: false,
    });
    expect(audit.finished_at).toBeTruthy();
  });

  it('KIS가 발급을 거부(EGW00133 등 4xx)해도 감사 행은 outcome=failed로 반드시 남는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 403, json: async () => ({}), text: async () => '{"error_code":"EGW00133"}',
    } as Response)));
    await expect(getAccessToken()).rejects.toThrow(KisTokenIssueError);
    const audit = mockState.inserts.find((p) => p?.outcome !== undefined);
    expect(audit).toMatchObject({ outcome: 'failed', http_status: 403 });
    expect(audit.message).toContain('EGW00133');
    // 토큰 행은 없음 — 발급 락 sentinel(id=-1, access_token:'LOCK')은 토큰 행이 아니므로 제외
    expect(mockState.inserts.some((p) => p?.access_token && p?.id !== -1)).toBe(false);
  });
});
