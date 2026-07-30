import { NextRequest, NextResponse, after } from 'next/server';
import { fetchChartNear } from '../../../../../lib/kis-api';
import { supabase } from '../../../../../lib/supabase';
import { kstYearMonthDay, kstMidnight } from '../../../../../lib/ai-grounding';
import type { ChartDataPoint } from '../../../../../lib/types';

export const dynamic = 'force-dynamic';

// PriceChangeBadges의 "1년 전" 칸 전용 — /api/stock/[ticker]/chart?period=1Y는 KIS의 100건
// 캡 때문에 실제로는 최근 ~5개월치만 주므로(lib/kis-api.ts fetchChartRangeRaw 주석 참고)
// 1년 전 근방만 좁게 조회하는 fetchChartNear를 별도 라우트로 노출한다.
const cacheKey = (ticker: string) => `stock_chart_near1y_${ticker}`;

// 목표일(1년 전)이 매일 하루씩 밀리긴 하지만, 하루 단위로 갱신되면 충분히 정확하다
// — price처럼 분 단위 신선도가 필요한 데이터가 아니다. 캐시 키에 날짜를 넣지 않고
// 같은 키를 매일 덮어써서 market_cache에 종목당 행이 쌓이지 않게 한다.
const CACHE_TTL_MS = 24 * 60 * 60_000;

async function loadCache(ticker: string): Promise<{ data: ChartDataPoint[]; updatedAt: string } | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKey(ticker))
      .single();
    if (!cache?.data) return null;
    return { data: cache.data as ChartDataPoint[], updatedAt: cache.updated_at };
  } catch {
    return null;
  }
}

function saveCache(ticker: string, data: ChartDataPoint[]) {
  after(async () => {
    const { error } = await supabase
      .from('market_cache')
      .upsert({ key: cacheKey(ticker), data, updated_at: new Date().toISOString() });
    if (error) console.warn(`[CHART-NEAR-1Y] ${ticker} 캐시 저장 실패:`, error.message);
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  const fresh = await loadCache(ticker);
  if (fresh && Date.now() - new Date(fresh.updatedAt).getTime() < CACHE_TTL_MS) {
    return NextResponse.json(fresh.data);
  }

  const { year, month, day } = kstYearMonthDay(new Date());
  const targetDate = kstMidnight(year - 1, month, day);

  const data = await fetchChartNear(ticker, targetDate);
  if (data.length > 0) {
    saveCache(ticker, data);
    return NextResponse.json(data);
  }

  // 실패 — 휴장일 등으로 창 안에 데이터가 없을 수 있으므로 캐시된 마지막 결과로 대체
  if (fresh) {
    console.error(`[CHART-NEAR-1Y] ${ticker} 조회 실패, 캐시로 대체 반환`);
    return NextResponse.json(fresh.data);
  }

  return NextResponse.json([]);
}
