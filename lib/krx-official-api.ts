import type { StockMasterEntry } from './krx-stock-master';

// 공공데이터포털 "금융위원회_KRX상장종목정보"(GetKrxListedInfoService.getItemInfo) —
// KRX(kind.krx.co.kr) HTML 스크래핑이 Vercel 서버리스 IP에서 403 차단당하는 문제
// (lib/krx-stock-master.ts 참고)의 근본 해결책. 정부 공식 배포 API라 스크래핑 차단
// 대상이 아니고, 시장구분(mrktCtg) 필드가 응답에 포함돼 있어 KOSPI/KOSDAQ을 한 번의
// 호출로 함께 받을 수 있다 — 시장별로 따로 요청하던 기존 방식보다 단순해진다.
//
// 엔드포인트/파라미터/필드명은 이 API를 실제로 쓰는 공개 레퍼런스 구현체
// (https://github.com/xerxes-k/getkrxcode)를 참고해 작성했고, 2026-08-21 실제 인증키로
// 검증 완료(.e2e-tmp/krx-official-api-raw-20260819.json):
//   - srtnCd(단축코드)는 실제로 "A" 접두사가 붙어 온다(예: "A005930") — normalizeTicker()의
//     스트립 처리가 필요했던 게 맞음.
//   - mrktCtg(시장구분)는 정확히 "KOSPI"/"KOSDAQ" 문자열 그대로 온다(다른 표기 없음) —
//     normalizeMarket()의 "코스피"/"유가증권" 등 방어 분기는 실제로는 안 타지만, 데이터
//     제공사가 표기를 바꿀 가능성에 대비해 그대로 남겨둔다.
// ⚠️ 갱신 지연 실측: basDt는 문서상 "D+1 영업일 13시 이후 갱신"이지만, 2026-08-21(금)
// 조회 시 당일(08-21)·전일(08-20) basDt는 모두 totalCount 0이었고 08-19(수) basDt에서야
// 데이터가 잡혔다 — 지연이 최대 2영업일까지 갈 수 있다는 뜻. 아래 fetchKrxListedInfoOfficial()의
// "최대 5일 전까지 재시도" 루프가 정확히 이 상황을 커버하기 위한 설계다.

const ENDPOINT = 'https://apis.data.go.kr/1160100/service/GetKrxListedInfoService/getItemInfo';

// 한 번에 다 받기 위한 넉넉한 페이지 크기 — 2026-08-21 실측 totalCount 2758건(2026-08-18
// KRX 스크래핑 실측 KOSPI 829건/KOSDAQ 1767건과 근사, 외국기업 국내예탁증권 등 포함돼
// 약간 더 많음) 기준으로 페이지네이션 없이 한 번의 호출로 충분하다. totalCount가 이 값을
// 넘으면 아래에서 경고 로그만 남기고 받은 만큼만 반영한다(부분 갱신이 전체 실패보다
// 낫다는 기존 방침과 동일).
const NUM_OF_ROWS = 4000;

interface KrxListedInfoItem {
  basDt?: string;
  srtnCd?: string;   // 단축코드(6자리, "A" 접두사 여부 미확정 — 위 TODO 참고)
  isinCd?: string;
  itmsNm?: string;   // 종목명
  mrktCtg?: string;  // 시장구분
  crno?: string;
  corpNm?: string;   // 법인명
}

interface KrxListedInfoResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      totalCount?: number;
      items?: { item?: KrxListedInfoItem[] | KrxListedInfoItem };
    };
  };
}

function normalizeTicker(raw: string | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^A/, ''); // TODO: "A" 접두사 실제 여부 검증
  return /^\d{6}$/.test(stripped) ? stripped : null;
}

function normalizeMarket(raw: string | undefined): 'KOSPI' | 'KOSDAQ' | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes('KOSPI') || raw.includes('코스피') || raw.includes('유가증권')) return 'KOSPI';
  if (upper.includes('KOSDAQ') || raw.includes('코스닥')) return 'KOSDAQ';
  return null; // KONEX 등 stock_master 스키마 밖 시장은 제외
}

function kstDateStr(daysAgo: number): string {
  const shifted = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const kst = new Date(shifted.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`;
}

async function fetchForBasDt(basDt: string, apiKey: string): Promise<StockMasterEntry[]> {
  // serviceKey는 반드시 "Decoding" 키를 넣어야 한다 — URLSearchParams가 인코딩을
  // 대신 해주므로, 이미 인코딩된 키를 넣으면 이중 인코딩되어 인증에 실패한다
  // (data.go.kr 계열 API 공통 함정).
  const params = new URLSearchParams({
    serviceKey: apiKey,
    numOfRows: String(NUM_OF_ROWS),
    pageNo: '1',
    resultType: 'json',
    basDt,
  });

  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`KRX상장종목정보 API HTTP ${res.status}`);

  const json = (await res.json()) as KrxListedInfoResponse;
  const resultCode = json.response?.header?.resultCode;
  if (resultCode !== '00') {
    throw new Error(`KRX상장종목정보 API 오류(resultCode=${resultCode ?? '없음'}): ${json.response?.header?.resultMsg ?? '알 수 없음'}`);
  }

  const rawItem = json.response?.body?.items?.item;
  // data.go.kr 흔한 패턴: 결과가 1건이면 배열이 아니라 객체 단독으로 온다.
  const rawItems: KrxListedInfoItem[] = Array.isArray(rawItem) ? rawItem : rawItem ? [rawItem] : [];

  const totalCount = json.response?.body?.totalCount;
  if (typeof totalCount === 'number' && totalCount > rawItems.length) {
    console.warn(`[KRX-OFFICIAL] totalCount(${totalCount})가 수신 건수(${rawItems.length})보다 많음 — numOfRows(${NUM_OF_ROWS}) 상향 또는 페이지네이션 검토 필요`);
  }

  const items: StockMasterEntry[] = [];
  for (const raw of rawItems) {
    const ticker = normalizeTicker(raw.srtnCd);
    const market = normalizeMarket(raw.mrktCtg);
    const name = raw.itmsNm?.trim();
    if (ticker && market && name) items.push({ ticker, name, market });
  }
  return items;
}

// 기준일(basDt)에 데이터가 없으면(주말/공휴일) 하루씩 물러나며 최대 5일 전까지
// 재시도한다 — 거래일 달력을 따로 유지하지 않는 대신, "그날 데이터가 0건이면 전날도
// 시도"라는 단순한 방식으로 방어한다.
export async function fetchKrxListedInfoOfficial(): Promise<StockMasterEntry[]> {
  const apiKey = process.env.DATA_GO_KR_KRX_LISTED_INFO_KEY;
  if (!apiKey) throw new Error('DATA_GO_KR_KRX_LISTED_INFO_KEY 미설정');

  for (let daysAgo = 0; daysAgo <= 5; daysAgo++) {
    const basDt = kstDateStr(daysAgo);
    const items = await fetchForBasDt(basDt, apiKey);
    if (items.length > 0) return items;
    console.warn(`[KRX-OFFICIAL] basDt=${basDt} 결과 0건 — 하루 전으로 재시도`);
  }
  throw new Error('KRX상장종목정보: 최근 5일간 유효한 데이터를 받지 못함');
}
