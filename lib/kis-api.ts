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

// KOSPI=J, KOSDAQ=Q 순서로 시도
async function queryPrice(ticker: string): Promise<any> {
  const token = await getAccessToken();

  for (const mktCode of ['J', 'Q']) {
    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
    url.searchParams.set('FID_INPUT_ISCD', ticker);

    try {
      const res = await fetch(url.toString(), {
        headers: headers(token, 'FHKST01010100'),
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;

      const data = await res.json();
      if (data.rt_cd === '0') return data.output;
    } catch {
      continue;
    }
  }

  throw new Error(`주식 정보를 찾을 수 없습니다: ${ticker}`);
}

export async function fetchStockPrice(ticker: string): Promise<StockPrice> {
  const o = await queryPrice(ticker);
  const kisName = (o.hts_kor_isnm || o.prdt_abrv_name || '').trim();
  let name = kisName || STOCK_NAMES[ticker] || '';

  // KIS와 STOCK_NAMES 모두 이름 없을 때 search-stock-info(CTPF1604R)로 보완
  if (!name) {
    const searchName = await fetchNameFromKisSearch(ticker);
    name = searchName || ticker;
    if (searchName) console.log(`[KIS] ${ticker} 이름을 search-stock-info로 조회: ${searchName}`);
    else console.warn(`[KIS] ${ticker} 종목명 조회 실패, ticker 코드로 표시`);
  }

  return {
    ticker,
    name,
    price: parseInt(o.stck_prpr, 10),
    change: signedChange(o.prdy_vrss, o.prdy_vrss_sign),
    changeRate: signedChange(o.prdy_ctrt, o.prdy_vrss_sign),
    volume: parseInt(o.acml_vol, 10),
    tradingValue: formatTradingValue(parseInt(o.acml_tr_pbmn, 10)),
    sector: (o.bstp_kor_isnm ?? '').trim(),
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
      cache: 'no-store',
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
const CURATED_TICKERS_MKT: [string, 'J' | 'Q' | 'X'][] = [
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

  const results = await Promise.allSettled(
    CURATED_TICKERS.map(async (ticker) => {
      for (const mktCode of ['J', 'Q']) {
        const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
        url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
        url.searchParams.set('FID_INPUT_ISCD', ticker);
        const res = await fetch(url.toString(), {
          headers: headers(token, 'FHKST01010100'),
          cache: 'no-store',
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
    }),
  );

  const stocks = results
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
        if (data.rt_cd !== '0') continue;
        const o = data.output;
        return {
          ticker,
          name:        ((o.hts_kor_isnm || o.prdt_abrv_name || STOCK_NAMES[ticker] || ticker) as string).trim(),
          price:       parseInt(o.stck_prpr, 10),
          high52w:     parseInt(o.w52_hgpr, 10),
          low52w:      parseInt(o.w52_lwpr, 10),
          high52wDate: (o.w52_hgpr_date as string) ?? '',
          low52wDate:  (o.w52_lwpr_date as string) ?? '',
        };
      } catch { continue; }
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
}
