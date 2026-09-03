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
    // 2026-09-03 트래픽점검 10번: 클릭 1번에 넓은 업종이면 최대 41건이 fan-out되는 서버 내부
    // 배치 호출 — 'batch'(소프트캡에서 거부 대신 대기, lib/kis-api.ts acquireKisRateSlot).
    const { peers } = await fetchSectorPeers(ticker, { priority: 'batch' });
    return Response.json(peers);
  } catch (err) {
    console.error(`[sector] ${ticker}:`, err);
    return Response.json([]);
  }
}
