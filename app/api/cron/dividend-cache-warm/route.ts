import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { warmDividendCache } from '@/lib/kis-api';
import { fetchDividendSummary } from '@/lib/dart-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// 2026-09-03 로딩속도 후속개선 1번 — 배당 종가 캐시 선채움 크론(장 마감 후 15:50 KST, 평일).
// 배경: fetchDividendHistory가 배당기준일 종가를 종목당 "평생 1회" 5년치(최대 20건) KIS로 채우는데,
// 그 최초 1회가 실제 유저의 첫 조회(대시보드 배당·기업분석·포트폴리오분석)에서 터지면 최대 17초가
// 걸렸다(실측). 실제 유저가 보유 중(dashboard_holdings, hidden 제외)이거나 관심종목(watchlist, 국내)으로
// 등록한 종목의 배당 이력 24시간 캐시 + 기준일 종가 영구 캐시 + DART 배당 요약(7일 캐시)을 미리 채운다.
// 이후 유저의 첫 조회는 캐시 히트(종목당 KIS 0~1건)로 끝난다.
//
// 처리량: 종목당 최악 21건(ksdinfo 1 + 기준일 종가 20)이지만 영구 캐시가 채워진 뒤로는 하루 1건 —
// priority 'cron'(소프트캡 미적용, 하드캡 15/s)으로 순차 처리. 한 번에 최대 MAX_TICKERS_PER_RUN까지만
// 처리하고 나머지는 다음 날로 넘긴다(maxDuration 300초 안에 안전하게).
const MAX_TICKERS_PER_RUN = 120;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/dividend-cache-warm] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/dividend-cache-warm] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const [{ data: holdings, error: e1 }, { data: watchlist, error: e2 }] = await Promise.all([
    adminClient.from('dashboard_holdings').select('ticker').eq('hidden', false),
    adminClient.from('watchlist').select('ticker, market'),
  ]);
  if (e1 || e2) {
    console.error('[cron/dividend-cache-warm] 종목 목록 조회 실패:', e1?.message ?? e2?.message);
    return NextResponse.json({ error: e1?.message ?? e2?.message }, { status: 500 });
  }
  const tickers = [...new Set([
    ...(holdings ?? []).map((r) => r.ticker),
    ...(watchlist ?? []).filter((r) => !r.market || r.market === 'kr').map((r) => r.ticker),
  ])].filter((t) => /^\d{6}$/.test(t));

  // 영구 종가가 아직 없는 종목을 앞에 두어, 한도에 걸려도 "처음 조회가 비싼" 종목부터 채운다.
  const { data: closeRows } = await adminClient.from('market_cache').select('key').like('key', 'div_close_%');
  const warmed = new Set((closeRows ?? []).map((r) => r.key.split('_')[2]));
  const ordered = [...tickers.filter((t) => !warmed.has(t)), ...tickers.filter((t) => warmed.has(t))].slice(0, MAX_TICKERS_PER_RUN);

  const results: { ticker: string; records: number; closes: number; ms: number; error?: string }[] = [];
  for (const ticker of ordered) {
    const t0 = Date.now();
    try {
      const [r] = await Promise.all([warmDividendCache(ticker), fetchDividendSummary(ticker).catch(() => null)]);
      results.push({ ticker, ...r, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ ticker, records: 0, closes: 0, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
    }
    if (Date.now() - startedAt > 270_000) { console.warn('[cron/dividend-cache-warm] 시간 예산 초과로 중단'); break; }
  }

  const summary = {
    candidates: tickers.length, processed: results.length, skipped: tickers.length - results.length,
    newlyWarmed: results.filter((r) => !warmed.has(r.ticker) && r.closes > 0).length,
    errors: results.filter((r) => r.error).length,
    totalMs: Date.now() - startedAt,
  };
  console.log('[cron/dividend-cache-warm] 완료', summary, results.map((r) => `${r.ticker}:${r.records}/${r.closes}(${r.ms}ms${r.error ? ',ERR' : ''})`).join(' '));
  return NextResponse.json({ done: true, ...summary, results });
}
