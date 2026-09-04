// 레이스컨디션 재현 — "삼→삼성→삼성전→삼성전자"를 100ms 간격으로 입력하고, 서버 응답을 일부러 역순(느린
// 부분 입력이 나중에 도착)으로 돌려도 최신 입력의 결과만 반영되는지.
import { describe, it, expect, vi } from 'vitest';
import { createStockSearcher, filterDomestic } from './stock-search-client';

function makeFetch(delays: Record<string, number>, log: string[]) {
  return vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
    const q = decodeURIComponent(new URL(url, 'http://x').searchParams.get('q')!);
    log.push(`start:${q}`);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delays[q] ?? 50);
      init?.signal?.addEventListener('abort', () => { clearTimeout(t); log.push(`abort:${q}`); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
    log.push(`done:${q}`);
    return { ok: true, json: async () => [{ ticker: q, name: `result-of-${q}` }] } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('createStockSearcher — 디바운스 + abort + 시퀀스', () => {
  it('100ms 간격 타이핑: 디바운스 200ms 안의 입력은 요청 자체를 안 보내고, 마지막 입력만 1회 요청한다', async () => {
    vi.useFakeTimers();
    const log: string[] = []; const applied: string[] = [];
    const s = createStockSearcher({ fetchImpl: makeFetch({}, log) });
    for (const q of ['삼', '삼성', '삼성전', '삼성전자']) { s.search(q, (rows) => applied.push(rows[0]?.ticker)); await vi.advanceTimersByTimeAsync(100); }
    await vi.advanceTimersByTimeAsync(500);
    expect(log.filter((l) => l.startsWith('start:'))).toEqual(['start:삼성전자']);
    expect(applied).toEqual(['삼성전자']);
    vi.useRealTimers();
  });

  it('느린 이전 요청이 진행 중일 때 새 입력이 오면 abort되고, 최신 응답만 반영된다', async () => {
    vi.useFakeTimers();
    const log: string[] = []; const applied: string[] = [];
    const s = createStockSearcher({ fetchImpl: makeFetch({ '삼성': 1500, '삼성전자': 100 }, log) });
    s.search('삼성', (rows) => applied.push(rows[0]?.ticker));
    await vi.advanceTimersByTimeAsync(250);            // 디바운스 통과 → "삼성" 요청 시작(1.5s 걸림)
    s.search('삼성전자', (rows) => applied.push(rows[0]?.ticker));
    await vi.advanceTimersByTimeAsync(2000);
    expect(log).toContain('abort:삼성');
    expect(applied).toEqual(['삼성전자']);
    vi.useRealTimers();
  });

  it('abort를 지원하지 않는 fetch라도(응답이 나중에 도착) 시퀀스 비교로 오래된 응답은 무시된다', async () => {
    vi.useFakeTimers();
    const applied: string[] = [];
    // abort 리스너를 무시하는 fetch — 예전 요청이 그냥 늦게 완료된다
    const fetchNoAbort = vi.fn(async (url: string) => { const q = decodeURIComponent(new URL(url, 'http://x').searchParams.get('q')!); await new Promise((r) => setTimeout(r, q === '삼성' ? 1500 : 100)); return { ok: true, json: async () => [{ ticker: q, name: q }] } as unknown as Response; }) as unknown as typeof fetch;
    const s = createStockSearcher({ fetchImpl: fetchNoAbort });
    s.search('삼성', (rows) => applied.push(rows[0]?.ticker));
    await vi.advanceTimersByTimeAsync(250);
    s.search('삼성전자', (rows) => applied.push(rows[0]?.ticker));
    await vi.advanceTimersByTimeAsync(3000);
    expect(applied).toEqual(['삼성전자']);
    vi.useRealTimers();
  });

  it('빈 쿼리는 즉시 [] 콜백 + 진행 중 요청 취소, 에러는 onError로만', async () => {
    vi.useFakeTimers();
    const log: string[] = []; const applied: unknown[] = []; const errors: unknown[] = [];
    const s = createStockSearcher({ fetchImpl: makeFetch({ '삼성': 1000 }, log) });
    s.search('삼성', (rows) => applied.push(rows), (e) => errors.push(e));
    await vi.advanceTimersByTimeAsync(250);
    s.search('   ', (rows) => applied.push(rows));
    await vi.advanceTimersByTimeAsync(2000);
    expect(applied).toEqual([[]]);
    expect(errors).toEqual([]); // abort는 에러로 취급하지 않는다
    expect(log).toContain('abort:삼성');
    vi.useRealTimers();
  });

  it('filterDomestic', () => {
    expect(filterDomestic([{ isOverseas: true }, {}, {}, {}], 2)).toHaveLength(2);
  });
});
