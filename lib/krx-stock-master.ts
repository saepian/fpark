import { unstable_cache, revalidateTag } from 'next/cache';
import { adminClient } from './supabase-admin';
import { fetchKrxListedInfoOfficial } from './krx-official-api';
import { PREFERRED_STOCKS } from './preferred-stock-master';

// 국내(KOSPI/KOSDAQ) 종목 검색용 자체 마스터 테이블(stock_master) 관리.
//
// 배경: app/api/search가 매 검색요청마다 kind.krx.co.kr(KRX 상장법인목록 다운로드
// 페이지)을 실시간 스크래핑했는데, KRX가 Vercel 서버리스 IP를 403으로 차단하기
// 시작해(2026-08-18 실측) 국내 종목 검색이 완전히 막혔다. 이 스크래핑 로직 자체는
// 그대로 재사용하되, 매 요청이 아니라 크론(app/api/cron/stock-master-refresh)이
// 하루 1회만 실행해서 stock_master 테이블에 upsert한다. 검색 API는 이 테이블만
// 읽는다 — KRX가 다시 막혀도 그날 갱신만 건너뛰고 테이블의 기존 데이터로 계속 서빙.
//
// 2026-08-21: 그런데 이 크론 자체도 Vercel 서버리스에서 도는 이상 같은 403 차단에
// 노출된다는 게 남은 운영 갭이었다(스크래핑 대상만 매 요청→하루 1회로 줄였을 뿐,
// 스크래핑이라는 구조 자체는 그대로였음). lib/krx-official-api.ts(공공데이터포털
// 공식 API)를 1차 소스로 승격하고, 이 파일의 KRX 스크래핑은 신규 소스가 아직 실
// API로 검증되지 않은 과도기 + 향후 공공데이터포털 자체가 일시 장애/쿼터초과일
// 상황을 위한 2차 폴백으로 낮춰서 유지한다(완전 삭제는 신규 소스가 몇 주간 안정
// 확인된 뒤 별도로 진행 — 지금 지우면 이중 안전망이 없어짐).

export interface StockMasterEntry {
  ticker: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
}

// 2026-09-03 트래픽점검 6번: /api/search가 콜드스타트마다(서버리스 인스턴스가 새로
// 뜰 때마다) stock_master 2,781행을 통째로 재조회했다 — search/route.ts에 있던
// 인스턴스 메모리 캐시(let stockCache)는 인스턴스별로 독립이라 접속자가 몰려 인스턴스가
// 여러 개 뜨면 그 재적재가 인스턴스 수만큼 중복 발생했다(실측: 20 동시요청 p50 6.3s).
// Next.js unstable_cache는 Vercel Data Cache(서버리스 인스턴스 경계를 넘어 공유되는
// 외부 캐시)에 저장되므로, 이걸로 바꾸면 같은 배포 안의 모든 인스턴스가 최초 1회만
// DB를 읽고 그 뒤로는 공유 캐시를 재사용한다 — 콜드스타트마다 재조회하던 근본 원인
// 자체가 없어진다(단순 인메모리 캐시로는 애초에 풀 수 없는 문제).
export const STOCK_MASTER_CACHE_TAG = 'stock-master';
// stock_master 갱신 빈도: 크론(app/api/cron/stock-master-refresh)이 하루 1회(vercel.json
// "10 17 * * *" = 02:10 KST) KOSPI/KOSDAQ 전체를 upsert한다. KRX 신규상장·상장폐지는
// 실무적으로 하루 여러 건이 아니라 한 달에 몇 건 수준의 드문 이벤트라(공시 기반 공지 후
// 반영), 24시간보다 훨씬 짧은 주기로 캐시를 갱신할 실익이 없다 — 크론과 같은 24시간을
// revalidate 상한으로 두되, 아래 refreshStockMaster()가 크론 실행 직후 revalidateTag로
// 즉시 무효화도 같이 하므로 실질 반영은 대부분 크론 완료 시점(하루 1회, 수 분 이내)이다.
const STOCK_MASTER_REVALIDATE_SEC = 24 * 60 * 60;

async function fetchKrxMarket(market: 'KOSPI' | 'KOSDAQ'): Promise<StockMasterEntry[]> {
  const marketType = market === 'KOSPI' ? 'stockMkt' : 'kosdaqMkt';
  const res = await fetch(
    `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType=${marketType}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://kind.krx.co.kr/corpgeneral/corpList.do',
      },
      cache: 'no-store',
    }
  );

  if (!res.ok) throw new Error(`KRX ${market} 조회 실패 [${res.status}]`);

  const buffer = await res.arrayBuffer();
  const html = new TextDecoder('euc-kr').decode(buffer);

  const items: StockMasterEntry[] = [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;
  let isHeader = true;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    if (isHeader) { isHeader = false; continue; }
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    }
    if (cells.length >= 3) {
      const name = cells[0];
      const code = cells[2].replace(/\s/g, '');
      if (name && code.length === 6 && /^\d+$/.test(code)) {
        items.push({ ticker: code, name, market });
      }
    }
  }

  return items;
}

export interface RefreshStockMasterResult {
  kospi:     { ok: boolean; count: number };
  kosdaq:    { ok: boolean; count: number };
  preferred: { ok: boolean; count: number };
}

// 한 시장의 종목 목록을 stock_master에 upsert. 소스(공공데이터포털/KRX 스크래핑)와
// 무관하게 공용 — 두 경로 모두 이 함수로 수렴한다.
// market은 로그 라벨용일 뿐 실제 DB에 쓰이는 값은 items 각 행 자신의 .market 필드다
// (PREFERRED_STOCKS처럼 KOSPI/KOSDAQ이 섞인 배열을 한 번에 넘길 수 있는 이유).
async function upsertMarket(market: string, items: StockMasterEntry[]): Promise<{ ok: boolean; count: number }> {
  if (items.length === 0) return { ok: false, count: 0 };

  // 동일 종목코드가 중복 행으로 오는 경우가 있어(KRX HTML 스크래핑에서 실측 확인,
  // 2026-08-18) 같은 upsert 배치 안에 동일 PK가 두 번 들어가면 Postgres가
  // "ON CONFLICT DO UPDATE command cannot affect row a second time"로 거부한다 —
  // ticker 기준으로 배치 내 중복을 제거해서 넘긴다. 공공데이터포털 응답에도 동일하게
  // 적용해두면 혹시 모를 중복에 대해서도 안전하다.
  const now = new Date().toISOString();
  const dedupedByTicker = new Map(items.map((item) => [item.ticker, item]));
  const rows = Array.from(dedupedByTicker.values()).map((item) => ({ ...item, updated_at: now }));
  const { error } = await adminClient.from('stock_master').upsert(rows, { onConflict: 'ticker' });
  if (error) {
    console.error(`[stock-master] ${market} upsert 실패, 기존 테이블 데이터 유지:`, error);
    return { ok: false, count: 0 };
  }

  console.log(`[stock-master] ${market} 갱신 완료 — ${rows.length}건`);
  return { ok: true, count: rows.length };
}

// 1차: 공공데이터포털 공식 API(한 번의 호출로 KOSPI/KOSDAQ 모두 획득). 실패하거나
// 특정 시장이 비어있으면, 그 시장만 2차 폴백(KRX 스크래핑)으로 재시도한다. 두 경로
// 모두 실패한 시장은 기존 테이블 데이터를 그대로 유지한다(크론이 며칠 실패해도
// 검색 자체는 계속 동작).
export async function refreshStockMaster(): Promise<RefreshStockMasterResult> {
  const result: RefreshStockMasterResult = {
    kospi:     { ok: false, count: 0 },
    kosdaq:    { ok: false, count: 0 },
    preferred: { ok: false, count: 0 },
  };

  try {
    const items = await fetchKrxListedInfoOfficial();
    const kospiItems  = items.filter((i) => i.market === 'KOSPI');
    const kosdaqItems = items.filter((i) => i.market === 'KOSDAQ');
    result.kospi  = await upsertMarket('KOSPI', kospiItems);
    result.kosdaq = await upsertMarket('KOSDAQ', kosdaqItems);
  } catch (e) {
    console.error('[stock-master] 공공데이터포털 API 실패, KRX 스크래핑 폴백 시도:', e instanceof Error ? e.message : e);
  }

  const marketsToFallback = (['KOSPI', 'KOSDAQ'] as const).filter(
    (m) => !result[m === 'KOSPI' ? 'kospi' : 'kosdaq'].ok,
  );

  if (marketsToFallback.length > 0) {
    console.warn(`[stock-master] KRX 스크래핑 폴백 대상: ${marketsToFallback.join(', ')}`);
    const settled = await Promise.allSettled(marketsToFallback.map((m) => fetchKrxMarket(m)));

    for (let i = 0; i < marketsToFallback.length; i++) {
      const market = marketsToFallback[i];
      const key = market === 'KOSPI' ? 'kospi' : 'kosdaq';
      const s = settled[i];
      if (s.status === 'rejected') {
        console.error(`[stock-master] ${market} KRX 스크래핑 폴백도 실패, 기존 테이블 데이터 유지:`, s.reason);
        continue;
      }
      if (s.value.length === 0) {
        console.error(`[stock-master] ${market} KRX 스크래핑 폴백 결과 0건 — 응답 포맷 변경 의심, 갱신 생략(기존 데이터 유지)`);
        continue;
      }
      result[key] = await upsertMarket(market, s.value);
    }
  }

  // 우선주(lib/preferred-stock-master.ts) — 위 두 데이터소스 모두 "상장법인목록" 성격이라
  // 원천적으로 우선주를 안 내려주는 것을 확인(2026-08-28)하고 추가한 정적 보완 테이블.
  // KOSPI/KOSDAQ 갱신 성패와 무관하게 매번 upsert — 정적 데이터라 실패 사유가 따로 없다.
  // 2026-09-03부터 KOSDAQ 우선주도 섞여 있음(각 행의 .market 필드로 구분, upsertMarket의
  // 첫 인자는 로그 라벨일 뿐).
  result.preferred = await upsertMarket('KOSPI+KOSDAQ', PREFERRED_STOCKS);

  // 2026-09-03 트래픽점검 6번: 아래 getStockMasterListCached()의 Vercel Data Cache를
  // 즉시 무효화 — 이 크론이 하루 1회(vercel.json 02:10 KST) 실행될 때마다 검색 API가
  // 최대 24시간(그 캐시의 revalidate 주기) 기다리지 않고 바로 새 목록을 반영하게 한다.
  // 부분 실패(예: KOSPI만 갱신 성공)여도 무효화한다 — 갱신된 부분만이라도 최신으로
  // 반영하는 게 아무것도 안 하는 것보다 낫고, 실패한 시장은 upsertMarket이 기존 행을
  // 그대로 두므로 캐시를 다시 채워도 손실이 없다.
  try {
    revalidateTag(STOCK_MASTER_CACHE_TAG);
  } catch (e) {
    // 크론 실행 컨텍스트에 따라 revalidateTag가 지원되지 않을 수 있음(예: 특정 런타임) —
    // 실패해도 revalidate(24시간) 시간기반 만료가 안전망으로 남는다.
    console.warn('[stock-master] revalidateTag 실패(24시간 시간기반 만료로 대체됨):', e instanceof Error ? e.message : e);
  }

  return result;
}

// 2026-08-25 발견: .range() 없는 단순 select는 Supabase(PostgREST) 기본 응답 상한
// (db-max-rows, 기본 1000행)에 조용히 걸린다 — stock_master가 8/24 최초로 1000행을
// 넘기면서(2597건) SK하이닉스(000660) 등 대형주까지 임의로 누락되는 게 실측 확인됐다
// (검색 결과에 어떤 종목이 빠질지는 티커·시총과 무관하게 소스 API 응답 순서에 좌우됨).
// .range() 페이지네이션으로 끝까지 읽어야 전체 목록이 보장된다.
export async function getStockMasterList(): Promise<StockMasterEntry[]> {
  const PAGE_SIZE = 1000;
  const all: StockMasterEntry[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await adminClient
      .from('stock_master')
      .select('ticker, name, market')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as StockMasterEntry[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// 검색 API 등 소비처는 이 캐시된 버전을 써야 한다 — 위 getStockMasterList() 자체(원본
// DB 조회)는 그대로 두고(refreshStockMaster 등 "항상 최신을 직접 읽어야 하는" 내부용은
// 원본을 계속 씀), unstable_cache로 감싼 버전만 새로 노출한다. 캐시 키가 인자를 안 받는
// 상수 함수라 하나의 전역 엔트리만 생긴다.
export const getStockMasterListCached = unstable_cache(
  getStockMasterList,
  ['stock-master-list'],
  { tags: [STOCK_MASTER_CACHE_TAG], revalidate: STOCK_MASTER_REVALIDATE_SEC },
);
