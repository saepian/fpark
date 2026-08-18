import { NextRequest, NextResponse } from 'next/server';
import { refreshStockMaster } from '@/lib/krx-stock-master';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// KRX 상장법인목록을 하루 1회 stock_master 테이블에 upsert — app/api/search가 매 검색
// 요청마다 KRX를 실시간 스크래핑하다 Vercel 서버리스 IP가 403 차단당한 문제(2026-08-18)로
// 신설. KRX 실패는 refreshStockMaster() 내부에서 시장별로 건너뛰고 기존 데이터를 유지한다.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/stock-master-refresh] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/stock-master-refresh] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await refreshStockMaster();
  console.log('[cron/stock-master-refresh] 완료:', JSON.stringify(result));
  return NextResponse.json({ done: true, ...result });
}
