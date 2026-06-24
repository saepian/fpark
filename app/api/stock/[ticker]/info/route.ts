import { NextRequest, NextResponse } from 'next/server';
import { fetchStockInfo } from '../../../../../lib/kis-api';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await fetchStockInfo(ticker);
      return NextResponse.json(data);
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : '알 수 없는 오류';
  console.error(`[INFO] ${ticker} 조회 실패:`, message);
  return NextResponse.json({ error: message }, { status: 500 });
}
