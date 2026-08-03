import { NextRequest, NextResponse, after } from 'next/server';
import { fetchChartBackTo } from '../../../../../lib/kis-api';
import { supabase } from '../../../../../lib/supabase';
import { kstYearMonthDay, kstMidnight } from '../../../../../lib/ai-grounding';
import type { ChartDataPoint } from '../../../../../lib/types';

export const dynamic = 'force-dynamic';

// PriceChangeTable의 "1년 전"/"6개월 전" 칸 전용 — /api/stock/[ticker]/chart?period=1Y는
// KIS의 100건 캡 때문에 실제로는 최근 ~5개월치만 주므로(lib/kis-api.ts fetchChartRangeRaw
// 주석 참고) 그 이전 시점은 이 라우트로 따로 조회한다. monthsAgo로 몇 개월 전까지
// 커버할지 파라미터화.
// 2026-08-03: 예전엔 목표일 근방 14일만 좁게 조회해 반환했는데, 이러면 그 스냅샷과
// main(1Y)/다른 monthsAgo 스냅샷 사이에 큰 공백이 생겨 그 구간의 실제 고점/저점이
// 누락되는 버그가 있었다(S-Oil 2026-03-04 고가 177,100원 누락 사례로 실측 확인).
// fetchChartBackTo로 교체해 오늘부터 목표월까지 빈틈없이 연쇄 조회한다 — near12
// 하나만으로 6개월 전 시점도 포함하는 연속 데이터가 되므로, PriceChangeTable은
// 더 이상 near6를 따로 부르지 않아도 된다.
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
    if (error) console.warn(`[CHART-NEAR] ${ticker} 캐시 저장 실패:`, error.message);
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const monthsAgoParam = Number(req.nextUrl.searchParams.get('monthsAgo'));
  const monthsAgo = Number.isFinite(monthsAgoParam) && monthsAgoParam > 0 ? monthsAgoParam : 12;

  const fresh = await loadCache(ticker, monthsAgo);
  if (fresh && Date.now() - new Date(fresh.updatedAt).getTime() < CACHE_TTL_MS) {
    return NextResponse.json(fresh.data);
  }

  const { year, month, day } = kstYearMonthDay(new Date());
  const targetDate = kstMidnight(year, month - monthsAgo, day);

  const data = await fetchChartBackTo(ticker, targetDate);
  if (data.length > 0) {
    saveCache(ticker, monthsAgo, data);
    return NextResponse.json(data);
  }

  // 실패 — 휴장일 등으로 창 안에 데이터가 없을 수 있으므로 캐시된 마지막 결과로 대체
  if (fresh) {
    console.error(`[CHART-NEAR] ${ticker} (${monthsAgo}개월 전) 조회 실패, 캐시로 대체 반환`);
    return NextResponse.json(fresh.data);
  }

  return NextResponse.json([]);
}
