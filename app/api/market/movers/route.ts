import { NextResponse } from 'next/server';
import { getAccessToken, fetchCuratedMovers, assertKisTokenValid, withKisTokenRetry } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';
import { isKoreanMarketOpen, getLastTradingDate } from '@/lib/market-utils';
import type { MoversResponse, MoverStock } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const CACHE_KEY = 'market_movers';

// market: J=코스피, Q=코스닥 / date: YYYYMMDD (장 외 시간에 최근 거래일 지정)
async function fetchMovers(sortCode: '0' | '1', market: 'J' | 'Q', date = ''): Promise<MoverStock[]> {
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();
    const iscdMap = { J: '0001', Q: '1001' };

    const params = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: 'J', // 이 API는 시장구분값이 항상 'J' 고정 — 코스피/코스닥 구분은 FID_INPUT_ISCD로 함 ('Q'를 넣으면 KIS가 오류 반환)
      FID_COND_SCR_DIV_CODE: '170',
      FID_INPUT_ISCD: iscdMap[market],
      FID_RANK_SORT_CLS_CODE: sortCode,
      FID_INPUT_CNT_1: '0',
      FID_PRC_CLS_CODE: '0',
      FID_INPUT_PRICE_1: '',
      FID_INPUT_PRICE_2: '',
      FID_VOL_CNT: '',
      FID_TRGT_CLS_CODE: '111111111',
      FID_TRGT_EXLS_CLS_CODE: '000000',
      FID_DIV_CLS_CODE: '0',
      FID_INPUT_DATE_1: date,
      FID_RSFL_RATE1: '',
      FID_RSFL_RATE2: '',
      FID_RST_CLB_CODE: '',
    });

    const res = await fetch(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation?${params}`,
      {
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
          'appkey': process.env.KIS_APP_KEY!,
          'appsecret': process.env.KIS_APP_SECRET!,
          'tr_id': 'FHPST01700000',
          'custtype': 'P',
        },
        cache: 'no-store',
      }
    );

    const data = await res.json();
    console.log(`[MOVERS] ${market} sortCode:${sortCode} rt_cd:${data.rt_cd} count:${(data.output ?? []).length}`);

    assertKisTokenValid(data, 'FHPST01700000');
    if (!res.ok || data.rt_cd !== '0') {
      throw new Error(`fluctuation API 오류 [${res.status}] ${market}: ${data.msg1 ?? ''}`);
    }

    const items: any[] = data.output ?? [];
    const mapped = items.map((item) => ({
      name:       item.hts_kor_isnm,
      ticker:     item.stck_shrn_iscd,
      price:      Number(item.stck_prpr),
      changeRate: Number(item.prdy_ctrt),
    }));
    // 디버그: 전체 응답 ticker 목록 출력 (앱클론 174900 포함 여부 확인용)
    console.log(`[MOVERS] ${market} 전체 응답:`, mapped.map(s => `${s.ticker}(${s.changeRate}%)`).join(', '));
    return mapped;
  });
}

async function fetchNaverMovers(type: 'rise' | 'fall', count = 10): Promise<MoverStock[]> {
  const url = type === 'rise'
    ? 'https://finance.naver.com/sise/sise_rise.naver'
    : 'https://finance.naver.com/sise/sise_fall.naver';

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`Naver sise_${type} 조회 실패 [${res.status}]`);

  const buffer = await res.arrayBuffer();
  const html = new TextDecoder('euc-kr').decode(buffer);

  const tableMatch = html.match(/<table[^>]*class=['"]type_2['"][^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) throw new Error('Naver type_2 table not found');

  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  const raw: MoverStock[] = [];

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tableMatch[1])) !== null) {
    const rowHtml = m[1];
    const codeMatch = rowHtml.match(/code=(\d{6})/);
    if (!codeMatch) continue;

    const ticker = codeMatch[1];
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    }
    if (cells.length < 5) continue;

    const name       = cells[1];
    const price      = parseInt(cells[2].replace(/,/g, ''), 10);
    const changeRate = parseFloat(cells[4].replace('%', ''));

    if (!name || isNaN(price) || isNaN(changeRate)) continue;
    raw.push({ ticker, name, price, changeRate });
    if (raw.length >= 50) break;
  }

  const results = raw
    .filter((s) => type === 'rise' ? s.changeRate > 0 : s.changeRate < 0)
    .sort((a, b) => type === 'rise' ? b.changeRate - a.changeRate : a.changeRate - b.changeRate)
    .slice(0, count);

  console.log(`[MOVERS] Naver ${type}: ${results.length}개 — top: ${results[0]?.name} ${results[0]?.changeRate}%`);
  return results;
}

async function loadCache(): Promise<MoversResponse | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .single();
    if (!cache) return null;
    return { ...(cache.data as MoversResponse), isCached: true, cachedAt: cache.updated_at };
  } catch {
    return null;
  }
}

async function saveCache(data: MoversResponse) {
  try {
    await supabase.from('market_cache').upsert({
      key: CACHE_KEY,
      data: { gainers: data.gainers, losers: data.losers },
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[MOVERS] 캐시 저장 실패:', e);
  }
}

export async function GET() {
  const marketOpen = isKoreanMarketOpen();
  console.log(`[MOVERS] 장 ${marketOpen ? '중' : '외'}`);

  if (marketOpen) {
    // 장 중: 실시간 순위 조회
    // 1순위: KIS 급등락 순위 API — 코스피(J) + 코스닥(Q) 동시 조회
    try {
      const [kospiGainers, kosdaqGainers, kospiLosers, kosdaqLosers] = await Promise.all([
        fetchMovers('0', 'J'),
        fetchMovers('0', 'Q'),
        fetchMovers('1', 'J'),
        fetchMovers('1', 'Q'),
      ]);

      const gainers = [...kospiGainers, ...kosdaqGainers]
        .filter((s) => s.price > 0 && s.name)
        .sort((a, b) => b.changeRate - a.changeRate)
        .slice(0, 20);

      const losers = [...kospiLosers, ...kosdaqLosers]
        .filter((s) => s.price > 0 && s.name)
        .sort((a, b) => a.changeRate - b.changeRate)
        .slice(0, 20);

      console.log(`[MOVERS] KIS 결합 — 급등:${gainers.length}개 급락:${losers.length}개`);

      if (gainers.length >= 3 || losers.length >= 3) {
        const result: MoversResponse = { gainers, losers };
        saveCache(result).catch(() => {});
        return NextResponse.json({ ...result, isCached: false, cachedAt: null, isPrevDay: false });
      }
      console.log('[MOVERS] KIS output empty, falling back to Naver');
    } catch (e) {
      console.error('[MOVERS] KIS API 오류:', e instanceof Error ? e.message : e);
    }

    // 2순위: Naver Finance 급등/급락 스크래핑
    try {
      const [naverGainers, naverLosers] = await Promise.all([
        fetchNaverMovers('rise', 20),
        fetchNaverMovers('fall', 20),
      ]);
      if (naverGainers.length > 0 || naverLosers.length > 0) {
        const result: MoversResponse = { gainers: naverGainers, losers: naverLosers };
        saveCache(result).catch(() => {});
        return NextResponse.json({ ...result, isCached: false, cachedAt: null, isPrevDay: false });
      }
    } catch (e) {
      console.error('[MOVERS] Naver 스크래핑 오류:', e instanceof Error ? e.message : e);
    }

    // 3순위: curated 종목 등락률 정렬
    try {
      const curated = await fetchCuratedMovers(20, { waitForLock: false });
      if (curated.gainers.length > 0 || curated.losers.length > 0) {
        const result: MoversResponse = { gainers: curated.gainers, losers: curated.losers };
        saveCache(result).catch(() => {});
        return NextResponse.json({ ...result, isCached: false, cachedAt: null, isPrevDay: false });
      }
    } catch (e) {
      console.error('[MOVERS] curated movers 오류:', e instanceof Error ? e.message : e);
    }

    // 4순위: 캐시
    const cached = await loadCache();
    if (cached) return NextResponse.json({ ...cached, isPrevDay: false });
  } else {
    // 장 외: 최근 거래일 기준 데이터 조회
    const { yyyymmdd: prevDate, label: prevDateLabel } = getLastTradingDate();
    console.log(`[MOVERS] 장외 — 최근 거래일: ${prevDate}`);

    // 1순위: KIS 급등락 순위 API — 최근 거래일 날짜 지정
    try {
      const [kospiGainers, kosdaqGainers, kospiLosers, kosdaqLosers] = await Promise.all([
        fetchMovers('0', 'J', prevDate),
        fetchMovers('0', 'Q', prevDate),
        fetchMovers('1', 'J', prevDate),
        fetchMovers('1', 'Q', prevDate),
      ]);

      const gainers = [...kospiGainers, ...kosdaqGainers]
        .filter((s) => s.price > 0 && s.name)
        .sort((a, b) => b.changeRate - a.changeRate)
        .slice(0, 20);

      const losers = [...kospiLosers, ...kosdaqLosers]
        .filter((s) => s.price > 0 && s.name)
        .sort((a, b) => a.changeRate - b.changeRate)
        .slice(0, 20);

      console.log(`[MOVERS] KIS 장외(${prevDate}) — 급등:${gainers.length}개 급락:${losers.length}개`);

      if (gainers.length >= 3 || losers.length >= 3) {
        const result: MoversResponse = { gainers, losers };
        saveCache(result).catch(() => {});
        return NextResponse.json({ ...result, isCached: false, cachedAt: new Date().toISOString(), isPrevDay: true, prevDateLabel });
      }
      console.log('[MOVERS] KIS 장외 output empty, falling back to Naver');
    } catch (e) {
      console.error('[MOVERS] KIS 장외 오류:', e instanceof Error ? e.message : e);
    }

    // 2순위: Naver Finance (장 외에도 전일 마감 기준 데이터 제공)
    try {
      const [naverGainers, naverLosers] = await Promise.all([
        fetchNaverMovers('rise', 20),
        fetchNaverMovers('fall', 20),
      ]);
      if (naverGainers.length > 0 || naverLosers.length > 0) {
        const result: MoversResponse = { gainers: naverGainers, losers: naverLosers };
        saveCache(result).catch(() => {});
        return NextResponse.json({ ...result, isCached: false, cachedAt: new Date().toISOString(), isPrevDay: true, prevDateLabel });
      }
    } catch (e) {
      console.error('[MOVERS] 장외 Naver 스크래핑 오류:', e instanceof Error ? e.message : e);
    }

    // 3순위: 캐시된 전일 데이터
    const cached = await loadCache();
    if (cached) return NextResponse.json({ ...cached, isPrevDay: true });

    // 4순위: curated 종목 등락률 정렬 (최후 수단)
    try {
      const curated = await fetchCuratedMovers(20, { waitForLock: false });
      if (curated.gainers.length > 0 || curated.losers.length > 0) {
        return NextResponse.json({ gainers: curated.gainers, losers: curated.losers, isCached: false, cachedAt: null, isPrevDay: true, prevDateLabel });
      }
    } catch (e) {
      console.error('[MOVERS] curated movers 오류:', e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ error: '시세 데이터를 불러올 수 없습니다.' }, { status: 503 });
}
