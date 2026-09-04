import { NextRequest, NextResponse } from 'next/server';
import { runSectorFlash, checkDomesticTradingDay } from '@/lib/sector-mail';

// 09:30 속보 메일 (00:31 UTC = 09:31 KST, 월~금) — 본인 전용 1통. 09:00~09:30 섹터 상승률만(수급 없음).
// 10:05 sector-mail 크론과 완전 독립 — 여기가 실패해도 10:05 메일에 영향 없음. 설계는 lib/sector-mail.ts 속보 절.
// ?dry=1 이면 수집·생성만 하고 발송하지 않는다(로컬 검증용).
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/sector-flash] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/sector-flash] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 09:31은 개장 후라 앵커 차트 판정이 안정 구간 — 평일 공휴일까지 걸러진다.
  const { ctx, kisCalls } = await checkDomesticTradingDay();
  if (!ctx.isTradingDay) {
    console.log(`[SECTOR-MAIL][속보] 휴장일(${ctx.reason}) — 발송 생략, 마지막 거래일 ${ctx.lastTradingDate}`);
    return NextResponse.json({ ok: true, skipped: true, reason: ctx.reason });
  }

  const dry = request.nextUrl.searchParams.get('dry') === '1';
  try {
    const { html: _html, ...result } = await runSectorFlash({ send: !dry, extraKisCalls: kisCalls });
    return NextResponse.json({ ok: true, dry, ...result });
  } catch (e) {
    console.error('[SECTOR-MAIL][속보] 실패:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
