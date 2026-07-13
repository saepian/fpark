import { NextRequest } from 'next/server';
import { fetchAnnualFinancials } from '@/lib/kis-api';

// 캐시 없음(cache: 'no-store') — 요청마다 KIS를 실시간 호출한다.
// 실제 조회 로직은 lib/kis-api.ts의 fetchAnnualFinancials로 이동(2026-07-13,
// 기업분석 페이지 실적 추이 기능과 공유하기 위해 추출).
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

  try {
    const result = await fetchAnnualFinancials(ticker);
    return Response.json(result);
  } catch (err) {
    console.error(`[finance] ${ticker}:`, err);
    return Response.json([]);
  }
}
