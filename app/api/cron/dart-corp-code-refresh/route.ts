import { NextRequest, NextResponse } from 'next/server';
import { refreshCorpCodeMap } from '@/lib/dart-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 2026-07-23: DART corp_code 맵(Supabase 영속 캐시, TTL 7일)이 만료된 순간의 사용자 요청이
// 다운로드+파싱 비용(실측 4.3초)을 그대로 떠안는 문제 — TTL보다 훨씬 짧은 주기(3일)로
// 선제 갱신해서 실제 사용자 요청은 항상 캐시 히트만 타게 한다.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/dart-corp-code-refresh] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/dart-corp-code-refresh] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { count } = await refreshCorpCodeMap();
    console.log(`[cron/dart-corp-code-refresh] 갱신 완료 — 상장사 ${count}개`);
    return NextResponse.json({ done: true, count });
  } catch (e) {
    console.error('[cron/dart-corp-code-refresh] 갱신 실패:', e);
    return NextResponse.json({ error: 'refresh failed' }, { status: 500 });
  }
}
