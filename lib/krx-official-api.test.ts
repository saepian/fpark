// lib/krx-official-api.ts 목 응답 기반 유닛테스트. 실제 API 인증키가 아직 없어(2026-08-21
// 기준 활용신청 대기 중) 여기서는 fetch를 목업해 응답 파싱/정규화 로직만 검증한다.
// TODO(인증키 발급 후): 실제 API 응답으로 이 파일의 목 응답 형태(특히 srtnCd의 "A" 접두사
// 여부, mrktCtg의 실제 값)를 재확인하고 필요하면 목 데이터를 실제 형태로 갱신할 것.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchKrxListedInfoOfficial } from './krx-official-api';

function mockResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function successBody(items: unknown[], totalCount?: number) {
  return {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' },
      body: {
        totalCount: totalCount ?? items.length,
        items: { item: items },
      },
    },
  };
}

beforeEach(() => {
  vi.stubEnv('DATA_GO_KR_KRX_LISTED_INFO_KEY', 'test-decoding-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('fetchKrxListedInfoOfficial — 정상 응답 파싱', () => {
  it('KOSPI/KOSDAQ 혼합 응답을 각 시장으로 정확히 분류한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(successBody([
      { srtnCd: '005930', itmsNm: '삼성전자', mrktCtg: 'KOSPI' },
      { srtnCd: '035720', itmsNm: '카카오', mrktCtg: 'KOSDAQ' },
    ]))));

    const items = await fetchKrxListedInfoOfficial();
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.ticker === '005930')).toEqual({ ticker: '005930', name: '삼성전자', market: 'KOSPI' });
    expect(items.find((i) => i.ticker === '035720')).toEqual({ ticker: '035720', name: '카카오', market: 'KOSDAQ' });
  });

  it('결과가 1건이면 item이 배열이 아니라 객체 단독으로 와도 정상 처리한다 (data.go.kr 흔한 패턴)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({
      response: {
        header: { resultCode: '00' },
        body: { totalCount: 1, items: { item: { srtnCd: '005930', itmsNm: '삼성전자', mrktCtg: 'KOSPI' } } },
      },
    })));

    const items = await fetchKrxListedInfoOfficial();
    expect(items).toEqual([{ ticker: '005930', name: '삼성전자', market: 'KOSPI' }]);
  });

  it('srtnCd의 "A" 접두사를 제거해 6자리 티커로 정규화한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(successBody([
      { srtnCd: 'A005930', itmsNm: '삼성전자', mrktCtg: 'KOSPI' },
    ]))));

    const items = await fetchKrxListedInfoOfficial();
    expect(items).toEqual([{ ticker: '005930', name: '삼성전자', market: 'KOSPI' }]);
  });

  it.each([
    ['KOSPI', 'KOSPI'],
    ['코스피', 'KOSPI'],
    ['유가증권', 'KOSPI'],
    ['KOSDAQ', 'KOSDAQ'],
    ['코스닥', 'KOSDAQ'],
  ])('mrktCtg="%s"를 %s로 정규화한다', async (raw, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(successBody([
      { srtnCd: '005930', itmsNm: '테스트', mrktCtg: raw },
    ]))));

    const items = await fetchKrxListedInfoOfficial();
    expect(items).toEqual([{ ticker: '005930', name: '테스트', market: expected }]);
  });

  it('KONEX 등 알 수 없는 시장구분은 제외한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(successBody([
      { srtnCd: '005930', itmsNm: '코스피종목', mrktCtg: 'KOSPI' },
      { srtnCd: '900001', itmsNm: '코넥스종목', mrktCtg: 'KONEX' },
    ]))));

    const items = await fetchKrxListedInfoOfficial();
    expect(items).toHaveLength(1);
    expect(items[0].ticker).toBe('005930');
  });

  it('ticker가 6자리 숫자가 아니거나 종목명이 없으면 제외한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(successBody([
      { srtnCd: '005930', itmsNm: '정상종목', mrktCtg: 'KOSPI' },
      { srtnCd: 'ABC123', itmsNm: '이상한코드', mrktCtg: 'KOSPI' },
      { srtnCd: '000660', itmsNm: '', mrktCtg: 'KOSPI' },
    ]))));

    const items = await fetchKrxListedInfoOfficial();
    expect(items).toEqual([{ ticker: '005930', name: '정상종목', market: 'KOSPI' }]);
  });
});

describe('fetchKrxListedInfoOfficial — 기준일(basDt) 재시도', () => {
  it('첫 basDt(오늘)가 0건이면 하루 전으로 재시도해서 성공한다', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) return mockResponse(successBody([]));
      return mockResponse(successBody([{ srtnCd: '005930', itmsNm: '삼성전자', mrktCtg: 'KOSPI' }]));
    }));

    const items = await fetchKrxListedInfoOfficial();
    expect(items).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('5일 연속 0건이면 에러를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(successBody([]))));
    await expect(fetchKrxListedInfoOfficial()).rejects.toThrow('최근 5일간 유효한 데이터를 받지 못함');
  });
});

describe('fetchKrxListedInfoOfficial — 에러 처리', () => {
  it('API 키가 설정되지 않으면 즉시 에러를 던진다(fetch 호출 안 함)', async () => {
    vi.stubEnv('DATA_GO_KR_KRX_LISTED_INFO_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchKrxListedInfoOfficial()).rejects.toThrow('DATA_GO_KR_KRX_LISTED_INFO_KEY 미설정');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resultCode가 "00"이 아니면(인증 오류 등) 날짜 재시도 없이 즉시 에러를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({
      response: { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } },
    })));

    await expect(fetchKrxListedInfoOfficial()).rejects.toThrow(/resultCode=30/);
  });

  it('HTTP 에러 응답이면 에러를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse({}, false, 500)));
    await expect(fetchKrxListedInfoOfficial()).rejects.toThrow('HTTP 500');
  });
});
