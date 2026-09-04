// 클라이언트 검색 요청기 — 디바운스 + 이전 요청 취소(AbortController) + 요청 시퀀스 비교 (2026-09-04 검색 개선 1번).
//
// 배경: 헤더/랜딩/대시보드/포트폴리오진단/종목진단 5곳이 각자 setTimeout 200ms 디바운스만 두고 취소·순서
// 보장이 없어, 부분 입력("삼성", 후보 많아 느림)의 응답이 최신 입력("삼성전자", 빠름)보다 늦게 도착해
// 화면을 덮어쓰는 레이스가 실측됐다(100ms 간격 발사 시 네 응답이 0.80~0.85s에 동시 도착).
// 규칙: 새 검색이 시작되면 (1) 대기 중 타이머 취소, (2) 진행 중 fetch abort, (3) 시퀀스 증가 — 응답이
// 돌아왔을 때 자신의 시퀀스가 최신이 아니면 콜백을 호출하지 않는다. 순수 TS라 vitest로 검증한다.

export const STOCK_SEARCH_DEBOUNCE_MS = 200;

export interface SearchResultRow {
  ticker: string;
  name: string;
  isOverseas?: boolean;
  market?: string;
  currency?: string;
}

export interface StockSearcher {
  // onResult는 "이 호출이 최신 검색일 때만" 호출된다. 빈 쿼리는 즉시 onResult([])를 부른다.
  search(query: string, onResult: (rows: SearchResultRow[], query: string) => void, onError?: (e: unknown) => void): void;
  cancel(): void;
}

export interface StockSearcherOptions {
  debounceMs?: number;
  fetchImpl?: typeof fetch;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export function createStockSearcher(opts: StockSearcherOptions = {}): StockSearcher {
  const debounceMs = opts.debounceMs ?? STOCK_SEARCH_DEBOUNCE_MS;
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const setT = opts.setTimeoutImpl ?? setTimeout;
  const clearT = opts.clearTimeoutImpl ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let seq = 0;

  const cancel = () => {
    if (timer !== undefined) { clearT(timer); timer = undefined; }
    if (controller) { controller.abort(); controller = null; }
    seq++;
  };

  return {
    cancel,
    search(query, onResult, onError) {
      cancel();
      const q = query.trim();
      if (!q) { onResult([], q); return; }
      const mySeq = seq;
      timer = setT(async () => {
        timer = undefined;
        if (mySeq !== seq) return;
        const c = new AbortController();
        controller = c;
        try {
          const res = await fetchImpl(`/api/search?q=${encodeURIComponent(q)}`, { signal: c.signal });
          if (mySeq !== seq) return;
          const data = res.ok ? await res.json() : [];
          if (mySeq !== seq) return;
          onResult(Array.isArray(data) ? data : [], q);
        } catch (e) {
          if (c.signal.aborted || mySeq !== seq) return; // 취소된 요청의 AbortError는 조용히 무시
          onError?.(e);
        } finally {
          if (controller === c) controller = null;
        }
      }, debounceMs);
    },
  };
}

// 국내만·최대 n건 — 대시보드/포트폴리오진단/종목진단 공통 필터.
export function filterDomestic<T extends { isOverseas?: boolean }>(rows: T[], limit = 6): T[] {
  return rows.filter((r) => !r.isOverseas).slice(0, limit);
}
