import { NextRequest, NextResponse } from 'next/server';
import { fetchDailyChart } from '../../../../../lib/kis-api';
import { supabase } from '../../../../../lib/supabase';
import type { ChartDataPoint } from '../../../../../lib/types';

export const dynamic = 'force-dynamic';

const VALID_PERIODS = ['1W', '1M', '3M', '1Y'] as const;
type Period = (typeof VALID_PERIODS)[number];

// app/api/stock/[ticker]/info/route.ts와 동일한 market_cache 패턴 재사용
const cacheKey = (ticker: string, period: Period) => `stock_chart_${ticker}_${period}`;

async function loadCache(ticker: string, period: Period): Promise<{ data: ChartDataPoint[]; updatedAt: string } | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKey(ticker, period))
      .single();
    if (!cache?.data) return null;
    return { data: cache.data as ChartDataPoint[], updatedAt: cache.updated_at };
  } catch {
    return null;
  }
}

function saveCache(ticker: string, period: Period, data: ChartDataPoint[]) {
  supabase
    .from('market_cache')
    .upsert({ key: cacheKey(ticker, period), data, updated_at: new Date().toISOString() })
    .then(({ error }) => {
      if (error) console.warn(`[CHART] ${ticker} 캐시 저장 실패:`, error.message);
    });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const period = (req.nextUrl.searchParams.get('period') ?? '1M') as Period;

  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json({ error: '유효하지 않은 기간입니다.' }, { status: 400 });
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await fetchDailyChart(ticker, period);
      saveCache(ticker, period, data);
      return NextResponse.json(data);
    } catch (e) {
      lastErr = e;
      console.warn(`[CHART] ${ticker} 조회 ${attempt + 1}차 시도 실패:`, e instanceof Error ? e.message : e);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : '알 수 없는 오류';

  // 재시도까지 실패 — 휴장일 등으로 당일 데이터가 없을 뿐일 수 있으므로 캐시된 마지막 차트로 대체
  const cached = await loadCache(ticker, period);
  if (cached) {
    console.error(`[CHART] ${ticker} 조회 최종 실패, 캐시로 대체 반환:`, message);
    return NextResponse.json(cached.data);
  }

  console.error(`[CHART] ${ticker} 조회 최종 실패, 캐시도 없음:`, message);
  return NextResponse.json({ error: message }, { status: 500 });
}
