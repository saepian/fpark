import { NextRequest } from 'next/server';
import { fetchSectorPeers } from '@/lib/sector-peers';

export const dynamic = 'force-dynamic';

// 실제 스크래핑 로직은 lib/sector-peers.ts의 fetchSectorPeers로 이동(2026-07-13,
// 기업분석 페이지 업종 대비 비교 기능과 공유하기 위해 추출).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

  try {
    const peers = await fetchSectorPeers(ticker);
    return Response.json(peers);
  } catch (err) {
    console.error(`[sector] ${ticker}:`, err);
    return Response.json([]);
  }
}
