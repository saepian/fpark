import { NextRequest, NextResponse } from 'next/server';
import { generateAndSavePick } from '@/lib/daily-pick';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/daily-pick] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/daily-pick] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await generateAndSavePick();
    if (!result) {
      return NextResponse.json({ message: '오늘 종목 이미 선정됨 또는 후보 없음' });
    }
    return NextResponse.json({ success: true, ticker: result.ticker, name: result.name });
  } catch (e) {
    console.error('[DAILY-PICK] cron 오류:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '알 수 없는 오류' },
      { status: 500 }
    );
  }
}
