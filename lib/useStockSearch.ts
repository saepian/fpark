'use client';

// 검색 자동완성 공통 훅 — lib/stock-search-client.ts(createStockSearcher)의 React 래퍼.
// query가 바뀔 때마다 디바운스+취소+시퀀스 보장 검색을 수행하고 최신 응답만 상태에 반영한다.
//  - domesticOnly/limit: 국내만·상한(대시보드류). hasOverseas는 필터 전 응답에 해외가 있었는지(종목진단 안내문구용).
//  - suppressNext(): 다음 query 변경 1회를 검색하지 않는다(종목 선택 후 입력값을 종목명으로 바꿀 때).
//  - clear(): 진행 중 요청 취소 + 결과 비움.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createStockSearcher, filterDomestic, type SearchResultRow } from '@/lib/stock-search-client';

export interface UseStockSearchOptions {
  domesticOnly?: boolean;
  limit?: number;
}

export function useStockSearch<T extends SearchResultRow = SearchResultRow>(query: string, opts: UseStockSearchOptions = {}) {
  const { domesticOnly = false, limit } = opts;
  const searcher = useMemo(() => createStockSearcher(), []);
  const [results, setResults] = useState<T[]>([]);
  const [hasOverseas, setHasOverseas] = useState(false);
  const suppress = useRef(false);

  useEffect(() => {
    if (!query.trim()) { searcher.cancel(); setResults([]); setHasOverseas(false); return; }
    if (suppress.current) { suppress.current = false; return; }
    searcher.search(
      query,
      (rows) => {
        const typed = rows as T[];
        setHasOverseas(typed.some((r) => r.isOverseas));
        setResults(domesticOnly ? filterDomestic(typed, limit ?? 6) : limit ? typed.slice(0, limit) : typed);
      },
      () => { setResults([]); setHasOverseas(false); },
    );
  }, [query, domesticOnly, limit, searcher]);

  useEffect(() => () => searcher.cancel(), [searcher]);

  const clear = useCallback(() => { searcher.cancel(); setResults([]); setHasOverseas(false); }, [searcher]);
  const suppressNext = useCallback(() => { suppress.current = true; }, []);

  return { results, hasOverseas, clear, suppressNext };
}
