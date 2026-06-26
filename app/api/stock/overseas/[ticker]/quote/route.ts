import { NextResponse } from 'next/server';
import { fetchOverseasQuote } from '../../../../../../lib/yahoo-finance';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

  try {
    const data = await fetchOverseasQuote(ticker);
    return NextResponse.json(data);
  } catch (e) {
    console.error('[OVERSEAS QUOTE]', ticker, e);
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 502 });
  }
}
