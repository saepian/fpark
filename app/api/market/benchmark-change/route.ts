import { NextRequest, NextResponse, after } from 'next/server';
import { fetchIndexRangeChange } from '../../../../lib/kis-api';
import { supabase } from '../../../../lib/supabase';
import { isKoreanMarketOpen } from '../../../../lib/market-utils';
import { kstYearMonthDay, kstMidnight } from '../../../../lib/ai-grounding';

export const dynamic = 'force-dynamic';

type Market = 'KOSPI' | 'KOSDAQ';
type BenchmarkLabel = '1년 전' | '6개월 전' | '1개월 전' | '1주일 전';

// PriceChangeTable "지수 대비" 컬럼 전용 — 같은 시장(KOSPI/KOSDAQ) 안의 모든 종목이
// 같은 지수 등락률을 참조하므로 종목별이 아니라 시장별로 캐싱한다. 종목 페이지를
// 몇 개를 보든 KOSPI/KOSDAQ 각각 캐시 1건만 채우면 되므로 chart 계열 라우트보다도
// KIS 호출이 훨씬 적게 든다.
const cacheKey = (market: Market) => `benchmark_change_${market}`;

// chart-near와 동일한 이유로 장중/장외 TTL을 나눈다 — 오늘 지수 값만 장중에
// 바뀌고 과거 구간 등락률은 하루 단위로만 갱신되면 충분하다.
const CACHE_TTL_MS_OPEN = 5 * 60_000;
const CACHE_TTL_MS_CLOSED = 60 * 60_000;

async function loadCache(market: Market): Promise<{ data: Partial<Record<BenchmarkLabel, number>>; updatedAt: string } | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKey(market))
      .single();
    if (!cache?.data) return null;
    return { data: cache.data as Partial<Record<BenchmarkLabel, number>>, updatedAt: cache.updated_at };
  } catch {
    return null;
  }
}

function saveCache(market: Market, data: Partial<Record<BenchmarkLabel, number>>) {
  after(async () => {
    const { error } = await supabase
      .from('market_cache')
      .upsert({ key: cacheKey(market), data, updated_at: new Date().toISOString() });
    if (error) console.warn(`[BENCHMARK-CHANGE] ${market} 캐시 저장 실패:`, error.message);
  });
}

export async function GET(req: NextRequest) {
  const marketParam = req.nextUrl.searchParams.get('market');
  const market: Market = marketParam === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';

  const ttlMs = isKoreanMarketOpen() ? CACHE_TTL_MS_OPEN : CACHE_TTL_MS_CLOSED;
  const fresh = await loadCache(market);
  if (fresh && Date.now() - new Date(fresh.updatedAt).getTime() < ttlMs) {
    return NextResponse.json(fresh.data);
  }

  const indexCode = market === 'KOSDAQ' ? '1001' : '0001';
  const now = new Date();
  const { year, month, day } = kstYearMonthDay(now);
  const targets: { label: BenchmarkLabel; from: Date }[] = [
    { label: '1년 전', from: kstMidnight(year - 1, month, day) },
    { label: '6개월 전', from: kstMidnight(year, month - 6, day) },
    { label: '1개월 전', from: kstMidnight(year, month - 1, day) },
    { label: '1주일 전', from: kstMidnight(year, month, day - 7) },
  ];

  const results = await Promise.all(targets.map((t) => fetchIndexRangeChange(indexCode, t.from, now)));
  const data: Partial<Record<BenchmarkLabel, number>> = {};
  targets.forEach((t, i) => {
    const r = results[i];
    if (r) data[t.label] = r.changeRate;
  });

  if (Object.keys(data).length > 0) {
    saveCache(market, data);
    return NextResponse.json(data);
  }

  // 실패 — 캐시된 마지막 값으로 대체(휴장일 등으로 지수 데이터가 잠깐 비었을 수 있음)
  if (fresh) return NextResponse.json(fresh.data);
  return NextResponse.json({});
}
