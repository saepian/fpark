// /api/search 국내 종목 랭킹 유틸 (2026-09-04 검색 개선 3번).
//
// 조사 결과(같은 날): 정확일치 판정 자체는 정상이었고 문제는 (1) 부분 입력("삼성"/"삼")에서 같은 매칭
// 단계의 동점을 이름 길이→티커순으로만 깨서 삼성화재·삼영 같은 종목이 삼성전자 앞에 오던 것,
// (2) 우선주가 본주와 같은 단계로 섞이던 것, (3) 별칭(네이버→NAVER)·전각 문자(ＳＫ)가 0건이던 것.
// 여기서는 순수 함수(rankStockMaster)로 순위를 매기고, 동점 가중치는 기존 시세 캐시(market_cache의
// stock_quote_raw_* 행에 있는 거래대금/시가총액)만 재사용한다 — 검색 때문에 KIS 호출을 늘리지 않는다.

import { unstable_cache } from 'next/cache';
import { adminClient } from '@/lib/supabase-admin';
import type { StockMasterEntry } from '@/lib/krx-stock-master';

// 자주 검색될 만한 별칭만(전수 아님). 키·값 모두 flatten() 기준(NFKC 소문자 공백제거)으로 비교한다.
// 입력의 "앞부분"이 키와 일치하면 값으로 치환한 변형 쿼리를 추가로 매칭한다(예: "엘지전자" → "lg전자").
export const SEARCH_ALIASES: readonly [string, string][] = [
  ['네이버', 'naver'],
  ['엘지', 'lg'],
  ['에스케이', 'sk'],
  ['케이티', 'kt'],
  ['포스코', 'posco'],
  ['현대자동차', '현대차'],
  ['현차', '현대차'],
  ['삼전', '삼성전자'],
  ['삼바', '삼성바이오로직스'],
  ['하닉', 'sk하이닉스'],
  ['하이닉스', 'sk하이닉스'],
  ['카뱅', '카카오뱅크'],
  ['엘지엔솔', 'lg에너지솔루션'],
  ['엔솔', 'lg에너지솔루션'],
  ['셀트', '셀트리온'],
  ['한화에어로', '한화에어로스페이스'],
  ['두산에너빌', '두산에너빌리티'],
];

// NFKC: 전각 영숫자(ＳＫ)·호환 자모를 반각/표준형으로 접는다(NFC만으로는 전각이 그대로 남아 0건이었음).
export function normalizeSearchText(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}
export function flattenSearchText(s: string): string {
  return normalizeSearchText(s).replace(/\s+/g, '');
}

// 입력 하나 → 매칭에 쓸 변형 목록(원문 flatten + 별칭 치환). 중복 제거.
export function expandQueryVariants(q: string): string[] {
  const flat = flattenSearchText(q);
  const variants = new Set<string>();
  if (flat) variants.add(flat);
  for (const [alias, target] of SEARCH_ALIASES) {
    const a = flattenSearchText(alias);
    if (flat === a || flat.startsWith(a)) variants.add(flattenSearchText(target) + flat.slice(a.length));
  }
  return [...variants];
}

// 우선주: 단축코드 끝자리가 0이 아니면 우선주(005935 삼성전자우, 03473K SK우, 005387 현대차2우B).
// 이름 규칙(…우/우B/우C)은 보조 판정.
export function isPreferredStock(entry: { ticker: string; name: string }): boolean {
  return !/0$/.test(entry.ticker) || /\d?우[A-C]?$/.test(entry.name.trim());
}

// 순수 한글(완성형·자모)과 공백만이면 true — 이때는 Yahoo 해외 검색을 건너뛴다(영문/숫자 섞이면 실행:
// "SK하이닉스" 같은 케이스는 해외 ADR 매칭이 필요할 수 있어 보존).
export function isPureKoreanQuery(q: string): boolean {
  const t = q.trim();
  return t.length > 0 && /^[가-힣ㄱ-ㆎ\s]+$/.test(t);
}

export type SearchWeights = Record<string, { tradingValue: number; marketCap: number }>; // ticker → 거래대금(원), 시가총액(억)

export interface RankedStock extends StockMasterEntry {
  score: 0 | 1 | 2;   // 0 정확일치(이름 또는 티커) / 1 앞부분일치 / 2 부분일치
  preferred: boolean;
}

// 정렬: 매칭 단계 → 본주 우선(우선주 뒤로) → 거래대금 내림차순 → 시가총액 내림차순 → 이름 길이 → 티커.
// 가중치가 없는 종목(캐시에 없음)은 0으로 취급돼 가중치 있는 종목 뒤, 그 안에서는 예전 규칙(이름 길이·티커)대로.
export function rankStockMaster(list: StockMasterEntry[], q: string, weights: SearchWeights = {}, limit = 5): RankedStock[] {
  const rawQ = q.trim();
  const variants = expandQueryVariants(rawQ);
  if (!rawQ || !variants.length) return [];
  const rawQFlat = flattenSearchText(rawQ);

  const scored: RankedStock[] = [];
  for (const s of list) {
    const nFlat = flattenSearchText(s.name);
    let best: 0 | 1 | 2 | null = null;
    if (s.ticker === rawQ || s.ticker.toLowerCase() === rawQFlat) best = 0;
    else if (s.ticker.includes(rawQ)) best = 2;
    for (const v of variants) {
      if (best === 0) break;
      if (nFlat === v) best = 0;
      else if (nFlat.startsWith(v)) best = best == null || best > 1 ? 1 : best;
      else if (nFlat.includes(v)) best = best == null ? 2 : best;
    }
    if (best == null) continue;
    scored.push({ ...s, score: best, preferred: isPreferredStock(s) });
  }
  const w = (t: string) => weights[t] ?? { tradingValue: 0, marketCap: 0 };
  scored.sort((a, b) =>
    a.score - b.score
    || Number(a.preferred) - Number(b.preferred)
    || w(b.ticker).tradingValue - w(a.ticker).tradingValue
    || w(b.ticker).marketCap - w(a.ticker).marketCap
    || a.name.length - b.name.length
    || a.ticker.localeCompare(b.ticker),
  );
  return scored.slice(0, limit);
}

// 기존 공용 시세 캐시(stock_quote_raw_{ticker}: KIS inquire-price 원본)의 acml_tr_pbmn(당일 누적 거래대금,
// 원)·hts_avls(시가총액, 억원)만 JSON 경로 select로 뽑아 온다(2026-09-04 실측 487행 / 54KB / 0.36s).
// 커버리지는 "한 번이라도 시세가 조회된 종목"이라 전 종목이 아니며, 없는 종목은 가중치 0.
// 1시간 DataCache — 검색은 순위만 필요하므로 장중 갱신 지연은 문제되지 않는다.
export async function loadSearchWeights(): Promise<SearchWeights> {
  // JSON 경로 select(data->output->>필드)는 supabase-js 제네릭이 타입을 무한 전개해 TS2589가 나므로 결과만 수동 타입.
  const { data, error } = await (adminClient.from('market_cache') as unknown as {
    select(cols: string): { like(col: string, pat: string): { limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }> } };
  })
    .select('key, avls:data->output->>hts_avls, pbmn:data->output->>acml_tr_pbmn')
    .like('key', 'stock_quote_raw_%')
    .limit(5000);
  if (error) throw new Error(error.message);
  const out: SearchWeights = {};
  for (const r of (data ?? []) as { key: string; avls: string | null; pbmn: string | null }[]) {
    const ticker = r.key.replace('stock_quote_raw_', '');
    out[ticker] = { tradingValue: Number(r.pbmn) || 0, marketCap: Number(r.avls) || 0 };
  }
  return out;
}

export const SEARCH_WEIGHTS_REVALIDATE_SEC = 60 * 60;
export const getSearchWeightsCached = unstable_cache(loadSearchWeights, ['search-weights'], { revalidate: SEARCH_WEIGHTS_REVALIDATE_SEC });
