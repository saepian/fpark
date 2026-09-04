import { NextRequest, NextResponse } from 'next/server';
import { runMorningAnalysis, checkDomesticTradingDay, MORNING_CACHE_KEY } from '@/lib/sector-mail';

// 아침 섹터 예상 분석 (23:30 UTC = 08:30 KST, 월~금). 메일은 보내지 않고 market_cache에만 저장 —
// 10:05 sector-mail 크론이 읽는다. 여기가 실패해도 10:05 크론은 "아침 분석 생략"으로 발송한다.
// 자세한 설계는 lib/sector-mail.ts 상단 주석.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/morning-sector-analysis] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/morning-sector-analysis] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 08:30은 개장 전이라 앵커 차트로는 평일 공휴일을 못 잡는다(주말만 걸러짐) — lib/sector-mail.ts checkDomesticTradingDay 주석.
  const { ctx } = await checkDomesticTradingDay();
  if (!ctx.isTradingDay) {
    console.log(`[SECTOR-MAIL] 휴장일(${ctx.reason}) — 아침 분석 생략`);
    return NextResponse.json({ ok: true, skipped: true, reason: ctx.reason });
  }

  const t0 = Date.now();
  try {
    const analysis = await runMorningAnalysis();
    console.log(`[SECTOR-MAIL] 아침 분석 저장(${MORNING_CACHE_KEY}) — 예상 섹터:`, analysis.expectedSectors.map((s) => s.name), `${Date.now() - t0}ms`);
    return NextResponse.json({ ok: true, cacheKey: MORNING_CACHE_KEY, expectedSectors: analysis.expectedSectors, durationMs: Date.now() - t0 });
  } catch (e) {
    console.error('[SECTOR-MAIL] 아침 분석 실패(10:05 크론이 폴백 처리):', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - t0 });
  }
}
