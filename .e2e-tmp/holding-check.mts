// 내 포지션 수기 검산(2026-09-02 개정) — stock_diagnosis 최신 행의 result.holdingPosition을, 서버와 같은 경로
// (getCachedChartNear 6개월 + fetchDailyChart 1Y 병합, 장중 고가/저가 기준)로 독립 재계산하고, 차트를 직접 훑어
// 고점/저점/변동일/거래일수를 2차 검산한다. 또 기간별 등락률 표(computePriceChangeBadges)의 1개월 최고가와
// 보유 중 고점의 논리 관계(보유기간이 1개월을 포함하면 고점 ≥ 1개월 최고가)도 확인.
// usage: npx tsx --env-file=.env.local .e2e-tmp/holding-check.mts <ticker>
import { createClient } from '@supabase/supabase-js';
import { fetchDailyChart, fetchChartBackTo } from '../lib/kis-api';
import { computeHoldingPosition } from '../lib/holding-position';
import { computePriceChangeBadges } from '../lib/market-utils';
import { kstYearMonthDay, kstMidnight } from '../lib/ai-grounding';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UID = '2ab4c90a-d1af-4585-891a-308b1be7a775';
const ticker = process.argv[2];
const { data: rows } = await sb.from('stock_diagnosis').select('id, ticker, avg_price, quantity, buy_date, result, created_at').eq('user_id', UID).eq('ticker', ticker).order('created_at', { ascending: false }).limit(1);
for (const row of rows ?? []) {
  const r = row.result as any; const hp = r.holdingPosition;
  console.log(`\n== ${row.ticker} avg=${row.avg_price} qty=${row.quantity} buy=${row.buy_date} created=${row.created_at}`);
  if (!hp) { console.log('  holdingPosition 없음'); continue; }
  const { year, month, day } = kstYearMonthDay(new Date());
  const [c6, c1y] = await Promise.all([fetchChartBackTo(ticker, kstMidnight(year, month - 6, day)), fetchDailyChart(ticker, '1Y')]);
  const merged = new Map<string, any>(); for (const d of c6) merged.set(d.date, d); for (const d of c1y) merged.set(d.date, d);
  const chart = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  const recomputed = computeHoldingPosition({ avgPrice: row.avg_price, quantity: row.quantity, currentPrice: r.currentPrice, buyDate: row.buy_date, chart: chart.map((d) => ({ date: d.date, close: d.close, high: d.high, low: d.low })), eps: hp.per?.eps ?? null, benchmark: r.benchmark ?? null })!;
  const start = row.buy_date ? Math.max(0, chart.findIndex((d) => d.date >= row.buy_date)) : 0;
  const win = chart.slice(start);
  const hi = win.reduce((a, b) => (b.high > a.high ? b : a)); const lo = win.reduce((a, b) => (b.low < a.low ? b : a));
  let big = 0; for (let i = Math.max(1, start); i < chart.length; i++) if (Math.abs((chart[i].close - chart[i - 1].close) / chart[i - 1].close) >= 0.15) big++;
  const manual = { high: `${hi.date} ${hi.high}`, low: `${lo.date} ${lo.low}`, bigMoves: big, tradingDays: win.length, from: win[0]?.date, to: win[win.length - 1]?.date, maxPnlRate: +(((hi.high - row.avg_price) / row.avg_price) * 100).toFixed(2), vsHigh: +(((r.currentPrice - hi.high) / hi.high) * 100).toFixed(2) };
  const stored = { high: `${hp.high?.date} ${hp.high?.close}`, low: `${hp.low?.date} ${hp.low?.close}`, bigMoves: hp.bigMoves.count, tradingDays: hp.window.tradingDays, from: hp.window.from, to: hp.window.to, maxPnlRate: hp.maxPnl?.rate, vsHigh: hp.high?.vsCurrent };
  const recomp = { high: `${recomputed.high?.date} ${recomputed.high?.close}`, low: `${recomputed.low?.date} ${recomputed.low?.close}`, bigMoves: recomputed.bigMoves.count, tradingDays: recomputed.window.tradingDays, from: recomputed.window.from, to: recomputed.window.to, maxPnlRate: recomputed.maxPnl?.rate, vsHigh: recomputed.high?.vsCurrent };
  console.log('  basis:', hp.window.basis, '| priceBasis:', hp.priceBasis, '| 6m 차트:', c6[0]?.date, '~', c6[c6.length - 1]?.date, `(${c6.length}행)`, '| 1Y 차트:', c1y[0]?.date, `(${c1y.length}행)`);
  console.log('  저장값 :', JSON.stringify(stored));
  console.log('  수기검산:', JSON.stringify(manual));
  console.log('  재계산 :', JSON.stringify(recomp));
  const mismatch = Object.keys(manual).filter((k) => String((manual as any)[k]) !== String((stored as any)[k]));
  console.log(mismatch.length ? `  ❌ 불일치: ${mismatch.join(', ')} (차트 마지막 행 갱신 등 시점 차이 여부 확인 필요)` : '  ✅ 저장값 = 수기검산');
  // 기간별 등락률 표와의 정합: 1개월 전 기간 중 최고가 vs 보유 중 고점
  const badges = computePriceChangeBadges(chart, r.currentPrice);
  const m1 = badges.find((b) => b.label === '1개월 전');
  if (m1) console.log(`  기간별 등락률 1개월 최고가 ${m1.periodHigh} / 최저가 ${m1.periodLow} ↔ 보유 중 고점 ${hp.high?.close} / 저점 ${hp.low?.close} →`, hp.window.from <= m1.pastDate ? (hp.high.close >= m1.periodHigh && hp.low.close <= m1.periodLow ? '✅ 논리 정합(보유 고점≥1개월 최고가, 저점≤1개월 최저가)' : '❌ 모순') : '(보유기간이 1개월 미만이라 비교 대상 아님)');
}
