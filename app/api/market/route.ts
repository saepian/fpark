import { NextResponse, after } from 'next/server';
import { fetchMarketIndex } from '../../../lib/kis-api';
import { supabase } from '../../../lib/supabase';
import { isKoreanMarketOpen, getLastTradingDate, fetchYahooIndex } from '../../../lib/market-utils';
import type { MarketResponse, MarketIndexData } from '../../../lib/types';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'market_indices';

// 2026-07-09: KIS 해외주식 당일체결(inquire-price, HHDFS00000300)로 USD/KRW를 가져오던
// 1순위 시도를 제거함 — EXCD=FX/SYMB=USDKRW뿐 아니라 정상 동작해야 할 해외주식 심볼
// (EXCD=NAS/SYMB=AAPL)로도 동일하게 404(빈 바디)가 나는 것을 실계좌로 확인, 이 KIS 계정에
// 해외주식 API 권한 자체가 없는 것으로 보임(코드 문제가 아니라 KIS Developers 콘솔에서
// 별도 신청/승인이 필요한 계정 설정 문제 — 2026-07-31 재확인 시점에도 동일하게 404,
// 아직 미해결). open.er-api.com이 이미 안정적으로 동작 중이라 1순위로 승격.
//
// 2026-07-31: 위 "1순위 open.er-api.com" 문구와 실제 동작이 어긋나 있던 버그 정리 —
// open.er-api.com이 성공해도, 뒤이어 Yahoo FX가 성공하면 change/changeRate만 "보완"하는
// 게 아니라 value까지 통째로 Yahoo 값으로 덮어썼다(`return yahoo`). 즉 Yahoo가 정상
// 응답하는 한(대부분의 경우) 실제 화면엔 항상 Yahoo 값이 떴고, open.er-api.com의 환율은
// Yahoo가 실패할 때만 쓰이는 사실상의 폴백이었다 — 실측(fpark 표시값 1,436.70원)이 Yahoo
// KRW=X의 regularMarketPrice와 정확히 일치, open.er-api.com의 rates.KRW(1,429.51원)와는
// 무관함을 확인. 게다가 open.er-api.com 무료 티어는 하루 1회만 갱신되는 소스라(공식 확인,
// exchangerate-api.com 문서) 애초에 "실시간 1순위"로는 부적합하다. 실제 동작대로 Yahoo를
// 1순위로 정직하게 재작성하고, open.er-api.com은 Yahoo 실패 시에만 쓰는 순수 폴백으로
// 남긴다(단, 이 경우 change/changeRate는 계산 근거가 없어 0으로 반환 — 기존과 동일).
async function fetchUsdKrwWithFallback(): Promise<MarketIndexData | null> {
  // 1순위: Yahoo Finance — 실측상 약 15~20분 지연(무인증 크로스 시세의 한계, 완전한
  // 실시간은 아님). 화면 표시부에는 이 지연을 고지한다(domestic/global 페이지, MarketSummary).
  const yahoo = await fetchYahooFX('KRW=X').catch(() => null);
  if (yahoo) return yahoo;

  // 2순위: open.er-api.com (무료, API 키 불필요, 단 하루 1회 갱신 — Yahoo가 실패했을
  // 때만 쓰는 최후 폴백. change/changeRate 계산 근거가 없어 0으로 채움).
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (data.result === 'success' && data.rates?.KRW) {
      return { value: data.rates.KRW, change: 0, changeRate: 0 };
    }
  } catch (e) {
    console.warn('[MARKET] open.er-api.com 환율 조회 실패:', e instanceof Error ? e.message : e);
  }

  return null;
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
  // 2026-07-10 진단: KIS 재발급이 이 8초 예산 안에 못 끝나고 중간에 끊기는지
  // 확인하기 위한 명시적 로그 — "발급 요청" 다음에 성공/실패 로그 없이 끊기는
  // 현상이 관찰됐는데, 이 8초 타임아웃이 원인인지 이 로그로 직접 확인한다.
  const timeout = setTimeout(() => {
    console.error('[MARKET] 8초 타임아웃 도달 — 진행 중인 KIS 요청을 중단합니다');
    controller.abort();
  }, 8000);

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
      fetchMarketIndex('0001', controller.signal, { waitForLock: false }),
      fetchMarketIndex('1001', controller.signal, { waitForLock: false }),
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

// 2026-07-15: 국내증시 페이지 5분 자동 새로고침 도입 후, 이 라우트가 매 요청마다
// KIS/Yahoo를 라이브 호출해서 동시 접속자 수에 부하가 선형 비례하는 문제 확인 —
// popular 라우트와 동일한 TTL 캐시 패턴 추가. 장중엔 가격이 자주 바뀌므로 짧게,
// 장 마감 후엔 어차피 값이 안 바뀌므로 길게 잡아 불필요한 호출을 더 줄인다.
const CACHE_TTL_MS_OPEN   = 30_000;      // 장중 30초
const CACHE_TTL_MS_CLOSED = 30 * 60_000; // 장외 30분

export async function GET() {
  const marketOpen  = isKoreanMarketOpen();
  const prevDate    = marketOpen ? null : getLastTradingDate();
  const isPrevDay   = !marketOpen;
  const prevDateLabel = prevDate?.label;

  // TTL 이내면 라이브 호출 없이 캐시 재사용
  const ttlMs = marketOpen ? CACHE_TTL_MS_OPEN : CACHE_TTL_MS_CLOSED;
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .single();
    if (cache) {
      const age = Date.now() - new Date(cache.updated_at).getTime();
      if (age < ttlMs) {
        console.log(`[MARKET] TTL 캐시 히트 (${Math.round(age / 1000)}s < ${ttlMs / 1000}s) — 라이브 호출 생략`);
        return NextResponse.json({ ...(cache.data as MarketResponse), isCached: true, cachedAt: cache.updated_at, isPrevDay, prevDateLabel });
      }
    }
  } catch (e) {
    console.warn('[MARKET] TTL 캐시 조회 실패, 라이브로 진행:', e instanceof Error ? e.message : e);
  }

  try {
    const live = await fetchLive();
    const hasAnyData = live.KOSPI || live.SP500 || live.NASDAQ || live.DOW || live.NIKKEI;
    if (!hasAnyData) throw new Error('모든 지수 조회 실패');

    // await 없이 던지면 응답 직후 실행 컨텍스트가 얼어붙어 저장이 중간에 끊길 수 있어
    // after()로 등록 — 이번에 TTL 캐시를 추가하면서 실측으로 확인된 문제(2026-07-15,
    // stock/[ticker]/price 라우트와 동일한 이유).
    after(async () => {
      const { error } = await supabase.from('market_cache').upsert({
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
      if (error) console.warn('[MARKET] 캐시 저장 실패:', error.message);
    });
    return NextResponse.json({ ...live, isCached: false, cachedAt: null, isPrevDay, prevDateLabel });
  } catch (e) {
    console.error('[MARKET] 지수 조회 실패, 캐시로 폴백:', e instanceof Error ? e.message : e);
  }

  const cached = await getCache();
  if (cached) return NextResponse.json({ ...cached, isPrevDay, prevDateLabel });

  return NextResponse.json({ error: '시장 데이터를 불러올 수 없습니다.' }, { status: 503 });
}
