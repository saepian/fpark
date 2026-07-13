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
  try {
    const { data: cache } = await getSb()
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', CORP_CODE_CACHE_KEY)
      .single();
    if (cache?.data && Date.now() - new Date(cache.updated_at as string).getTime() < CORP_CODE_TTL_MS) {
      return new Map(Object.entries(cache.data as Record<string, string>));
    }
  } catch (e) {
    console.warn('[DART] corp_code 캐시 조회 실패, 새로 받는다:', e instanceof Error ? e.message : e);
  }

  const map = await downloadAndParseCorpCodeMap();
  try {
    await getSb().from('market_cache').upsert({
      key: CORP_CODE_CACHE_KEY,
      data: Object.fromEntries(map),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[DART] corp_code 캐시 저장 실패(계속 진행):', e instanceof Error ? e.message : e);
  }
  return map;
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
