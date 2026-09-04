import { NextRequest, NextResponse } from 'next/server';
import { getStockMasterListCached, type StockMasterEntry } from '../../../lib/krx-stock-master';
import { rankStockMaster, getSearchWeightsCached, isPureKoreanQuery, type SearchWeights } from '../../../lib/stock-search';
import type { SearchResult } from '../../../lib/types';

// 2026-08-31 트래픽 점검: 이 라우트는 비로그인 포함 모든 방문자의 헤더 검색창이
// 키 입력마다(200ms 디바운스) 호출하고, 매 호출이 국내 매칭 상위 5종목의 시세를
// KIS에 라이브 조회하고 있었다 — KIS는 전역 초당 15건 하드캡(lib/kis-api.ts
// acquireKisRateSlot)이라 동시에 타이핑하는 방문자 3~4명만으로도 대시보드·관심종목·
// 알림 크론까지 공유하는 KIS 예산을 통째로 잠식하는 구조였다. 같은 날 도입한 공용
// 시세 캐시 fetchStockPriceCached(장중 30초/장외 30분, /price·watchlist·dashboard와
// 동일 캐시)를 쓴다 — 처음엔 이 파일 안에 /price 캐시를 읽는 임시 헬퍼를 뒀다가
// lib로 통합하면서 제거.

// 2026-09-04 검색 개선 2번(딜레이): 위 30초 캐시로도 부족했다 — 부분 입력("삼성")의 상위 5종목(삼성화재·
// 삼성제약·삼성공조…)은 다른 화면에서 조회되지 않아 캐시가 30초를 넘기기 일쑤였고, 그때마다 KIS 라이브
// 5건(건당 0.8~1.0s)이 나가 응답이 0.5~1.6s였다(실측). 검색 응답에서 시세를 완전히 제거한다(종목명/코드/
// 시장구분만). 시세는 선택 후 상세 페이지가 기존 캐시 경로로 조회한다. 해외(Yahoo) 시세도 같은 이유로
// 붙이지 않고, Yahoo 검색 자체는 입력이 순수 한글일 때 건너뛴다(영문/숫자 섞이면 실행).
// 랭킹(3번)은 lib/stock-search.ts rankStockMaster — 동점 가중(거래대금·시총, 기존 시세 캐시 재사용), 우선주
// 후순위, 별칭, NFKC.

export const dynamic = 'force-dynamic';

type StockEntry = StockMasterEntry;

// 2026-09-03 트래픽점검 6번: 국내 종목 목록(stock_master, 2,781행)을 예전엔 이 파일
// 안의 인스턴스 메모리 캐시(let stockCache)로 들고 있었는데, 이건 서버리스 인스턴스
// 경계를 못 넘어 접속자가 몰려 인스턴스가 여러 개 뜰 때마다 재적재가 인스턴스 수만큼
// 중복 발생했다(실측: 20 동시요청 콜드스타트 p50 6.3s). lib/krx-stock-master.ts의
// getStockMasterListCached(Next.js unstable_cache, Vercel Data Cache 기반 — 배포 내
// 모든 인스턴스가 공유)로 교체 — 인메모리 캐시 코드 자체를 제거한다.

// 2026-09-01: 해외증시 지원 범위를 미국으로 한정 — 일본(JPX/TYO)·홍콩(HKG)·
// 중국(SHH/SHZ) 거래소를 검색 결과에서 제외한다(해외증시 미국 외 국가 삭제).
const ALLOWED_EXCHANGES = new Set(['NMS', 'NYQ', 'NYSEArca', 'NGM', 'PCX', 'ASE']); // 미국

function getMarket(_exchange: string): string {
  return 'us';
}

function getCurrency(_exchange: string): string {
  return '$';
}

async function searchOverseas(q: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false&region=US`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();

    const quotes: Record<string, unknown>[] = (data.quotes ?? [])
      .filter((item: Record<string, unknown>) =>
        item.quoteType === 'EQUITY' &&
        ALLOWED_EXCHANGES.has(item.exchange as string)
      );

    // 중복 제거: 기본 심볼(점 없음) 우선, 이미 본 기본 심볼이면 점 포함 심볼 제외
    const seenBase = new Set<string>();
    const deduped: Record<string, unknown>[] = [];
    for (const item of quotes) {
      const sym  = item.symbol as string;
      const base = sym.includes('.') ? sym.split('.')[0] : sym;
      if (seenBase.has(base)) continue;
      seenBase.add(base);
      deduped.push(item);
    }

    return deduped.slice(0, 5).map(item => ({
      ticker:     item.symbol as string,
      name:       (item.shortname ?? item.longname ?? item.symbol) as string,
      price:      0,
      changeRate: 0,
      isOverseas: true,
      market:     getMarket(item.exchange as string),
      currency:   getCurrency(item.exchange as string),
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json([]);

  // Yahoo에는 NFKC 정규화 쿼리를 넘긴다(전각 ＳＫ → SK, 국내 매칭과 동일 규칙).
  const overseasPromise: Promise<SearchResult[]> = isPureKoreanQuery(q) ? Promise.resolve([]) : searchOverseas(q.normalize('NFKC'));

  // 국내 stock_master(DataCache 24h) + 동점 가중치(DataCache 1h) + 해외 Yahoo 검색 병렬
  let stockList: StockEntry[];
  let weights: SearchWeights = {};
  try {
    [stockList, weights] = await Promise.all([
      getStockMasterListCached(),
      getSearchWeightsCached().catch((e) => { console.warn('[SEARCH] 가중치 로드 실패(가중 없이 진행):', e instanceof Error ? e.message : e); return {} as SearchWeights; }),
    ]);
  } catch (err) {
    // stock_master는 크론이 하루 1회 채우는 테이블이라 정상 운영 중엔 실패하지 않는다 —
    // 여기 도달하면 DB 연결 장애 등 이상 상황이므로 반드시 로그에 남긴다(2026-08-18).
    console.error('[SEARCH] stock_master 조회 실패:', err);
    // 국내 조회 실패해도 해외 검색은 시도
    return NextResponse.json((await overseasPromise).slice(0, 8));
  }

  const domesticResults: SearchResult[] = rankStockMaster(stockList, q, weights, 5)
    .map((s) => ({ ticker: s.ticker, name: s.name, market: 'kr' }));
  const overseasResults = await overseasPromise;

  return NextResponse.json([...domesticResults, ...overseasResults].slice(0, 8));
}
