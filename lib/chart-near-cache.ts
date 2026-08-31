import { after } from 'next/server';
import { fetchChartBackTo } from './kis-api';
import { supabase } from './supabase';
import { kstYearMonthDay, kstMidnight, kstDateStr } from './ai-grounding';
import type { ChartDataPoint } from './types';

// app/api/stock/[ticker]/chart-near/route.ts에서 추출 — 대시보드 월별 수익률 추이도
// 같은 "오늘부터 목표월까지 연쇄 백필 + 1일 캐시" 로직이 필요해졌다(2026-08-13). 원래
// 라우트의 동작(캐시 read/write, 부분백필 시 캐싱 스킵, 완전실패 시 stale 캐시로 대체)을
// 그대로 유지한 채 재사용 가능한 함수로만 옮겼다 — 로직 변경 없음.
//
// PriceChangeTable의 "1년 전"/"6개월 전" 칸 전용 — /api/stock/[ticker]/chart?period=1Y는
// KIS의 100건 캡 때문에 실제로는 최근 ~5개월치만 주므로(lib/kis-api.ts fetchChartRangeRaw
// 주석 참고) 그 이전 시점은 이 함수로 따로 조회한다. monthsAgo로 몇 개월 전까지 커버할지
// 파라미터화.
// 2026-08-03: 예전엔 목표일 근방 14일만 좁게 조회해 반환했는데, 이러면 그 스냅샷과
// main(1Y)/다른 monthsAgo 스냅샷 사이에 큰 공백이 생겨 그 구간의 실제 고점/저점이
// 누락되는 버그가 있었다(S-Oil 2026-03-04 고가 177,100원 누락 사례로 실측 확인).
// fetchChartBackTo로 교체해 오늘부터 목표월까지 빈틈없이 연쇄 조회한다.
const cacheKey = (ticker: string, monthsAgo: number) => `stock_chart_near_${monthsAgo}m_${ticker}`;

// 목표일이 매일 하루씩 밀리긴 하지만, 하루 단위로 갱신되면 충분히 정확하다 — price처럼
// 분 단위 신선도가 필요한 데이터가 아니다. 캐시 키에 날짜를 넣지 않고 같은 키를 매일
// 덮어써서 market_cache에 종목당 행이 쌓이지 않게 한다.
const CACHE_TTL_MS = 24 * 60 * 60_000;

async function loadCache(ticker: string, monthsAgo: number): Promise<{ data: ChartDataPoint[]; updatedAt: string } | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKey(ticker, monthsAgo))
      .single();
    if (!cache?.data) return null;
    return { data: cache.data as ChartDataPoint[], updatedAt: cache.updated_at };
  } catch {
    return null;
  }
}

function saveCache(ticker: string, monthsAgo: number, data: ChartDataPoint[]) {
  after(async () => {
    const { error } = await supabase
      .from('market_cache')
      .upsert({ key: cacheKey(ticker, monthsAgo), data, updated_at: new Date().toISOString() });
    if (error) console.warn(`[CHART-NEAR-CACHE] ${ticker} 캐시 저장 실패:`, error.message);
  });
}

// 2026-08-11 발견: fetchChartBackTo는 각 청크 호출이 실패하면 즉시 break하고 그때까지
// 모은 것만 반환하는데(lib/kis-api.ts), 예전 코드는 이 결과가 실제로 targetDate까지
// 도달했는지 확인하지 않고 "length > 0이면 성공"으로 24시간 캐싱했다 — 삼성전자(005930)가
// 이 경로로 1개 청크(약 5개월치)만 캐싱된 채 하루 종일 서빙되며 "기간별 등락률" 표에서
// 1년 전·6개월 전 행이 빠지는 버그로 실측 확인됨. 가장 오래된 데이터포인트가 목표일
// 근방(허용 오차 이내)까지 도달했는지 검증해서, 못 미쳤으면(부분 성공) 캐싱을 건너뛴다.
// 허용 오차 14일은 fetchChartNear가 이미 쓰고 있는 것과 동일한 값 — 설/추석 등 최대 5일
// 연휴 + 주말이 겹쳐도 그 근방에 실제 거래일이 있으므로 충분하다.
const BACKFILL_TOLERANCE_DAYS = 14;

function reachedTarget(data: ChartDataPoint[], targetDate: Date): boolean {
  if (data.length === 0) return false;
  const earliest = new Date(data[0].date); // fetchChartBackTo가 이미 오름차순 정렬해서 반환
  const toleranceMs = BACKFILL_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
  return earliest.getTime() <= targetDate.getTime() + toleranceMs;
}

export async function getCachedChartNear(ticker: string, monthsAgo: number): Promise<ChartDataPoint[]> {
  const fresh = await loadCache(ticker, monthsAgo);
  if (fresh && Date.now() - new Date(fresh.updatedAt).getTime() < CACHE_TTL_MS) {
    return fresh.data;
  }

  const { year, month, day } = kstYearMonthDay(new Date());
  const targetDate = kstMidnight(year, month - monthsAgo, day);

  const data = await fetchChartBackTo(ticker, targetDate);

  if (data.length > 0 && reachedTarget(data, targetDate)) {
    saveCache(ticker, monthsAgo, data);
    return data;
  }

  if (data.length > 0) {
    // 부분 성공(목표일 근방까지 도달 못함, 연쇄 백필 중 어느 청크가 실패했을 가능성) —
    // 캐싱하면 이 불완전한 결과가 24시간 동안 계속 서빙된다. 캐싱은 건너뛰고 이번
    // 요청엔 부분 데이터라도 그대로 반환(완전히 빈 것보다는 낫다) — 다음 요청이
    // 새로 재시도하게 둔다.
    console.warn(`[CHART-NEAR-CACHE] ${ticker} (${monthsAgo}개월 전) 목표일 미도달 — 가장 오래된 데이터: ${data[0].date}, 캐싱 생략(부분 결과만 반환)`);
    return data;
  }

  // 완전 실패 — 휴장일 등으로 창 안에 데이터가 없을 수 있으므로 캐시된 마지막 결과로 대체
  if (fresh) {
    console.error(`[CHART-NEAR-CACHE] ${ticker} (${monthsAgo}개월 전) 조회 실패, 캐시로 대체 반환`);
    return fresh.data;
  }

  return [];
}

// 이 캐시가 "오늘(KST)" 안에 한 번이라도 갱신됐는지 — 대시보드 "오늘의 등락" 위젯의 거래일
// 판정(getDomesticMarketDayContext)에 이 캐시를 재사용할 때, "마지막 차트 행이 오늘이
// 아니다"라는 신호를 믿어도 되는지 판단하는 데 쓴다. 2026-08-31 QA에서 실측된 버그: 이
// 캐시는 24시간 롤링 TTL이라 토요일 오후에 갱신되면 월요일 오후까지("24시간 후") "신선함"
// 취급되며 그 안엔 금요일 마감 데이터만 들어있다 — 그 결과 월요일 오전(실제 거래일)에
// "8월29일(금) 마감 기준"처럼 실제로는 거래일인데 비거래일로 오라벨링됐다. 캐시가 오늘
// 갱신된 적이 없다면(주말 동안 아무도 안 불러 그대로 남아있는 경우 등) "오늘 데이터가
// 없다"는 사실 자체를 신뢰할 수 없으므로, 호출부가 이 값이 false일 때는 거래일 판정을
// 건너뛰고 보수적으로 거래일로 간주해야 한다.
export async function isChartCacheFreshFromToday(ticker: string, monthsAgo: number): Promise<boolean> {
  const cache = await loadCache(ticker, monthsAgo);
  if (!cache) return false;
  return kstDateStr(new Date(cache.updatedAt)) === kstDateStr(new Date());
}
