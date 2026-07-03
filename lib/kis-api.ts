import type { StockPrice, StockInfo, ChartDataPoint, MarketIndexData, MoverStock, AlertStock } from './types';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

// 종목명 로컬 fallback (KIS 응답에 종목명이 없을 때 사용)
export const STOCK_NAMES: Record<string, string> = {
  '005930': '삼성전자',
  '000660': 'SK하이닉스',
  '005380': '현대차',
  '000270': '기아',
  '005490': '포스코홀딩스',
  '035420': 'NAVER',
  '035720': '카카오',
  '000990': 'DB하이텍',
  '042700': '한미반도체',
  '086520': '에코프로',
  '373220': 'LG에너지솔루션',
  '207940': '삼성바이오로직스',
  '051910': 'LG화학',
  '006400': '삼성SDI',
  '028260': '삼성물산',
  '012330': '현대모비스',
  '003670': '포스코퓨처엠',
  '009150': '삼성전기',
  '032830': '삼성생명',
  '015760': '한국전력',
  '034730': 'SK',
  '017670': 'SK텔레콤',
  '030200': 'KT',
  '055550': '신한지주',
  '105560': 'KB금융',
  '086790': '하나금융지주',
  '316140': '우리금융지주',
  '003490': '대한항공',
  '011200': 'HMM',
  '096770': 'SK이노베이션',
  '010950': 'S-Oil',
  '018260': '삼성에스디에스',
  '000810': '삼성화재',
  '033780': 'KT&G',
  '009830': '한화솔루션',
  '051600': '한전KPS',
  '010130': '고려아연',
  '024110': '기업은행',
  '128940': '한미약품',
  '008770': '호텔신라',
  '003550': 'LG',
  '097950': 'CJ제일제당',
  '047050': '포스코인터내셔널',
  '004020': '현대제철',
  '005440': '현대글로비스',
  '006280': '녹십자',
  '000100': '유한양행',
  '007070': 'GS리테일',
  '001800': '오리온홀딩스',
  '088350': 'NH투자증권',
  '008560': '메리츠금융지주',
  '011790': 'SKC',
  '001040': 'CJ',
  '004990': '롯데지주',
  '139480': '이마트',
  '021240': '코웨이',
  '263750': '펄어비스',
  '247540': '에코프로비엠',
  '196170': '알테오젠',
  '018290': '레이',
  '091990': '셀트리온헬스케어',
  '214150': '클래시스',
  '145020': '휴젤',
  '357780': '솔브레인',
  '028300': 'HLB',
  '122630': 'KODEX 레버리지',
  '294870': 'HDC현대산업개발',
  '045390': '대아티아이',
  '058470': '리노공업',
  '041510': 'SM',
  '024770': '키움증권',
  '068270': '셀트리온',
  '095340': 'ISC',
  '039030': '이오테크닉스',
  '057540': '셀트리온제약',
  '263720': '디앤씨미디어',
  '383310': '에코프로머티리얼즈',
  '241560': '두산밥캣',
  '047310': '파워로직스',
  '950130': '엑스페릭스',
  '066970': 'L&F',
  '052690': '한전기술',
  '101360': '에코앤드림',
  '251270': '넷마블',
  '027360': '아주IB투자',
  '065500': '오에스아이소프트',
  '094360': '칩스앤미디어',
  '131970': '테크윙',
  '060150': 'SIMPAC',
  '140860': '파크시스템스',
  '312610': '에이에프더블류',
  '236200': '슈프리마',
  '039440': '에스티아이',
  '220180': '한컴라이프케어',
  '293490': '카카오게임즈',
  '140410': '메지온',
  '189300': '인터로조',
  '323990': '파나진',
  '402340': 'SK스페셜티',
  '048410': '현대바이오',
};

// KIS name이 빈 문자열인 경우 search-stock-info(CTPF1604R)로 보완 (process 내 캐시)
const nameCache = new Map<string, string>();

async function fetchNameFromKisSearch(ticker: string): Promise<string | null> {
  if (nameCache.has(ticker)) return nameCache.get(ticker)!;
  try {
    const token = await getAccessToken();
    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/search-stock-info`);
    url.searchParams.set('PRDT_TYPE_CD', '300');
    url.searchParams.set('PDNO', ticker);

    const res = await fetch(url.toString(), {
      headers: headers(token, 'CTPF1604R'),
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.rt_cd !== '0') return null;

    const name = (data.output?.prdt_abrv_name || data.output?.prdt_name || '').trim();
    if (name) {
      nameCache.set(ticker, name);
      return name;
    }
  } catch {
    // 조회 실패는 무시
  }
  return null;
}

// KIS 응답(o) → 종목명 해석: hts_kor_isnm/prdt_abrv_name → STOCK_NAMES → search-stock-info → (최후) ticker
async function resolveStockName(ticker: string, o: any): Promise<string> {
  const kisName = ((o.hts_kor_isnm || o.prdt_abrv_name || '') as string).trim();
  if (kisName) return kisName;
  if (STOCK_NAMES[ticker]) return STOCK_NAMES[ticker];

  const searchName = await fetchNameFromKisSearch(ticker);
  if (searchName) {
    console.log(`[KIS] ${ticker} 이름을 search-stock-info로 조회: ${searchName}`);
    return searchName;
  }
  console.warn(`[KIS] ${ticker} 종목명 조회 실패, ticker 코드로 표시`);
  return ticker;
}

// 인메모리 캐시: 동일 invocation 내 중복 발급 방지
let tokenCache: { token: string; expiresAt: number } | null = null;
// 동시 발급 요청 중복 방지
let tokenFetchPromise: Promise<string> | null = null;

export async function getAccessToken(): Promise<string> {
  // 1) 인메모리 캐시
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  // 2) 동시 발급 요청 중복 방지
  if (tokenFetchPromise) return tokenFetchPromise;

  tokenFetchPromise = (async () => {
    // 3) Supabase 영속 캐시 (serverless invocation 간 공유)
    try {
      const { data: tokenData } = await supabaseAdmin
        .from('kis_tokens')
        .select('access_token, expired_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (tokenData?.access_token && tokenData?.expired_at) {
        const expiresAt = new Date(tokenData.expired_at);
        const now = new Date();
        const remainingMs = expiresAt.getTime() - now.getTime();
        const remainingMinutes = Math.floor(remainingMs / 60000);
        console.log('[KIS] 토큰 상태:', {
          supabaseToken: true,
          expiresAt: tokenData.expired_at,
          remainingMinutes,
        });
        if (remainingMs > 10 * 60 * 1000) {
          console.log('[KIS] 캐시된 토큰 재사용');
          tokenCache = { token: tokenData.access_token, expiresAt: expiresAt.getTime() };
          return tokenData.access_token;
        }
        console.log('[KIS] 토큰 만료 임박 (10분 미만), 재발급');
      } else {
        console.log('[KIS] 토큰 상태:', { supabaseToken: false });
      }
    } catch (e) {
      console.log('[KIS] 토큰 캐시 조회 실패, 새로 발급:', e instanceof Error ? e.message : e);
    }

    // 4) KIS에서 신규 발급
    // 동시에 여러 인스턴스가 "재발급 필요"를 판단할 수 있으므로, 짧은 지터 후
    // 한 번 더 Supabase를 확인해 다른 프로세스가 이미 새 토큰을 저장했는지 확인한다.
    // (KIS는 계정당 유효 토큰이 1개뿐이라 동시 재발급 시 서로 무효화 + 403 rate limit 유발)
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    try {
      const { data: recheck } = await supabaseAdmin
        .from('kis_tokens')
        .select('access_token, expired_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (recheck?.access_token && recheck?.expired_at) {
        const remainingMs = new Date(recheck.expired_at).getTime() - Date.now();
        if (remainingMs > 10 * 60 * 1000) {
          console.log('[KIS] 재확인 중 다른 프로세스가 재발급한 토큰 발견, 재사용');
          tokenCache = { token: recheck.access_token, expiresAt: new Date(recheck.expired_at).getTime() };
          return recheck.access_token;
        }
      }
    } catch {
      // 재확인 실패는 무시하고 정상적으로 신규 발급 진행
    }

    console.log('[KIS] 새 토큰 발급 요청');
    const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`KIS 토큰 발급 실패 [${res.status}]: ${text}`);
    }

    const data = await res.json();
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 86400) * 1000);
    tokenCache = { token: data.access_token, expiresAt: expiresAt.getTime() };

    // 5) 기존 토큰 전체 삭제 후 새 토큰 저장
    try {
      await supabaseAdmin.from('kis_tokens').delete().neq('id', 0);
      await supabaseAdmin.from('kis_tokens').insert({
        access_token: data.access_token,
        expired_at: expiresAt.toISOString(),
      });
      console.log('[KIS] 새 토큰 저장 완료, 만료:', expiresAt.toISOString());
    } catch (e) {
      console.error('[KIS] 토큰 저장 실패:', e);
    }

    return data.access_token;
  })().finally(() => {
    tokenFetchPromise = null;
  });

  return tokenFetchPromise;
}

// 캐시된 토큰이 KIS에 의해 (다른 프로세스의 재발급 등으로) 조기 무효화된 경우
// 강제로 새 토큰을 발급받도록 인메모리·Supabase 캐시를 모두 비움
export async function invalidateAccessToken(): Promise<void> {
  tokenCache = null;
  try {
    await supabaseAdmin.from('kis_tokens').delete().neq('id', 0);
  } catch (e) {
    console.error('[KIS] 토큰 캐시 삭제 실패:', e);
  }
}

function headers(token: string, trId: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=UTF-8',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
  };
}

function signedChange(abs: string, signCode: string): number {
  const isDown = signCode === '4' || signCode === '5';
  return Math.abs(parseFloat(abs)) * (isDown ? -1 : 1);
}

function formatMarketCap(avlsUk: number): string {
  // hts_avls 단위: 억원
  const jo = avlsUk / 10000;
  if (jo >= 1) return `${jo.toFixed(1)}T`;
  return `${avlsUk.toLocaleString()}B`;
}

function formatTradingValue(pbmnWon: number): string {
  // acml_tr_pbmn 단위: 원
  const uk = pbmnWon / 100_000_000;
  return `${uk.toFixed(1)}B`;
}

// KIS가 캐시된 토큰을 조기 무효화했을 때 반환하는 코드 (다른 프로세스의 재발급 등으로 발생)
const EXPIRED_TOKEN_CODES = new Set(['EGW00123', 'EGW00121']);

export class KisTokenExpiredError extends Error {}

// KIS 응답의 msg_cd가 토큰 조기 만료 코드인 경우 KisTokenExpiredError를 던진다.
// 호출부는 rt_cd 체크보다 먼저 이 함수를 호출해 토큰 만료를 구분해야 한다.
export function assertKisTokenValid(data: any, label: string): void {
  const msgCd = data?.msg_cd as string | undefined;
  if (msgCd && EXPIRED_TOKEN_CODES.has(msgCd)) {
    throw new KisTokenExpiredError(`${label} 토큰 조기 만료(${msgCd})`);
  }
}

// KisTokenExpiredError 발생 시 토큰을 무효화하고 fn()을 한 번만 재시도한다.
// ranking/movers/alerts 등 kis-api.ts 밖에서 직접 KIS를 호출하는 라우트에서 사용.
export async function withKisTokenRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof KisTokenExpiredError) {
      console.warn('[KIS]', e.message, '- 토큰 재발급 후 재시도');
      await invalidateAccessToken();
      return await fn();
    }
    throw e;
  }
}

// 국내주식 시세 조회 — FID_COND_MRKT_DIV_CODE는 KOSPI/KOSDAQ 무관하게 항상 'J' 고정
// ('Q'는 KIS가 무조건 거부하는 값이라 재시도 낭비 방지 차원에서 제거)
async function queryPrice(ticker: string, _retried = false): Promise<any> {
  const token = await getAccessToken();

  const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
  url.searchParams.set('FID_INPUT_ISCD', ticker);

  const res = await fetch(url.toString(), {
    headers: headers(token, 'FHKST01010100'),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || data.rt_cd !== '0') {
    const msgCd = data?.msg_cd as string | undefined;
    if (!_retried && msgCd && EXPIRED_TOKEN_CODES.has(msgCd)) {
      console.warn(`[KIS] ${ticker} 캐시 토큰 조기 만료 감지(${msgCd}), 토큰 재발급 후 재시도`);
      await invalidateAccessToken();
      return queryPrice(ticker, true);
    }
    throw new Error(`주식 정보를 찾을 수 없습니다: ${ticker} [HTTP ${res.status}${data?.msg1 ? ` ${data.msg1}` : ''}]`);
  }

  return data.output;
}

export async function fetchStockPrice(ticker: string): Promise<StockPrice> {
  const o = await queryPrice(ticker);
  const name = await resolveStockName(ticker, o);
  // rprs_mrkt_kor_name 예시: "KOSPI200"(코스피), "KOSDAQ"/"KSQ150"(코스닥)
  const marketLabel = String(o.rprs_mrkt_kor_name ?? '');
  const market: 'KOSPI' | 'KOSDAQ' = /KOSDAQ|KSQ/i.test(marketLabel) ? 'KOSDAQ' : 'KOSPI';

  return {
    ticker,
    name,
    price: parseInt(o.stck_prpr, 10),
    change: signedChange(o.prdy_vrss, o.prdy_vrss_sign),
    changeRate: signedChange(o.prdy_ctrt, o.prdy_vrss_sign),
    volume: parseInt(o.acml_vol, 10),
    tradingValue: formatTradingValue(parseInt(o.acml_tr_pbmn, 10)),
    sector: (o.bstp_kor_isnm ?? '').trim(),
    market,
  };
}

export async function fetchStockInfo(ticker: string): Promise<StockInfo> {
  const o = await queryPrice(ticker);
  return {
    ticker,
    week52High: parseInt(o.w52_hgpr, 10),
    week52Low: parseInt(o.w52_lwpr, 10),
    marketCap: formatMarketCap(parseInt(o.hts_avls, 10)),
    per: parseFloat(o.per) || 0,
    pbr: parseFloat(o.pbr) || 0,
  };
}

export async function fetchDailyChart(
  ticker: string,
  period: '1W' | '1M' | '3M' | '1Y'
): Promise<ChartDataPoint[]> {
  const token = await getAccessToken();

  const endDate = new Date();
  const startDate = new Date();
  switch (period) {
    case '1W': startDate.setDate(endDate.getDate() - 7); break;
    case '1M': startDate.setMonth(endDate.getMonth() - 1); break;
    case '3M': startDate.setMonth(endDate.getMonth() - 3); break;
    case '1Y': startDate.setFullYear(endDate.getFullYear() - 1); break;
  }

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  for (const mktCode of ['J', 'Q']) {
    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
    url.searchParams.set('FID_INPUT_ISCD', ticker);
    url.searchParams.set('FID_INPUT_DATE_1', fmt(startDate));
    url.searchParams.set('FID_INPUT_DATE_2', fmt(endDate));
    url.searchParams.set('FID_PERIOD_DIV_CODE', 'D');
    url.searchParams.set('FID_ORG_ADJ_PRC', '0');

    const res = await fetch(url.toString(), {
      headers: headers(token, 'FHKST03010100'),
      cache:   'no-store',
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) continue;

    const data = await res.json();
    if (data.rt_cd !== '0' || !Array.isArray(data.output2) || data.output2.length === 0) continue;

    // KIS는 최신순 → 오래된순으로 반환. 차트용으로 역순 정렬
    return data.output2
      .filter((item: any) => item.stck_clpr && item.stck_clpr !== '0')
      .reverse()
      .map((item: any) => ({
        date: `${item.stck_bsop_date.slice(0, 4)}-${item.stck_bsop_date.slice(4, 6)}-${item.stck_bsop_date.slice(6, 8)}`,
        open: parseInt(item.stck_oprc, 10),
        high: parseInt(item.stck_hgpr, 10),
        low: parseInt(item.stck_lwpr, 10),
        close: parseInt(item.stck_clpr, 10),
        volume: parseInt(item.acml_vol, 10),
      }));
  }

  throw new Error(`차트 데이터를 찾을 수 없습니다: ${ticker}`);
}

export async function fetchMarketIndex(indexCode: string, signal?: AbortSignal): Promise<MarketIndexData> {
  const token = await getAccessToken();

  const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-index-price`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'U');
  url.searchParams.set('FID_INPUT_ISCD', indexCode);

  const res = await fetch(url.toString(), {
    headers: headers(token, 'FHPUP02100000'),
    cache: 'no-store',
    signal,
  });

  if (!res.ok) throw new Error(`지수 조회 실패 [${res.status}]`);

  const data = await res.json();
  if (data.rt_cd !== '0') throw new Error(`지수 오류: ${data.msg1}`);

  const o = data.output;
  return {
    value: parseFloat(o.bstp_nmix_prpr),
    change: signedChange(o.bstp_nmix_prdy_vrss, o.prdy_vrss_sign),
    changeRate: signedChange(o.bstp_nmix_prdy_ctrt, o.prdy_vrss_sign),
  };
}

// 지수(예: KOSPI 0001)의 특정 기간 등락률 — 벤치마크 비교용 (판단 없이 수치만 제공)
export async function fetchIndexRangeChange(
  indexCode: string,
  fromDate: Date,
  toDate: Date,
): Promise<{ startValue: number; endValue: number; changeRate: number; startDate: string; endDate: string } | null> {
  try {
    const token = await getAccessToken();
    const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'U');
    url.searchParams.set('FID_INPUT_ISCD', indexCode);
    url.searchParams.set('FID_INPUT_DATE_1', fmt(fromDate));
    url.searchParams.set('FID_INPUT_DATE_2', fmt(toDate));
    url.searchParams.set('FID_PERIOD_DIV_CODE', 'D');

    const res = await fetch(url.toString(), {
      headers: headers(token, 'FHKUP03500100'),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.rt_cd !== '0') return null;

    const rows: any[] = (data.output2 ?? [])
      .filter((r: any) => r.bstp_nmix_prpr && r.stck_bsop_date)
      .reverse(); // 오래된순 정렬
    if (rows.length < 2) return null;

    const first = rows[0];
    const last  = rows[rows.length - 1];
    const startValue = parseFloat(first.bstp_nmix_prpr);
    const endValue    = parseFloat(last.bstp_nmix_prpr);
    if (!(startValue > 0) || !(endValue > 0)) return null;

    return {
      startValue,
      endValue,
      changeRate: ((endValue - startValue) / startValue) * 100,
      startDate: `${first.stck_bsop_date.slice(0,4)}-${first.stck_bsop_date.slice(4,6)}-${first.stck_bsop_date.slice(6,8)}`,
      endDate:   `${last.stck_bsop_date.slice(0,4)}-${last.stck_bsop_date.slice(4,6)}-${last.stck_bsop_date.slice(6,8)}`,
    };
  } catch (e) {
    console.error('[KIS] fetchIndexRangeChange 실패:', e);
    return null;
  }
}

// USD/KRW: KIS 해외주식 당일체결 API 활용
// KIS API 구독 플랜에 따라 EXCD/SYMB 값이 다를 수 있으니 확인 후 조정
export async function fetchUsdKrw(signal?: AbortSignal): Promise<MarketIndexData> {
  const token = await getAccessToken();

  const url = new URL(`${KIS_BASE}/uapi/overseas-stock/v1/quotations/inquire-price`);
  url.searchParams.set('AUTH', '');
  url.searchParams.set('EXCD', 'FX');
  url.searchParams.set('SYMB', 'USDKRW');

  const res = await fetch(url.toString(), {
    headers: headers(token, 'HHDFS00000300'),
    cache: 'no-store',
    signal,
  });

  if (!res.ok) throw new Error(`USD/KRW 조회 실패 [${res.status}]`);

  const data = await res.json();
  if (data.rt_cd !== '0') throw new Error(`USD/KRW 오류: ${data.msg1}`);

  const o = data.output;
  return {
    value: parseFloat(o.last),
    change: parseFloat(o.diff ?? '0'),
    changeRate: parseFloat(o.rate ?? '0'),
  };
}

// 인기 종목 20개 당일 시세 조회 후 등락률 정렬 → 급등/급락 대체
// [ticker, market] — J=KOSPI, Q=KOSDAQ, X=both 시도
export const CURATED_TICKERS_MKT: [string, 'J' | 'Q' | 'X'][] = [
  // KOSPI 대형주
  ['005930', 'J'], ['000660', 'J'], ['005380', 'J'], ['000270', 'J'], ['005490', 'J'],
  ['035420', 'J'], ['207940', 'J'], ['051910', 'J'], ['006400', 'J'], ['028260', 'J'],
  ['012330', 'J'], ['009150', 'J'], ['032830', 'J'], ['015760', 'J'], ['034730', 'J'],
  ['017670', 'J'], ['030200', 'J'], ['055550', 'J'], ['105560', 'J'], ['086790', 'J'],
  ['316140', 'J'], ['003490', 'J'], ['011200', 'J'], ['096770', 'J'], ['010950', 'J'],
  ['018260', 'J'], ['000810', 'J'], ['033780', 'J'], ['009830', 'J'], ['051600', 'J'],
  ['010130', 'J'], ['024110', 'J'], ['128940', 'J'], ['008770', 'J'], ['003550', 'J'],
  ['097950', 'J'], ['047050', 'J'], ['004020', 'J'], ['005440', 'J'], ['006280', 'J'],
  ['000100', 'J'], ['007070', 'J'], ['001800', 'J'], ['088350', 'J'], ['008560', 'J'],
  ['011790', 'J'], ['001040', 'J'], ['004990', 'J'], ['139480', 'J'], ['021240', 'J'],
  // KOSDAQ 대형주
  ['035720', 'Q'], ['086520', 'Q'], ['373220', 'Q'], ['003670', 'Q'], ['042700', 'Q'],
  ['000990', 'Q'], ['263750', 'Q'], ['247540', 'Q'], ['196170', 'Q'], ['018290', 'Q'],
  ['091990', 'Q'], ['214150', 'Q'], ['145020', 'Q'], ['357780', 'Q'], ['028300', 'Q'],
  ['122630', 'Q'], ['294870', 'Q'], ['045390', 'Q'], ['058470', 'Q'], ['041510', 'Q'],
  ['024770', 'Q'], ['068270', 'Q'], ['095340', 'Q'], ['039030', 'Q'], ['057540', 'Q'],
  ['263720', 'Q'], ['383310', 'Q'], ['241560', 'Q'], ['047310', 'Q'], ['950130', 'Q'],
  ['066970', 'Q'], ['052690', 'Q'], ['101360', 'Q'], ['251270', 'Q'], ['027360', 'Q'],
  ['065500', 'Q'], ['094360', 'Q'], ['131970', 'Q'], ['060150', 'Q'], ['140860', 'Q'],
  ['312610', 'Q'], ['236200', 'Q'], ['039440', 'Q'], ['220180', 'Q'], ['293490', 'Q'],
  ['140410', 'Q'], ['189300', 'Q'], ['323990', 'Q'], ['402340', 'Q'], ['048410', 'Q'],
];

// 하위 호환성을 위한 배열 (movers 등에서 사용)
const CURATED_TICKERS = CURATED_TICKERS_MKT.map(([t]) => t);

export async function fetchCuratedMovers(count = 5): Promise<{ gainers: MoverStock[]; losers: MoverStock[] }> {
  const token = await getAccessToken(); // 토큰 1회 발급 후 공유

  const fetchTicker = async (ticker: string): Promise<MoverStock> => {
    for (const mktCode of ['J', 'Q']) {
      const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
      url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
      url.searchParams.set('FID_INPUT_ISCD', ticker);
      const res = await fetch(url.toString(), {
        headers: headers(token, 'FHKST01010100'),
        cache:   'no-store',
        signal:  AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.rt_cd !== '0') continue;
      const o = data.output;
      return {
        ticker,
        name:       ((o.hts_kor_isnm || o.prdt_abrv_name || STOCK_NAMES[ticker] || ticker) as string).trim(),
        price:      parseInt(o.stck_prpr, 10),
        changeRate: signedChange(o.prdy_ctrt, o.prdy_vrss_sign),
      } satisfies MoverStock;
    }
    throw new Error(`종목 정보를 찾을 수 없습니다: ${ticker}`);
  };

  // 10개씩 배치 처리 — KIS API 동시 요청 과부하 방지
  const allSettled: PromiseSettledResult<MoverStock>[] = [];
  for (let i = 0; i < CURATED_TICKERS.length; i += 10) {
    const batch = CURATED_TICKERS.slice(i, i + 10);
    const batchResults = await Promise.allSettled(batch.map(fetchTicker));
    allSettled.push(...batchResults);
    if (i + 10 < CURATED_TICKERS.length) await new Promise((r) => setTimeout(r, 300));
  }

  const stocks = allSettled
    .filter((r): r is PromiseFulfilledResult<MoverStock> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((s) => s.price > 0);

  stocks.sort((a, b) => b.changeRate - a.changeRate);

  // 상승 종목만 gainers, 하락 종목만 losers (방향 반대 종목 제외)
  const gainers = stocks.filter((s) => s.changeRate > 0).slice(0, count);
  const losers  = stocks.filter((s) => s.changeRate < 0).reverse().slice(0, count);

  return { gainers, losers };
}

// 국내주식 급등/급락 순위 조회 (FHPST01700000)
// direction: 'up' = 상승률 순, 'down' = 하락률 순
export async function fetchFluctuation(direction: 'up' | 'down', count = 5): Promise<MoverStock[]> {
  const token = await getAccessToken();

  const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/ranking/fluctuation`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
  url.searchParams.set('FID_COND_SCR_DIV_CODE', '170');
  url.searchParams.set('FID_INPUT_ISCD', '0001');
  url.searchParams.set('FID_RANK_SORT_CLS_CODE', direction === 'up' ? '0' : '1');
  url.searchParams.set('FID_INPUT_CNT_1', '0');
  url.searchParams.set('FID_TRGT_CLS_CODE', '111111111');
  url.searchParams.set('FID_TRGT_EXLS_CLS_CODE', '000000');
  url.searchParams.set('FID_DIV_CLS_CODE', '0');
  url.searchParams.set('FID_INPUT_DATE_1', '');
  url.searchParams.set('FID_INPUT_PRICE_1', '');
  url.searchParams.set('FID_INPUT_PRICE_2', '');
  url.searchParams.set('FID_VOL_CNT', '');
  url.searchParams.set('FID_PRC_CLS_CODE', '0');
  url.searchParams.set('FID_RSFL_RATE1', '');
  url.searchParams.set('FID_RSFL_RATE2', '');
  url.searchParams.set('FID_RST_CLB_CODE', '');

  const res = await fetch(url.toString(), {
    headers: headers(token, 'FHPST01700000'),
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`급등락 조회 실패 [${res.status}]`);

  const data = await res.json();
  if (data.rt_cd !== '0') throw new Error(`급등락 API 오류: ${data.msg1}`);

  const output: any[] = data.output ?? [];
  return output.slice(0, count).map((o) => ({
    ticker: o.stck_shrn_iscd,
    name:   o.hts_kor_isnm,
    price:  parseInt(o.stck_prpr || '0', 10),
    changeRate: signedChange(o.prdy_ctrt, o.prdy_vrss_sign),
  }));
}

// 100개 주요 종목의 당일 52주 신고가/신저가 갱신 여부 확인 (배치 처리)
export async function fetchCurated52wAlerts(): Promise<{ highAlerts: AlertStock[]; lowAlerts: AlertStock[] }> {
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();

    // 오늘 날짜 (KST) — YYYYMMDD 형식
    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayStr =
      `${kst.getFullYear()}` +
      `${String(kst.getMonth() + 1).padStart(2, '0')}` +
      `${String(kst.getDate()).padStart(2, '0')}`;

    type StockData = {
      ticker: string; name: string; price: number;
      high52w: number; low52w: number; high52wDate: string; low52wDate: string;
    };

    const fetchOne = async ([ticker, mkt]: [string, 'J' | 'Q' | 'X']): Promise<StockData | null> => {
      const markets = mkt === 'X' ? ['J', 'Q'] : [mkt];
      for (const mktCode of markets) {
        const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
        url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
        url.searchParams.set('FID_INPUT_ISCD', ticker);
        try {
          const res = await fetch(url.toString(), {
            headers: headers(token, 'FHKST01010100'),
            cache: 'no-store',
            signal: AbortSignal.timeout(4000),
          });
          if (!res.ok) continue;
          const data = await res.json();
          assertKisTokenValid(data, 'FHKST01010100');
          if (data.rt_cd !== '0') continue;
          const o = data.output;
          return {
            ticker,
            name:        await resolveStockName(ticker, o),
            price:       parseInt(o.stck_prpr, 10),
            high52w:     parseInt(o.w52_hgpr, 10),
            low52w:      parseInt(o.w52_lwpr, 10),
            high52wDate: (o.w52_hgpr_date as string) ?? '',
            low52wDate:  (o.w52_lwpr_date as string) ?? '',
          };
        } catch (e) {
          if (e instanceof KisTokenExpiredError) throw e;
          continue;
        }
      }
      return null;
    };

    // 20개씩 배치 처리하여 rate limit 회피
    const BATCH = 20;
    const allData: StockData[] = [];
    for (let i = 0; i < CURATED_TICKERS_MKT.length; i += BATCH) {
      const batch = CURATED_TICKERS_MKT.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(fetchOne));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) allData.push(r.value);
        else if (r.status === 'rejected' && r.reason instanceof KisTokenExpiredError) throw r.reason;
      }
    }

    const highAlerts: AlertStock[] = allData
      .filter((s) => s.high52wDate === todayStr && s.price > 0)
      .map((s) => ({ ticker: s.ticker, name: s.name, price: s.price, high52w: s.high52w }));

    const lowAlerts: AlertStock[] = allData
      .filter((s) => s.low52wDate === todayStr && s.price > 0)
      .map((s) => ({ ticker: s.ticker, name: s.name, price: s.price, low52w: s.low52w }));

    console.log(`[52W] 조회 완료: ${allData.length}개 종목, 신고가 ${highAlerts.length}개, 신저가 ${lowAlerts.length}개`);
    return { highAlerts, lowAlerts };
  });
}

// 관심종목 ticker 배열에 대해 당일 52주 신고가/신저가 갱신 여부 개별 확인
export async function fetchWatch52w(
  tickers: string[],
): Promise<{ highAlerts: AlertStock[]; lowAlerts: AlertStock[] }> {
  if (!tickers.length) return { highAlerts: [], lowAlerts: [] };

  return withKisTokenRetry(async () => {
    const token = await getAccessToken();

    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayStr =
      `${kst.getFullYear()}` +
      `${String(kst.getMonth() + 1).padStart(2, '0')}` +
      `${String(kst.getDate()).padStart(2, '0')}`;

    type StockData = {
      ticker: string; name: string; price: number;
      high52w: number; low52w: number; high52wDate: string; low52wDate: string;
    };

    const fetchOne = async (ticker: string): Promise<StockData | null> => {
      // KOSPI(J) 먼저 시도, 실패 시 KOSDAQ(Q)
      for (const mktCode of ['J', 'Q']) {
        try {
          const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
          url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
          url.searchParams.set('FID_INPUT_ISCD', ticker);
          const res = await fetch(url.toString(), {
            headers: headers(token, 'FHKST01010100'),
            cache: 'no-store',
            signal: AbortSignal.timeout(4000),
          });
          if (!res.ok) continue;
          const data = await res.json();
          assertKisTokenValid(data, 'FHKST01010100');
          if (data.rt_cd !== '0') continue;
          const o = data.output;
          return {
            ticker,
            name:        await resolveStockName(ticker, o),
            price:       parseInt(o.stck_prpr, 10),
            high52w:     parseInt(o.w52_hgpr, 10),
            low52w:      parseInt(o.w52_lwpr, 10),
            high52wDate: (o.w52_hgpr_date as string) ?? '',
            low52wDate:  (o.w52_lwpr_date as string) ?? '',
          };
        } catch (e) {
          if (e instanceof KisTokenExpiredError) throw e;
          continue;
        }
      }
      return null;
    };

    // 3개씩 배치 처리 (rate limit 회피)
    const allData: StockData[] = [];
    for (let i = 0; i < tickers.length; i += 3) {
      const batch = tickers.slice(i, i + 3);
      const results = await Promise.allSettled(batch.map(fetchOne));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) allData.push(r.value);
        else if (r.status === 'rejected' && r.reason instanceof KisTokenExpiredError) throw r.reason;
      }
      if (i + 3 < tickers.length) await new Promise((r) => setTimeout(r, 300));
    }

    const highAlerts: AlertStock[] = allData
      .filter((s) => s.high52wDate === todayStr && s.price > 0)
      .map((s) => ({ ticker: s.ticker, name: s.name, price: s.price, high52w: s.high52w }));
    const lowAlerts: AlertStock[] = allData
      .filter((s) => s.low52wDate === todayStr && s.price > 0)
      .map((s) => ({ ticker: s.ticker, name: s.name, price: s.price, low52w: s.low52w }));

    console.log(
      `[52W-WATCH] 관심종목 조회: ${allData.length}/${tickers.length}개, 신고가: ${highAlerts.length}개, 신저가: ${lowAlerts.length}개`,
    );
    return { highAlerts, lowAlerts };
  });
}
