import { NextResponse } from 'next/server';
import { fetchMarketIndex, fetchUsdKrw } from '../../../lib/kis-api';
import { supabase } from '../../../lib/supabase';
import type { MarketResponse, MarketIndexData } from '../../../lib/types';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'market_indices';

async function fetchUsdKrwWithFallback(): Promise<MarketIndexData | null> {
  // 1순위: KIS API
  try {
    return await fetchUsdKrw();
  } catch (e) {
    console.warn('[MARKET] fetchUsdKrw 실패, manana.kr 시도:', e instanceof Error ? e.message : e);
  }

  // 2순위: manana.kr 공개 환율 API
  try {
    const res = await fetch('https://api.manana.kr/exchange/rate/KRW/USD.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.rate) {
      return { value: data[0].rate, change: 0, changeRate: 0 };
    }
  } catch (e) {
    console.warn('[MARKET] manana.kr 환율 조회 실패:', e instanceof Error ? e.message : e);
  }

  return null;
}

async function fetchNasdaq(): Promise<MarketIndexData | null> {
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=1d',
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      }
    );
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    const price = meta.regularMarketPrice as number;
    const prev  = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
    const change     = meta.regularMarketChange     ?? (price - prev);
    const changeRate = meta.regularMarketChangePercent ?? (prev > 0 ? ((price - prev) / prev) * 100 : 0);
    return { value: price, change, changeRate };
  } catch (e) {
    console.warn('[MARKET] NASDAQ 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchLive(): Promise<MarketResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const [kospiResult, kosdaqResult, usdKrwResult, nasdaqResult] = await Promise.allSettled([
      fetchMarketIndex('0001', controller.signal),
      fetchMarketIndex('1001', controller.signal),
      fetchUsdKrwWithFallback(),
      fetchNasdaq(),
    ]);
    clearTimeout(timeout);

    if (kospiResult.status === 'rejected') console.error('[MARKET] KOSPI 실패:', kospiResult.reason);
    if (kosdaqResult.status === 'rejected') console.error('[MARKET] KOSDAQ 실패:', kosdaqResult.reason);

    if (kospiResult.status !== 'fulfilled' || kosdaqResult.status !== 'fulfilled') {
      throw new Error('지수 조회 실패');
    }

    console.log('[MARKET] live — KOSPI:', kospiResult.value.value, 'KOSDAQ:', kosdaqResult.value.value);

    return {
      KOSPI:   kospiResult.value,
      KOSDAQ:  kosdaqResult.value,
      USD_KRW: usdKrwResult.status === 'fulfilled' ? usdKrwResult.value : null,
      NASDAQ:  nasdaqResult.status === 'fulfilled' ? nasdaqResult.value : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getCache(): Promise<MarketResponse | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .single();
    if (!cache) return null;
    return { ...(cache.data as MarketResponse), isCached: true, cachedAt: cache.updated_at };
  } catch {
    return null;
  }
}

export async function GET() {
  // 항상 KIS API 조회 시도 — 장중/장후 무관하게 종가 조회 가능
  try {
    const live = await fetchLive();
    if (live.KOSPI.value > 0) {
      void supabase.from('market_cache').upsert({
        key: CACHE_KEY,
        data: { KOSPI: live.KOSPI, KOSDAQ: live.KOSDAQ, USD_KRW: live.USD_KRW, NASDAQ: live.NASDAQ },
        updated_at: new Date().toISOString(),
      });
      return NextResponse.json({ ...live, isCached: false, cachedAt: null });
    }
    throw new Error('KOSPI value is 0');
  } catch (e) {
    console.error('[MARKET] KIS 실패, 캐시로 폴백:', e instanceof Error ? e.message : e);
  }

  const cached = await getCache();
  if (cached) return NextResponse.json(cached);

  return NextResponse.json({ error: '시장 데이터를 불러올 수 없습니다.' }, { status: 503 });
}
