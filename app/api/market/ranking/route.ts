import { after } from 'next/server';
import { getAccessToken } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';
import { isKoreanMarketOpen } from '@/lib/market-utils';
import { tryAcquireCacheLock, releaseCacheLock } from '@/lib/cache-lock';
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
  EXCLUDE_PATTERN,
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
  let cacheRow: { data: unknown; updated_at: string } | null = null;
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKeyFor(tab))
      .single();
    if (cache) {
      cacheRow = cache;
      const age = Date.now() - new Date(cache.updated_at).getTime();
      if (age < ttlMs) {
        console.log(`[ranking] ${tab} TTL 캐시 히트 (${Math.round(age / 1000)}s < ${ttlMs / 1000}s) — 라이브 호출 생략`);
        return Response.json(cache.data as unknown as StockRow[]);
      }
    }
  } catch (e) {
    console.warn(`[ranking] ${tab} TTL 캐시 조회 실패, 라이브로 진행:`, e instanceof Error ? e.message : e);
  }

  // 2026-09-03 트래픽점검 3번: 국내증시 페이지 5분 자동 새로고침이 여러 유저에 걸쳐
  // 겹치면 TTL 만료 순간 탭별로 스탬피드가 난다. single-flight 락을 먼저 잡아본다 —
  // 놓쳤는데 기존 값이 있으면 그 값을 즉시 서빙(SWR), 갱신은 락을 쥔 요청 하나가 맡는다.
  // 이 라우트는 tab 4종(거래대금순/거래량순/급등/급락) 각각의 라이브→저장 분기가 서로
  // 다른 곳에서 return하므로, 함수 나머지 전체를 감싸 어느 분기로 나가든 락을 반드시
  // 해제한다.
  const lockKey = cacheKeyFor(tab);
  const won = await tryAcquireCacheLock(lockKey, 10_000);
  if (!won) {
    if (cacheRow) return Response.json(cacheRow.data as unknown as StockRow[]);
    // 값 자체가 없는 진짜 콜드(최초 배포 직후 등 극히 드문 경우) — 승자의 결과를 짧게 기다린다.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const { data: polled } = await supabase.from('market_cache').select('data, updated_at').eq('key', lockKey).single();
        if (polled) return Response.json(polled.data as unknown as StockRow[]);
      } catch { /* 아직 없음 — 계속 폴링 */ }
    }
    // 폴링 타임아웃 — 최후 수단으로 직접 라이브(락은 안 쥐었으니 해제 불필요) — 아래로 낙하
  }

  try {
    return await handleTab(tab);
  } finally {
    if (won) await releaseCacheLock(lockKey);
  }
}

async function handleTab(tab: string): Promise<Response> {
  try {
    await getAccessToken();
  } catch {
    return Response.json({ error: '인증 실패' }, { status: 500 });
  }

  try {
    // ── 거래대금순 ────────────────────────────────────────────────
    if (tab === '거래대금순') {
      try {
        // 코스피만 조회하면 코스닥 거래대금 상위 종목(예: LG이노텍)이 누락된다 —
        // fetchTopTradingValueTickers(daily-alert-email용)와 동일하게 두 시장을
        // 각각 조회해 합친 뒤 거래대금 기준으로 다시 정렬한다.
        const settled = await Promise.allSettled([
          fetchFluctuation('3', 'KOSPI'),
          fetchFluctuation('3', 'KOSDAQ'),
        ]);
        const rows: any[] = [];
        for (const r of settled) {
          if (r.status === 'fulfilled') rows.push(...(r.value.output ?? []));
          else console.warn(`[ranking] ${tab} 시장 조회 실패:`, r.reason);
        }
        const validRows = rows.filter(isValidStockItem).filter((item) => !EXCLUDE_PATTERN.test(item.hts_kor_isnm ?? ''));
        if (validRows.length < rows.length) {
          console.warn(`[ranking] ${tab}: 유효성/제외 필터로 ${rows.length - validRows.length}행 제외 (${rows.length}행 → ${validRows.length}행)`);
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
        const validRows = rows.filter(isValidStockItem).filter((item) => !EXCLUDE_PATTERN.test(item.hts_kor_isnm ?? ''));
        if (validRows.length < rows.length) {
          console.warn(`[ranking] ${tab}: 유효성/제외 필터로 ${rows.length - validRows.length}행 제외 (${rows.length}행 → ${validRows.length}행)`);
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
