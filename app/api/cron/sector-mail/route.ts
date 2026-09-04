import { NextRequest, NextResponse } from 'next/server';
import { runSectorMail, checkDomesticTradingDay } from '@/lib/sector-mail';

// 장초반 섹터 리포트 메일 (01:05 UTC = 10:05 KST, 월~금) — 본인 전용 1통.
// 외국인 09:30 / 기관 10:00 가집계 입력분이 모두 채워진 뒤 실행되도록 10:05로 고정(2026-09-04 실측).
// ?dry=1 이면 수집·생성만 하고 발송하지 않는다(로컬 검증용, CRON_SECRET 인증은 동일하게 필요).
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/sector-mail] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/sector-mail] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ctx, kisCalls } = await checkDomesticTradingDay();
  if (!ctx.isTradingDay) {
    console.log(`[SECTOR-MAIL] 휴장일(${ctx.reason}) — 섹터 메일 발송 생략, 마지막 거래일 ${ctx.lastTradingDate}`);
    return NextResponse.json({ ok: true, skipped: true, reason: ctx.reason });
  }

  const dry = request.nextUrl.searchParams.get('dry') === '1';
  try {
    const { html: _html, ...result } = await runSectorMail({ send: !dry, extraKisCalls: kisCalls });
    return NextResponse.json({ ok: true, dry, ...result });
  } catch (e) {
    console.error('[SECTOR-MAIL] 실패:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
