import { after } from 'next/server';
import { getAccessToken } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';
import { isKoreanMarketOpen } from '@/lib/market-utils';
import {
  type StockRow,
  type MarketCacheJson,
  cacheKeyFor,
  isValidStockItem,
  mapRow,
  fetchFluctuation,
  fetchNaverRanking,
  getCachedRanking,
  getLastCloseRanking,
  fetchDailyRanking,
} from '@/lib/market-ranking';

export const dynamic = 'force-dynamic';

// 2026-07-15: 이 상수가 정의만 되고 실제 TTL 게이팅에 쓰이지 않던 죽은 코드였음(캐시는
// KIS/네이버 실패 시 폴백으로만 쓰였고, 매 요청이 항상 라이브 호출이었다) — 국내증시
// 페이지 5분 자동 새로고침 도입 후 부하 문제로 실제 TTL 캐시로 전환.
const CACHE_TTL_MS_OPEN   = 60_000;      // 장중 1분 — 순위는 급격히 안 바뀜
const CACHE_TTL_MS_CLOSED = 30 * 60_000; // 장외 30분

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get('tab') || '거래대금순';

  // TTL 이내면 라이브 호출(및 KIS 인증) 없이 캐시 재사용
  const ttlMs = isKoreanMarketOpen() ? CACHE_TTL_MS_OPEN : CACHE_TTL_MS_CLOSED;
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKeyFor(tab))
      .single();
    if (cache) {
      const age = Date.now() - new Date(cache.updated_at).getTime();
      if (age < ttlMs) {
        console.log(`[ranking] ${tab} TTL 캐시 히트 (${Math.round(age / 1000)}s < ${ttlMs / 1000}s) — 라이브 호출 생략`);
        return Response.json(cache.data as unknown as StockRow[]);
      }
    }
  } catch (e) {
    console.warn(`[ranking] ${tab} TTL 캐시 조회 실패, 라이브로 진행:`, e instanceof Error ? e.message : e);
  }

  try {
    await getAccessToken();
  } catch {
    return Response.json({ error: '인증 실패' }, { status: 500 });
  }

  try {
    // ── 거래대금순 ────────────────────────────────────────────────
    if (tab === '거래대금순') {
      try {
        const data = await fetchFluctuation('0');
        const rows: any[] = data.output ?? [];
        const validRows = rows.filter(isValidStockItem);
        if (validRows.length < rows.length) {
          console.warn(`[ranking] ${tab}: 유효성 필터로 ${rows.length - validRows.length}행 제외 (${rows.length}행 → ${validRows.length}행)`);
        }
        if (validRows.length === 0) throw new Error(`${tab}: 유효 행 0개 (원본 ${rows.length}행 모두 불량)`);
        validRows.sort((a, b) => Number(b.acml_tr_pbmn) - Number(a.acml_tr_pbmn));
        const result = validRows.slice(0, 50).map(mapRow);
        after(async () => {
          const { error } = await supabase.from('market_cache').upsert({ key: cacheKeyFor(tab), data: result as unknown as MarketCacheJson, updated_at: new Date().toISOString() });
          if (error) console.warn(`[ranking] ${tab} 캐시 저장 실패:`, error.message);
        });
        return Response.json(result);
      } catch (e) {
        console.warn(`[ranking] ${tab} KIS 실패, 캐시 폴백 시도:`, e instanceof Error ? e.message : e);
        const cached = await getCachedRanking(tab);
        if (cached) return Response.json(cached);
        throw e;
      }
    }

    // ── 거래량순 ──────────────────────────────────────────────────
    if (tab === '거래량순') {
      try {
        const data = await fetchFluctuation('1');
        const rows: any[] = data.output ?? [];
        const validRows = rows.filter(isValidStockItem);
        if (validRows.length < rows.length) {
          console.warn(`[ranking] ${tab}: 유효성 필터로 ${rows.length - validRows.length}행 제외 (${rows.length}행 → ${validRows.length}행)`);
        }
        if (validRows.length === 0) throw new Error(`${tab}: 유효 행 0개 (원본 ${rows.length}행 모두 불량)`);
        validRows.sort((a, b) => Number(b.acml_vol) - Number(a.acml_vol));
        const result = validRows.slice(0, 50).map(mapRow);
        after(async () => {
          const { error } = await supabase.from('market_cache').upsert({ key: cacheKeyFor(tab), data: result as unknown as MarketCacheJson, updated_at: new Date().toISOString() });
          if (error) console.warn(`[ranking] ${tab} 캐시 저장 실패:`, error.message);
        });
        return Response.json(result);
      } catch (e) {
        console.warn(`[ranking] ${tab} KIS 실패, 캐시 폴백 시도:`, e instanceof Error ? e.message : e);
        const cached = await getCachedRanking(tab);
        if (cached) return Response.json(cached);
        throw e;
      }
    }

    // ── 급등 / 급락 ──────────────────────────────────────────────
    if (tab === '급등' || tab === '급락') {
      const cacheKey = cacheKeyFor(tab);
      const marketOpen = isKoreanMarketOpen();

      if (marketOpen) {
        // 장중 — KIS 실시간 → 네이버 → 캐시 순 폴백 (기존 로직 그대로)
        try {
          const rows = await fetchDailyRanking(tab);
          if (rows.length > 0) {
            after(async () => {
              const { error } = await supabase.from('market_cache').upsert({ key: cacheKey, data: rows as unknown as MarketCacheJson, updated_at: new Date().toISOString() });
              if (error) console.warn(`[ranking] ${tab} 캐시 저장 실패:`, error.message);
            });
            return Response.json(rows);
          }
          console.log(`[ranking] KIS ${tab}: 장중 0행, 네이버 폴백`);
        } catch (e) {
          console.warn(`[ranking] KIS ${tab} 실패:`, e instanceof Error ? e.message : e);
        }

        // 네이버 스크래핑
        try {
          const naverRows = await fetchNaverRanking(tab as '급등' | '급락');
          if (naverRows.length > 0) {
            after(async () => {
              const { error } = await supabase.from('market_cache').upsert({ key: cacheKey, data: naverRows as unknown as MarketCacheJson, updated_at: new Date().toISOString() });
              if (error) console.warn(`[ranking] ${tab} 캐시 저장 실패:`, error.message);
            });
            return Response.json(naverRows);
          }
        } catch (e) {
          console.warn(`[ranking] Naver ${tab} 실패:`, e instanceof Error ? e.message : e);
        }

        // Supabase 캐시 (만료 포함)
        const cached = await getCachedRanking(tab);
        if (cached) return Response.json(cached);

        console.warn(`[ranking] ${tab}: 장중인데 KIS/네이버/캐시 모두 사용 불가, 빈 배열 반환`);
        return Response.json([]);
      }

      // 장 시작 전/마감 후 — [2026-07-24 실측 확인] FHPST01700000는 FID_INPUT_DATE_1에
      // 과거 날짜를 넣어도 항상 0행을 반환한다(이 TR은 과거 날짜 재조회 자체를 지원하지
      // 않음) — 예전엔 이 경로가 사실상 한 번도 성공한 적이 없었다. 대신
      // market-cache-warm 크론이 장마감 직후(15:35 KST) captureLastCloseSnapshot()으로
      // 미리 찍어둔 "전일 마감" 캐시를 사용한다.
      const lastClose = await getLastCloseRanking(tab);
      if (lastClose) {
        const rows = lastClose.rows.map((r) => ({ ...r, isPrevDayClose: true, asOfDate: lastClose.tradingDate }));
        return Response.json(rows);
      }

      // lastclose 캐시가 아직 한 번도 안 채워진 극히 드문 경우(신규 배포 직후 등)의
      // 최후 수단 — 예전에 성공했던 아무 캐시나(만료 무시)
      const fallbackCached = await getCachedRanking(tab);
      if (fallbackCached) {
        const rows = fallbackCached.map((r) => ({ ...r, isPrevDayClose: true }));
        return Response.json(rows);
      }

      console.warn(`[ranking] ${tab}: 장 시작 전이고 lastclose/기존 캐시 모두 없음 — 빈 배열 반환`);
      return Response.json([]);
    }

    return Response.json([]);
  } catch (err) {
    console.error('[ranking]', err);
    return Response.json({ error: '조회 실패' }, { status: 500 });
  }
}
