import { NextResponse } from 'next/server';
import { getAccessToken, fetchCuratedMovers } from '@/lib/kis-api';
import { supabase } from '@/lib/supabase';
import type { MoversResponse, MoverStock } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const CACHE_KEY = 'market_movers';

async function fetchMovers(sortCode: '0' | '1'): Promise<MoverStock[]> {
  const token = await getAccessToken();

  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE: '170',
    FID_INPUT_ISCD: '0001',
    FID_RANK_SORT_CLS_CODE: sortCode,
    FID_INPUT_CNT_1: '0',
    FID_PRC_CLS_CODE: '0',
    FID_INPUT_PRICE_1: '',
    FID_INPUT_PRICE_2: '',
    FID_VOL_CNT: '',
    FID_TRGT_CLS_CODE: '111111111',
    FID_TRGT_EXLS_CLS_CODE: '000000',
    FID_DIV_CLS_CODE: '0',
    FID_INPUT_DATE_1: '',
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
  console.log('[MOVERS] sortCode:', sortCode, 'rt_cd:', data.rt_cd, 'count:', (data.output ?? []).length);

  if (!res.ok || data.rt_cd !== '0') {
    throw new Error(`fluctuation API 오류 [${res.status}]: ${data.msg1 ?? ''}`);
  }

  const items: any[] = data.output ?? [];
  return items.slice(0, 5).map((item) => ({
    name: item.hts_kor_isnm,
    ticker: item.stck_shrn_iscd,
    price: Number(item.stck_prpr),
    changeRate: Number(item.prdy_ctrt),
  }));
}

async function fetchNaverMovers(type: 'rise' | 'fall', count = 5): Promise<MoverStock[]> {
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

    const name = cells[1];
    const price = parseInt(cells[2].replace(/,/g, ''), 10);
    const changeRate = parseFloat(cells[4].replace('%', ''));

    if (!name || isNaN(price) || isNaN(changeRate)) continue;
    raw.push({ ticker, name, price, changeRate });
    if (raw.length >= 20) break;
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
  // 항상 실시간 조회 시도 — 장중/장후 무관하게 당일 데이터 반환
  // 1순위: KIS 급등락 순위 API (FHPST01700000)
  try {
    const [gainers, losers] = await Promise.all([fetchMovers('0'), fetchMovers('1')]);
    const validGainers = gainers.filter((s) => s.price > 0 && s.name);
    const validLosers  = losers.filter((s) => s.price > 0 && s.name);

    if (validGainers.length >= 3 || validLosers.length >= 3) {
      const result: MoversResponse = { gainers: validGainers, losers: validLosers };
      saveCache(result).catch(() => {});
      return NextResponse.json({ ...result, isCached: false, cachedAt: null });
    }
    console.log('[MOVERS] fluctuation output empty, falling back to Naver');
  } catch (e) {
    console.error('[MOVERS] fluctuation API 오류:', e instanceof Error ? e.message : e);
  }

  // 2순위: Naver Finance 급등/급락 스크래핑 (장 전후 모두 유효)
  try {
    const [naverGainers, naverLosers] = await Promise.all([
      fetchNaverMovers('rise', 5),
      fetchNaverMovers('fall', 5),
    ]);
    if (naverGainers.length > 0 || naverLosers.length > 0) {
      const result: MoversResponse = { gainers: naverGainers, losers: naverLosers };
      saveCache(result).catch(() => {});
      return NextResponse.json({ ...result, isCached: false, cachedAt: null });
    }
  } catch (e) {
    console.error('[MOVERS] Naver 스크래핑 오류:', e instanceof Error ? e.message : e);
  }

  // 3순위: 인기 20개 종목 조회 후 등락률 정렬
  try {
    const curated = await fetchCuratedMovers(5);
    if (curated.gainers.length > 0 || curated.losers.length > 0) {
      const result: MoversResponse = { gainers: curated.gainers, losers: curated.losers };
      saveCache(result).catch(() => {});
      return NextResponse.json({ ...result, isCached: false, cachedAt: null });
    }
  } catch (e) {
    console.error('[MOVERS] curated movers 오류:', e instanceof Error ? e.message : e);
  }

  // 4순위: 캐시
  const cached = await loadCache();
  if (cached) return NextResponse.json(cached);

  return NextResponse.json({ error: '시세 데이터를 불러올 수 없습니다.' }, { status: 503 });
}
