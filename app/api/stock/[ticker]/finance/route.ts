import { NextRequest } from 'next/server';
import { fetchAnnualFinancialsCached } from '@/lib/kis-api';

// 2026-09-03 트래픽점검 2번: 종목상세 페이지 로드마다 캐시 없이 KIS를 직접 호출하던 것을
// market_cache TTL 캐싱으로 전환(fetchAnnualFinancialsCached — lib/kis-api.ts). 실제 조회
// 로직은 fetchAnnualFinancials로 이동(2026-07-13, 기업분석 페이지 실적 추이 기능과 공유).
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

  try {
    const result = await fetchAnnualFinancialsCached(ticker);
    return Response.json(result);
  } catch (err) {
    console.error(`[finance] ${ticker}:`, err);
    return Response.json([]);
  }
}
