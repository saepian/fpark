import { NextRequest, NextResponse } from 'next/server';
import { fetchStockPrice } from '../../../../../lib/kis-api';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  try {
    const data = await fetchStockPrice(ticker);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
