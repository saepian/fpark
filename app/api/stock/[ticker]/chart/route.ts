import { NextRequest, NextResponse } from 'next/server';
import { fetchDailyChart, loadDailyChartCache } from '../../../../../lib/kis-api';

export const dynamic = 'force-dynamic';

const VALID_PERIODS = ['1W', '1M', '3M', '1Y'] as const;
type Period = (typeof VALID_PERIODS)[number];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const period = (req.nextUrl.searchParams.get('period') ?? '1M') as Period;

  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json({ error: '유효하지 않은 기간입니다.' }, { status: 400 });
  }

  // 2026-08-28: TTL 캐시(장중 5분/장외 1시간, 1Y만 해당)는 fetchDailyChart 내부로
  // 옮겨졌다(lib/kis-api.ts) — dashboard/risk, portfolio-diagnosis 등 다른 라우트와
  // 캐시를 공유해 같은 티커의 1년치 차트를 KIS에 중복 조회하지 않기 위함. 이 라우트는
  // 재시도 + (전부 실패 시) 마지막 캐시로 대체하는 장애 대응만 담당한다.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await fetchDailyChart(ticker, period);
      return NextResponse.json(data);
    } catch (e) {
      lastErr = e;
      console.warn(`[CHART] ${ticker} 조회 ${attempt + 1}차 시도 실패:`, e instanceof Error ? e.message : e);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : '알 수 없는 오류';

  // 재시도까지 실패 — 휴장일 등으로 당일 데이터가 없을 뿐일 수 있으므로 캐시된 마지막 차트로 대체
  // (fetchDailyChart가 1Y만 캐시하므로 실질적으로 1Y 요청에만 대체 데이터가 있다)
  const cached = await loadDailyChartCache(ticker, period);
  if (cached) {
    console.error(`[CHART] ${ticker} 조회 최종 실패, 캐시로 대체 반환:`, message);
    return NextResponse.json(cached.data);
  }

  console.error(`[CHART] ${ticker} 조회 최종 실패, 캐시도 없음:`, message);
  return NextResponse.json({ error: message }, { status: 500 });
}
