import { NextRequest, NextResponse } from 'next/server';
import { fetchDailyChart } from '../../../../../lib/kis-api';

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

  try {
    const data = await fetchDailyChart(ticker, period);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
