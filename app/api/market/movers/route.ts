import { NextResponse } from 'next/server';
import { getAccessToken, acquireKisRateSlot, fetchCuratedMovers, assertKisTokenValid, withKisTokenRetry, cacheJsonResult } from '@/lib/kis-api';
import { isKoreanMarketOpen, getTradingDateCandidates, findFirstNonEmptyByDate } from '@/lib/market-utils';
import { EXCLUDE_PATTERN } from '@/lib/market-ranking';
import type { MoversResponse, MoverStock } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const CACHE_KEY = 'market_movers';

// 2026-09-03 트래픽점검 8번: 홈 인기종목 위젯이 3분마다 폴링하는데 이 라우트엔 TTL
// 캐싱이 없어(3번 작업에서 single-flight 락만 가드로 추가, TTL은 "항상 최신"이라는
// 기존 설계를 바꾸는 별도 결정이라 보류해뒀었다) 매 요청·매 접속자마다 KIS 4건(코스피/
// 코스닥 × 급등/급락)을 라이브로 호출했다 — 위젯 3분 폴링 × 홈 접속자 수만큼 그대로
// 비례 증가하는 구조. investors/finance/daily(트래픽점검 2번)와 같은 cacheJsonResult
// 패턴으로 전환한다. 장중 TTL은 위젯 자체의 갱신 주기(3분)에 맞추고(그보다 짧게 캐싱해도
// 화면이 어차피 3분에 한 번만 다시 그리므로 무의미), 장외는 다른 시장 라우트와 동일하게
// 30분 — 마감 후엔 순위가 사실상 안 바뀐다.
const MOVERS_CACHE_TTL_MS_OPEN   = 3 * 60_000; // 장중 3분 — 위젯 폴링 주기와 동일
const MOVERS_CACHE_TTL_MS_CLOSED = 30 * 60_000; // 장외 30분

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

    // 2026-09-03 트래픽점검 8번: 이 라우트가 전역 KIS 레이트리미터 게이트를 우회하고
    // 있었다(investors/daily 등은 이미 8/31~9/3 사이 게이트가 붙었는데 여기만 누락돼
    // 있었음) — 홈페이지 위젯이라 'user' 우선순위(크론보다 낮음, 트래픽점검 4번 참고).
    await acquireKisRateSlot({ priority: 'user' });
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
    if (EXCLUDE_PATTERN.test(name)) continue;
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

type MoversCachePayload = MoversResponse & { prevDateLabel?: string };

// cacheJsonResult의 fetchLive 콜백 — KIS→네이버→curated 3단 폴백은 그대로 유지하되,
// 전부 실패하면(예전엔 여기서 그냥 503을 반환) throw해서 cacheJsonResult가 "라이브 실패
// 시 stale 캐시로 폴백"(트래픽점검 4번에서 추가된 동작)을 대신 처리하게 한다 — 캐시된
// 값이 있으면 완전 실패보다 그 값을 서빙하는 게 낫다는 원칙을 이 라우트에도 동일하게
// 적용하는 셈.
async function fetchMoversLive(marketOpen: boolean): Promise<MoversCachePayload> {
  if (marketOpen) {
    // 1순위: KIS 급등락 순위 API — 코스피(J) + 코스닥(Q) 동시 조회
    try {
      const [kospiGainers, kosdaqGainers, kospiLosers, kosdaqLosers] = await Promise.all([
        fetchMovers('0', 'J'),
        fetchMovers('0', 'Q'),
        fetchMovers('1', 'J'),
        fetchMovers('1', 'Q'),
      ]);

      const gainers = [...kospiGainers, ...kosdaqGainers]
        .filter((s) => s.price > 0 && s.name && !EXCLUDE_PATTERN.test(s.name))
        .sort((a, b) => b.changeRate - a.changeRate)
        .slice(0, 20);

      const losers = [...kospiLosers, ...kosdaqLosers]
        .filter((s) => s.price > 0 && s.name && !EXCLUDE_PATTERN.test(s.name))
        .sort((a, b) => a.changeRate - b.changeRate)
        .slice(0, 20);

      console.log(`[MOVERS] KIS 결합 — 급등:${gainers.length}개 급락:${losers.length}개`);

      if (gainers.length >= 3 || losers.length >= 3) return { gainers, losers };
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
        return { gainers: naverGainers, losers: naverLosers };
      }
    } catch (e) {
      console.error('[MOVERS] Naver 스크래핑 오류:', e instanceof Error ? e.message : e);
    }

    // 3순위: curated 종목 등락률 정렬
    try {
      const curated = await fetchCuratedMovers(20, { waitForLock: false });
      const curatedGainers = curated.gainers.filter((s) => !EXCLUDE_PATTERN.test(s.name));
      const curatedLosers  = curated.losers.filter((s) => !EXCLUDE_PATTERN.test(s.name));
      if (curatedGainers.length > 0 || curatedLosers.length > 0) {
        return { gainers: curatedGainers, losers: curatedLosers };
      }
    } catch (e) {
      console.error('[MOVERS] curated movers 오류:', e instanceof Error ? e.message : e);
    }

    throw new Error('장중 급등락 소스 3단(KIS/Naver/curated) 모두 실패');
  }

  // 장 외: "실제 데이터가 존재하는" 가장 최근 거래일을 순차 탐색 (공휴일 캘린더 없이
  // KIS 응답이 비어있으면 하루씩 물러나며 재시도)
  const dateCandidates = getTradingDateCandidates();
  console.log(`[MOVERS] 장외 — 후보 거래일: ${dateCandidates.map(c => c.yyyymmdd).join(', ')}`);

  // 1순위: KIS 급등락 순위 API — 후보 날짜를 순서대로 시도
  try {
    const fetchMoversForDate = async (prevDate: string): Promise<{ gainers: MoverStock[]; losers: MoverStock[] }[]> => {
      const [kospiGainers, kosdaqGainers, kospiLosers, kosdaqLosers] = await Promise.all([
        fetchMovers('0', 'J', prevDate),
        fetchMovers('0', 'Q', prevDate),
        fetchMovers('1', 'J', prevDate),
        fetchMovers('1', 'Q', prevDate),
      ]);

      const gainers = [...kospiGainers, ...kosdaqGainers]
        .filter((s) => s.price > 0 && s.name && !EXCLUDE_PATTERN.test(s.name))
        .sort((a, b) => b.changeRate - a.changeRate)
        .slice(0, 20);

      const losers = [...kospiLosers, ...kosdaqLosers]
        .filter((s) => s.price > 0 && s.name && !EXCLUDE_PATTERN.test(s.name))
        .sort((a, b) => a.changeRate - b.changeRate)
        .slice(0, 20);

      console.log(`[MOVERS] KIS 장외(${prevDate}) — 급등:${gainers.length}개 급락:${losers.length}개`);

      if (gainers.length >= 3 || losers.length >= 3) return [{ gainers, losers }];
      return [];
    };

    const picked = await findFirstNonEmptyByDate(dateCandidates, fetchMoversForDate);
    if (picked) return { ...picked.rows[0], prevDateLabel: picked.label };
    console.log('[MOVERS] KIS 장외 모든 후보 날짜 실패/공백, Naver 폴백');
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
      return { gainers: naverGainers, losers: naverLosers, prevDateLabel: dateCandidates[0]?.label };
    }
  } catch (e) {
    console.error('[MOVERS] 장외 Naver 스크래핑 오류:', e instanceof Error ? e.message : e);
  }

  // 3순위: curated 종목 등락률 정렬 (최후 수단)
  try {
    const curated = await fetchCuratedMovers(20, { waitForLock: false });
    const curatedGainers = curated.gainers.filter((s) => !EXCLUDE_PATTERN.test(s.name));
    const curatedLosers  = curated.losers.filter((s) => !EXCLUDE_PATTERN.test(s.name));
    if (curatedGainers.length > 0 || curatedLosers.length > 0) {
      return { gainers: curatedGainers, losers: curatedLosers, prevDateLabel: dateCandidates[0]?.label };
    }
  } catch (e) {
    console.error('[MOVERS] curated movers 오류:', e instanceof Error ? e.message : e);
  }

  throw new Error('장외 급등락 소스 3단(KIS/Naver/curated) 모두 실패');
}

export async function GET() {
  const marketOpen = isKoreanMarketOpen();
  console.log(`[MOVERS] 장 ${marketOpen ? '중' : '외'}`);
  const ttlMs = marketOpen ? MOVERS_CACHE_TTL_MS_OPEN : MOVERS_CACHE_TTL_MS_CLOSED;

  try {
    const { data, isCached, cachedAt } = await cacheJsonResult(
      CACHE_KEY, ttlMs, () => fetchMoversLive(marketOpen),
      { invalidateAcrossClose: true },
    );
    const { prevDateLabel, ...rest } = data;
    return NextResponse.json({ ...rest, isCached, cachedAt, isPrevDay: !marketOpen, prevDateLabel });
  } catch (e) {
    console.error('[MOVERS] 전체 실패(캐시도 없음):', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: '시세 데이터를 불러올 수 없습니다.' }, { status: 503 });
  }
}
