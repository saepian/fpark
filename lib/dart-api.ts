import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// DART(전자공시시스템) Open API — 기업분석 페이지 "주요 공시" 카드용(2026-07-13).
// 공시는 종목코드(6자리)가 아니라 DART 고유번호(corp_code, 8자리)로 조회해야 해서,
// corpCode.xml(전체 상장사 매핑, ZIP)을 한 번 받아 Supabase market_cache에 캐싱해두고
// 재사용한다(매일 재요청하면 3.6MB짜리 zip을 매번 내려받게 됨).

const DART_BASE = 'https://opendart.fss.or.kr/api';
const CORP_CODE_CACHE_KEY = 'dart_corp_code_map';
const CORP_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // DART 데이터 갱신 주기 고려 7일

// 2026-07-23 실측: Supabase 캐시가 있어도 매 요청마다 DB 왕복이 발생했고, 캐시가
// 만료된 시점엔 그 순간 요청한 사용자가 다운로드+파싱 비용(실측 4.3초)을 그대로
// 떠안는 구조였다(진단: TTL 만료 시 지연(lazy) 갱신 방식이 원인, 콜드스타트와는 무관 —
// Supabase 영속 캐시 자체는 이미 있었음). 워밍된 인스턴스 안에서는 프로세스 메모리에
// 들고 있다가 재사용해 DB 왕복조차 줄인다 — 원본 데이터가 7일에 한 번 바뀌는 정적
// 데이터라 인스턴스 생애주기 동안(길어야 몇 시간) 재검증 없이 재사용해도 안전하다.
let _memCache: { map: Map<string, string>; loadedAt: number } | null = null;
const MEM_TTL_MS = 60 * 60 * 1000; // 1시간 — 인스턴스가 오래 warm 상태로 남아도 너무 오래 묵지 않게

let _sb: ReturnType<typeof createClient<Database>> | null = null;
function getSb() {
  if (!_sb) _sb = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return _sb;
}

// type(아닌 interface)으로 선언 — diagnosis route가 이 배열을 stock_diagnosis.result(jsonb)에
// 그대로 저장하는데, TS Json 타입 검사가 named interface를 index signature에 대입하는 걸
// 허용하지 않는다(lib/kis-api.ts의 AnnualFinancialRow와 동일한 이유).
export type DartDisclosure = {
  title:  string; // report_nm (공백 트리밍)
  date:   string; // YYYY-MM-DD
  url:    string; // DART 원문 링크
  filer:  string; // 제출인
};

// 공시는 종류가 매우 많고 대부분(임원·주요주주 지분보고 등)은 투자자 입장에서 노이즈다.
// "있을 때만 눈에 띄게" 원칙을 지키려면 허용 목록 방식이 안전하다 — 새 공시 유형이
// 나타나도 기본은 제외되고, 명시적으로 등록한 키워드만 통과시킨다.
const SIGNIFICANT_KEYWORDS = [
  '자기주식', '유상증자', '무상증자', '주요사항보고서', '공급계약',
  '합병', '분할', '잠정', '영업실적', '전환사채', '신주인수권부사채',
];
// 예) "연결재무제표기준영업(잠정)실적(공정공시)"처럼 DART 공시명은 괄호로 수식어를
// 끼워 넣는 경우가 흔해 '잠정실적'처럼 연속 문자열로 찾으면 놓친다(2026-07-13 실측
// 확인) — '잠정' 단독 키워드로 완화해 이런 변형도 잡히게 한다.

function isSignificant(reportName: string): boolean {
  return SIGNIFICANT_KEYWORDS.some((kw) => reportName.includes(kw));
}

async function downloadAndParseCorpCodeMap(): Promise<Map<string, string>> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) throw new Error('DART_API_KEY 미설정');

  const res = await fetch(`${DART_BASE}/corpCode.xml?crtfc_key=${apiKey}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`corpCode.xml HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  // 정상 응답은 ZIP, 키 오류 등은 에러 XML을 그대로 반환하므로 매직 바이트로 구분
  if (buf.slice(0, 2).toString('ascii') !== 'PK') {
    throw new Error(`corpCode.xml 응답이 ZIP이 아님(키/쿼터 오류 가능성): ${buf.slice(0, 200).toString('utf-8')}`);
  }

  const zip = new AdmZip(buf);
  const entry = zip.getEntries().find((e) => e.entryName.toUpperCase() === 'CORPCODE.XML');
  if (!entry) throw new Error('corpCode.xml zip 안에 CORPCODE.XML 없음');

  const xml = entry.getData().toString('utf-8');
  const $ = load(xml, { xmlMode: true });

  const map = new Map<string, string>(); // stock_code(6자리) → corp_code(8자리)
  $('list').each((_, el) => {
    const stockCode = $(el).find('stock_code').text().trim();
    const corpCode  = $(el).find('corp_code').text().trim();
    if (stockCode && corpCode) map.set(stockCode, corpCode);
  });

  console.log(`[DART] corp_code 맵 갱신 완료 — 상장사 ${map.size}개`);
  return map;
}

async function loadCorpCodeMap(): Promise<Map<string, string>> {
  if (_memCache && Date.now() - _memCache.loadedAt < MEM_TTL_MS) {
    return _memCache.map;
  }

  try {
    const { data: cache } = await getSb()
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', CORP_CODE_CACHE_KEY)
      .single();
    if (cache?.data && Date.now() - new Date(cache.updated_at as string).getTime() < CORP_CODE_TTL_MS) {
      const map = new Map(Object.entries(cache.data as Record<string, string>));
      _memCache = { map, loadedAt: Date.now() };
      return map;
    }
  } catch (e) {
    console.warn('[DART] corp_code 캐시 조회 실패, 새로 받는다:', e instanceof Error ? e.message : e);
  }

  // 2026-07-23: 여기 도달하는 경우 = Supabase 캐시가 없거나 TTL(7일) 만료 — 이 요청을
  // 보낸 사용자가 다운로드+파싱 비용(실측 4.3초)을 떠안는다. refreshCorpCodeMap()을
  // 크론으로 미리 돌려 TTL 만료 전에 갱신해두면 사용자 요청이 이 경로를 타지 않는다.
  const map = await downloadAndParseCorpCodeMap();
  await persistCorpCodeMap(map);
  _memCache = { map, loadedAt: Date.now() };
  return map;
}

async function persistCorpCodeMap(map: Map<string, string>): Promise<void> {
  try {
    await getSb().from('market_cache').upsert({
      key: CORP_CODE_CACHE_KEY,
      data: Object.fromEntries(map),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[DART] corp_code 캐시 저장 실패(계속 진행):', e instanceof Error ? e.message : e);
  }
}

// TTL(7일)보다 훨씬 짧은 주기의 크론에서 호출 — 사용자 요청 경로에서 다운로드가
// 발생하지 않도록 만료 전에 선제적으로 갱신한다. 강제 다운로드(TTL 체크 없이).
export async function refreshCorpCodeMap(): Promise<{ count: number }> {
  const map = await downloadAndParseCorpCodeMap();
  await persistCorpCodeMap(map);
  _memCache = { map, loadedAt: Date.now() };
  return { count: map.size };
}

export async function fetchCorpCode(ticker: string): Promise<string | null> {
  try {
    const map = await loadCorpCodeMap();
    return map.get(ticker) ?? null;
  } catch (e) {
    console.error('[DART] fetchCorpCode 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

function kstDateNumStr(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
}

// 최근 N일 내 "주목할 만한" 공시만 선별 반환. 없으면 빈 배열(UI에서 섹션 자체 생략).
export async function fetchRecentDisclosures(ticker: string, days = 14): Promise<DartDisclosure[]> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) return [];

  try {
    const corpCode = await fetchCorpCode(ticker);
    if (!corpCode) return [];

    const end = new Date();
    const begin = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const url = new URL(`${DART_BASE}/list.json`);
    url.searchParams.set('crtfc_key', apiKey);
    url.searchParams.set('corp_code', corpCode);
    url.searchParams.set('bgn_de', kstDateNumStr(begin));
    url.searchParams.set('end_de', kstDateNumStr(end));
    url.searchParams.set('page_count', '30');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`list.json HTTP ${res.status}`);
    const data = await res.json();

    // status '013' = 조회된 데이터 없음(정상), 그 외 비정상은 로그만 남기고 빈 배열
    if (data.status === '013') return [];
    if (data.status !== '000') {
      console.warn(`[DART] list.json 비정상 응답 ${ticker}:`, data.status, data.message);
      return [];
    }

    type DartListItem = { report_nm: string; rcept_dt: string; rcept_no: string; flr_nm: string };
    return ((data.list ?? []) as DartListItem[])
      .filter((item) => isSignificant(item.report_nm))
      .map((item) => ({
        title: item.report_nm.trim(),
        date:  `${item.rcept_dt.slice(0, 4)}-${item.rcept_dt.slice(4, 6)}-${item.rcept_dt.slice(6, 8)}`,
        url:   `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
        filer: item.flr_nm,
      }))
      .slice(0, 5);
  } catch (e) {
    console.error(`[DART] fetchRecentDisclosures 실패 ${ticker}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

// ── 배당 요약 (기업분석 "배당 정보" 섹션 — DART 최신 사업연도) ────────────────
// alotMatter.json(배당에 관한 사항)은 항목명이 같아도 stock_knd로 보통주/우선주
// 행이 분리돼 있다(2026-07-30 실측, 삼성전자 예: 현금배당수익률(%) 보통주=1.50,
// 우선주=1.90 — 서로 다른 행). stock_knd가 없는 항목(현금배당성향 등)은 단일 행.
// 2026-08-14 실측(빙그레): 우선주가 아예 없는 종목은 DART가 그 단일 행의 stock_knd를
// "보통주"로 채우지 않고 "-"로 남겨두는 경우가 있다(같은 회계연도에 실제 값은 정상
// 존재 — 데이터 누락이 아니라 라벨링 차이) — '보통주' 정확 일치만 찾던 find()가
// 이 행을 못 찾아 배당수익률·주당배당금만 null로 빠지고, stock_knd 필터가 없는
// 배당성향만 정상 표시되는 버그가 있었다. "-"도 매칭되도록 완화해 대응한다.
const DIVIDEND_SUMMARY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 사업보고서는 연 1회 제출 — corp_code 맵과 동일 주기

export type DartDividendSummary = {
  year:             string;        // 사업연도(예: "2025")
  dividendYield:    number | null; // 현금배당수익률(%), 보통주 기준
  dividendPerShare: number | null; // 주당 현금배당금(원), 보통주 기준
  payoutRatio:      number | null; // (연결)현금배당성향(%)
};

function parseDartNumber(v: string | undefined): number | null {
  if (!v || v === '-') return null;
  const n = Number(v.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

async function fetchAlotMatter(corpCode: string, bsnsYear: string): Promise<Record<string, string>[] | null> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) return null;
  try {
    const url = new URL(`${DART_BASE}/alotMatter.json`);
    url.searchParams.set('crtfc_key', apiKey);
    url.searchParams.set('corp_code', corpCode);
    url.searchParams.set('bsns_year', bsnsYear);
    url.searchParams.set('reprt_code', '11011'); // 사업보고서(연간)
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== '000' || !Array.isArray(data.list)) return null;
    return data.list;
  } catch {
    return null;
  }
}

// 무배당 종목도 정상적인 결과라 null을 그대로 캐싱한다("row 없음"=캐시 미스,
// "row 있는데 dividendSummary가 null"=확정된 무배당) — 조회 성공 여부를 cache row
// 존재 자체로 판별해야 하며 언래핑한 값의 참/거짓으로 판별하면 안 된다(무배당
// 캐시가 매번 미스로 오판되어 매 요청마다 재조회하게 됨).
// market_cache.data는 NOT NULL 컬럼이라, summary가 null일 때 그대로 upsert하면
// PostgREST가 JS null을 "JSON null 값"이 아니라 "SQL NULL"로 해석해 23502(not-null
// constraint violation)로 매번 조용히 거부된다(2026-07-30 실측 확인 — try/catch로도
// 못 잡힘: supabase-js는 이 경우 reject가 아니라 {error} 필드로만 반환하기 때문에
// 기존 코드의 catch가 애초에 발동하지 않았다). null도 유효한 JSON 값인 래퍼 객체로
// 감싸 저장하고 읽을 때 언래핑한다.
type DividendSummaryCacheValue = { dividendSummary: DartDividendSummary | null };

export async function fetchDividendSummary(ticker: string): Promise<DartDividendSummary | null> {
  const cacheKey = `dart_dividend_${ticker}`;
  try {
    const { data: cache } = await getSb()
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKey)
      .single();
    if (cache && Date.now() - new Date(cache.updated_at as string).getTime() < DIVIDEND_SUMMARY_CACHE_TTL_MS) {
      const cached = cache.data as Partial<DividendSummaryCacheValue> | null;
      // 이번 수정 이전에 언래핑 없이 저장된 구버전 캐시 행(무배당이 아닌 실제 값이
      // DartDividendSummary 형태로 그대로 저장돼 있음)은 dividendSummary 키가 없다 —
      // 캐시 미스로 취급해 아래에서 재계산하고 새 포맷으로 덮어써 자연스럽게 마이그레이션한다.
      if (cached && typeof cached === 'object' && 'dividendSummary' in cached) {
        return cached.dividendSummary ?? null;
      }
    }
  } catch {
    // 캐시 조회 실패 시 새로 계산
  }

  let summary: DartDividendSummary | null = null;
  try {
    const corpCode = await fetchCorpCode(ticker);
    if (corpCode) {
      const thisYear = new Date().getFullYear();
      // 사업보고서는 회계연도 종료 후 90일 내 제출이라 연초엔 최신 완료연도 데이터가
      // 아직 없을 수 있음 — 작년 실패 시 재작년으로 폴백.
      for (const y of [thisYear - 1, thisYear - 2]) {
        const rows = await fetchAlotMatter(corpCode, String(y));
        if (!rows || rows.length === 0) continue;

        const find = (se: string, stockKnd?: string) =>
          rows.find((r) => r.se === se && (stockKnd ? (r.stock_knd === stockKnd || r.stock_knd === '-') : true));

        const dividendYield    = parseDartNumber(find('현금배당수익률(%)', '보통주')?.thstrm);
        const dividendPerShare = parseDartNumber(find('주당 현금배당금(원)', '보통주')?.thstrm);
        const payoutRatio      = parseDartNumber(find('(연결)현금배당성향(%)')?.thstrm);

        if (dividendYield !== null || dividendPerShare !== null || payoutRatio !== null) {
          summary = { year: String(y), dividendYield, dividendPerShare, payoutRatio };
        }
        break; // 데이터가 있는 최신 연도를 찾았으면(배당 유무와 무관) 더 과거로 가지 않음
      }
    }
  } catch (e) {
    console.error(`[DART] fetchDividendSummary 실패 ${ticker}:`, e instanceof Error ? e.message : e);
  }

  try {
    const cacheValue: DividendSummaryCacheValue = { dividendSummary: summary };
    const { error } = await getSb()
      .from('market_cache')
      .upsert({ key: cacheKey, data: cacheValue, updated_at: new Date().toISOString() });
    if (error) console.warn(`[DART] ${ticker} 배당 요약 캐시 저장 실패:`, error.message);
  } catch (e) {
    console.warn(`[DART] ${ticker} 배당 요약 캐시 저장 실패:`, e instanceof Error ? e.message : e);
  }

  return summary;
}
