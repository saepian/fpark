import { NextResponse } from 'next/server';
import { fetchMarketIndex, fetchUsdKrw } from '../../../lib/kis-api';
import { supabase } from '../../../lib/supabase';
import { isKoreanMarketOpen, getLastTradingDate } from '../../../lib/market-utils';
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

  // 2순위: open.er-api.com (무료, 안정적, API 키 불필요)
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (data.result === 'success' && data.rates?.KRW) {
      // Yahoo FX로 change/changeRate 보완 시도
      const yahoo = await fetchYahooFX('KRW=X').catch(() => null);
      if (yahoo) return yahoo;
      return { value: data.rates.KRW, change: 0, changeRate: 0 };
    }
  } catch (e) {
    console.warn('[MARKET] open.er-api.com 환율 조회 실패:', e instanceof Error ? e.message : e);
  }

  // 3순위: Yahoo Finance
  return fetchYahooFX('KRW=X').catch(() => null);
}

async function fetchYahooIndex(symbol: string): Promise<MarketIndexData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const result = data.chart?.result?.[0];
    const meta   = result?.meta;
    if (!meta?.regularMarketPrice) return null;

    const rawCloses: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const closes = rawCloses.filter((v): v is number => v != null && isFinite(v));

    const price      = meta.regularMarketPrice as number;
    const prev       = closes[closes.length - 2] ?? (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
    const change     = price - prev;
    const changeRate = prev > 0 ? ((price - prev) / prev) * 100 : 0;

    return { value: price, change, changeRate, sparkline: closes };
  } catch (e) {
    console.warn(`[MARKET] ${symbol} 조회 실패:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// 국고채 3년: Yahoo Reuters RIC 'KR3YT=RR' (1순위) → 네이버 스크래핑 (2순위)
async function fetchBond3Y(): Promise<MarketIndexData | null> {
  // 1순위: Yahoo Finance — range=5d&interval=1d, closes[-1]-closes[-2] 기반 계산
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/KR3YT%3DRR?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const result = data.chart?.result?.[0];
    const meta   = result?.meta;
    if (!meta?.regularMarketPrice) throw new Error('no price');

    const rawCloses: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const closes = rawCloses.filter((v): v is number => v != null && isFinite(v));
    if (closes.length < 2) throw new Error('closes 부족');

    const price      = meta.regularMarketPrice as number;
    const prev       = closes[closes.length - 2];
    const change     = price - prev;
    const changeRate = prev > 0 ? ((price - prev) / prev) * 100 : 0;

    console.log('[MARKET] BOND_3Y Yahoo 성공:', { price, prev, change, changeRate });
    return { value: price, change, changeRate, sparkline: closes };
  } catch (e) {
    console.warn('[MARKET] BOND_3Y Yahoo 실패, 네이버로 폴백:', e instanceof Error ? e.message : e);
  }

  // 2순위: 네이버 스크래핑
  return fetchNaverBond3Y();
}

// 네이버 금융 메인에서 국고채 3년물 현재가/변동 스크래핑
async function fetchNaverBond3Y(): Promise<MarketIndexData | null> {
  try {
    const res = await fetch('https://finance.naver.com/marketindex/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://finance.naver.com/',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(7000),
    });
    const buffer = await res.arrayBuffer();
    const html = new TextDecoder('euc-kr').decode(buffer);

    const bondIdx = html.indexOf('국고채 (3년)');
    if (bondIdx < 0) {
      console.warn('[MARKET] BOND_3Y: 국고채 (3년) 없음');
      return null;
    }

    const segment = html.slice(bondIdx, bondIdx + 600);
    const tdMatches = [...segment.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
    if (tdMatches.length < 2) return null;

    const value = parseFloat(tdMatches[0][1].trim());
    if (isNaN(value)) return null;

    const changeTd = tdMatches[1][1];
    const altMatch = changeTd.match(/alt="([^"]+)"/);
    const dir = altMatch?.[1] ?? '보합';
    const changeNum = parseFloat(changeTd.replace(/<[^>]+>/g, ' ').trim().replace(/,/g, '')) || 0;
    const change = dir === '하락' ? -Math.abs(changeNum) : Math.abs(changeNum);

    const prevValue = value - change;
    const changeRate = prevValue > 0 ? (change / prevValue) * 100 : 0;

    return { value, change, changeRate };
  } catch (e) {
    console.warn('[MARKET] BOND_3Y 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

// FX 전용: range=2d로 전일 종가를 확보하고 직접 계산
async function fetchYahooFX(symbol: string): Promise<MarketIndexData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    const price     = meta.regularMarketPrice as number;
    const prevClose = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
    const change    = price - prevClose;
    const changeRate = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    return { value: price, change, changeRate };
  } catch (e) {
    console.warn(`[MARKET] FX ${symbol} 조회 실패:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchLive(): Promise<MarketResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const [
      kospiResult, kosdaqResult, usdKrwResult,
      nasdaqResult, sp500Result, dowResult,
      nikkeiResult, hangsengResult, shanghaiResult,
      shenzhenResult, usdJpyResult, eurJpyResult,
      usdHkdResult, cnyHkdResult, usdCnyResult,
      bond3yResult,
      // KIS 실패 시 야후 폴백 (장외 시간 대비)
      kospiYahooResult, kosdaqYahooResult,
    ] = await Promise.allSettled([
      fetchMarketIndex('0001', controller.signal),
      fetchMarketIndex('1001', controller.signal),
      fetchUsdKrwWithFallback(),
      fetchYahooIndex('^IXIC'),
      fetchYahooIndex('^GSPC'),
      fetchYahooIndex('^DJI'),
      fetchYahooIndex('^N225'),
      fetchYahooIndex('^HSI'),
      fetchYahooIndex('000001.SS'),
      fetchYahooIndex('399001.SZ'),
      fetchYahooFX('JPY=X'),
      fetchYahooFX('EURJPY=X'),
      fetchYahooFX('HKD=X'),
      fetchYahooFX('CNYHKD=X'),
      fetchYahooFX('CNY=X'),
      fetchBond3Y(),
      fetchYahooIndex('^KS11'),   // KOSPI 야후 폴백
      fetchYahooIndex('^KQ11'),   // KOSDAQ 야후 폴백
    ]);
    clearTimeout(timeout);

    // KIS 성공 시 KIS 우선, 실패 시 야후 폴백
    const kisKospi  = kospiResult.status  === 'fulfilled' ? kospiResult.value  : null;
    const kisKosdaq = kosdaqResult.status === 'fulfilled' ? kosdaqResult.value : null;

    if (!kisKospi)  console.warn('[MARKET] KOSPI KIS 실패, 야후 폴백');
    if (!kisKosdaq) console.warn('[MARKET] KOSDAQ KIS 실패, 야후 폴백');

    const kospi  = kisKospi  ?? (kospiYahooResult.status  === 'fulfilled' ? kospiYahooResult.value  : null);
    const kosdaq = kisKosdaq ?? (kosdaqYahooResult.status === 'fulfilled' ? kosdaqYahooResult.value : null);

    if (kospi) console.log('[MARKET] live — KOSPI:', kospi.value, 'KOSDAQ:', kosdaq?.value);

    return {
      KOSPI:    kospi,
      KOSDAQ:   kosdaq,
      USD_KRW:  usdKrwResult.status  === 'fulfilled' ? usdKrwResult.value  : null,
      NASDAQ:   nasdaqResult.status  === 'fulfilled' ? nasdaqResult.value  : null,
      SP500:    sp500Result.status   === 'fulfilled' ? sp500Result.value   : null,
      DOW:      dowResult.status     === 'fulfilled' ? dowResult.value     : null,
      NIKKEI:   nikkeiResult.status   === 'fulfilled' ? nikkeiResult.value   : null,
      HANGSENG: hangsengResult.status === 'fulfilled' ? hangsengResult.value  : null,
      SHANGHAI: shanghaiResult.status === 'fulfilled' ? shanghaiResult.value  : null,
      SHENZHEN: shenzhenResult.status === 'fulfilled' ? shenzhenResult.value  : null,
      USDJPY:   usdJpyResult.status   === 'fulfilled' ? usdJpyResult.value   : null,
      EURJPY:   eurJpyResult.status   === 'fulfilled' ? eurJpyResult.value   : null,
      USDHKD:   usdHkdResult.status   === 'fulfilled' ? usdHkdResult.value   : null,
      CNYHKD:   cnyHkdResult.status   === 'fulfilled' ? cnyHkdResult.value   : null,
      USDCNY:   usdCnyResult.status   === 'fulfilled' ? usdCnyResult.value   : null,
      BOND_3Y:  bond3yResult.status   === 'fulfilled' ? bond3yResult.value   : null,
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
  const marketOpen  = isKoreanMarketOpen();
  const prevDate    = marketOpen ? null : getLastTradingDate();
  const isPrevDay   = !marketOpen;
  const prevDateLabel = prevDate?.label;

  try {
    const live = await fetchLive();
    const hasAnyData = live.KOSPI || live.SP500 || live.NASDAQ || live.DOW || live.NIKKEI;
    if (!hasAnyData) throw new Error('모든 지수 조회 실패');

    void supabase.from('market_cache').upsert({
      key: CACHE_KEY,
      data: {
        KOSPI:    live.KOSPI,
        KOSDAQ:   live.KOSDAQ,
        USD_KRW:  live.USD_KRW,
        NASDAQ:   live.NASDAQ,
        SP500:    live.SP500,
        DOW:      live.DOW,
        NIKKEI:   live.NIKKEI,
        HANGSENG: live.HANGSENG,
        SHANGHAI: live.SHANGHAI,
        SHENZHEN: live.SHENZHEN,
        USDJPY:   live.USDJPY,
        EURJPY:   live.EURJPY,
        USDHKD:   live.USDHKD,
        CNYHKD:   live.CNYHKD,
        USDCNY:   live.USDCNY,
        BOND_3Y:  live.BOND_3Y,
      },
      updated_at: new Date().toISOString(),
    });
    return NextResponse.json({ ...live, isCached: false, cachedAt: null, isPrevDay, prevDateLabel });
  } catch (e) {
    console.error('[MARKET] 지수 조회 실패, 캐시로 폴백:', e instanceof Error ? e.message : e);
  }

  const cached = await getCache();
  if (cached) return NextResponse.json({ ...cached, isPrevDay, prevDateLabel });

  return NextResponse.json({ error: '시장 데이터를 불러올 수 없습니다.' }, { status: 503 });
}
