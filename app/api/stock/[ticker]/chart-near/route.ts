import { NextRequest, NextResponse } from 'next/server';
import { getCachedChartNear } from '../../../../../lib/chart-near-cache';

export const dynamic = 'force-dynamic';

// 캐시 read/write·연쇄 백필·부분실패 처리 로직은 lib/chart-near-cache.ts로 옮겼다
// (2026-08-13, 대시보드 월별 수익률 추이도 같은 로직이 필요해져 재사용 목적으로 추출 —
// 동작 변경 없음).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const monthsAgoParam = Number(req.nextUrl.searchParams.get('monthsAgo'));
  const monthsAgo = Number.isFinite(monthsAgoParam) && monthsAgoParam > 0 ? monthsAgoParam : 12;

  const data = await getCachedChartNear(ticker, monthsAgo);
  return NextResponse.json(data);
}
