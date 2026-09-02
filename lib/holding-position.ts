// "내 포지션" 순수 계산 모듈 (2026-09-01 기업분석 리포트 재편) — lib/portfolio-position.ts와
// 같은 원칙: 입력(매입 정보 + 일별 종가 + EPS + 벤치마크)만 받아 관찰 수치를 돌려주는 순수
// 함수. 매수/매도/목표가/손절가 판단은 어디에도 없다 — "매입가까지 +X% 필요"는 산술
// (매입가÷현재가−1)이지 회복 가능성에 대한 의견이 아니며, 카드 캡션도 그렇게만 적는다.
//
// 서버(app/api/diagnosis/route.ts)가 결과를 계산해 stock_diagnosis.result.holdingPosition에
// 저장하고, 같은 값을 [내 포지션 데이터] 블록으로 프롬프트에 주입한다(AI가 임의 수치를
// 만들지 않게). 프론트(components/diagnosis/HoldingPositionCard.tsx)는 저장된 값을 그대로 그린다.

// high/low(장중 고가·저가)는 2026-09-02부터 넘긴다 — 없으면(옛 호출부·테스트) 종가로 폴백.
export interface HoldingChartPoint { date: string; close: number; high?: number; low?: number }

export interface HoldingBenchmark {
  indexName: 'KOSPI' | 'KOSDAQ';
  indexChangeRate: number;   // 보유기간 지수 등락률(%)
  stockProfitRate: number;   // 같은 기간 종목 수익률(%) — 기존 벤치마크 계산값 그대로
  fromDate: string;
  toDate: string;
}

export interface HoldingPositionInput {
  avgPrice: number;
  quantity: number;
  currentPrice: number;
  buyDate: string | null;          // 'YYYY-MM-DD' (없으면 최근 1년 폴백)
  chart: HoldingChartPoint[];      // 일별 시세(종가 + 장중 고가/저가), 날짜 오름차순, 마지막 행이 오늘(또는 마지막 거래일). 최근 6개월(getCachedChartNear(ticker, 6))
  eps: number | null;              // 현재 EPS(원). 0 이하·null이면 PER 계산 생략
  benchmark: HoldingBenchmark | null;
  bigMoveThreshold?: number;       // 기본 15(%)
}

// 2026-09-02: 관찰 구간을 "최근 6개월"로 확장(예전엔 fetchDailyChart 1Y가 KIS 100거래일 캡에 걸려 실제로는
// 약 5개월이었다). 옛 저장 레코드는 *1Y basis 문자열을 그대로 갖고 있으므로 타입에 남겨 캡션이 계속 읽히게 한다.
export type HoldingWindowBasis = 'buyDate' | 'buyDateCapped6M' | 'fallback6M' | 'buyDateCapped1Y' | 'fallback1Y';

export interface HoldingPosition {
  buyDate: string | null;
  window: { from: string; to: string; tradingDays: number; basis: HoldingWindowBasis };
  profitRate: number;              // 현재 평가손익률(%)
  // 매입가까지 필요한 등락률(%) = (매입가/현재가 − 1)×100. 손실이면 양수("+X% 필요"),
  // 수익이면 음수("−X%까지 여유"). 현재가 0 이하면 null.
  recoveryRate: number | null;
  // 2026-09-02: 고점/저점 기준을 "기간별 등락률" 표(lib/market-utils.ts computePriceChangeBadges — 장중
  // 고가/저가)와 통일했다. 예전엔 여기만 종가 기준이라 S-Oil 실화면에서 표의 "1개월 전 기간 중 최고가
  // 160,000원"보다 낮은 "보유 중 고점 153,600원(종가)"이 나와 서로 모순돼 보였다. priceBasis가
  // 'intraday'면 장중 고가/저가, 옛 레코드(undefined)는 종가 기준. maxPnl/minPnl도 같은 가격으로 계산.
  priceBasis?: 'intraday' | 'close';
  high: { date: string; close: number; vsCurrent: number } | null; // close = 기준 가격(priceBasis에 따라 장중 고가 또는 종가). vsCurrent = 현재가가 고점 대비 몇 %(≤0)
  low:  { date: string; close: number; vsCurrent: number } | null; // close = 기준 가격(장중 저가 또는 종가). 현재가가 저점 대비 몇 %(≥0)
  maxPnl: { date: string; rate: number; amount: number } | null;   // 보유기간 최대 평가손익(고점 가격 기준)
  minPnl: { date: string; rate: number; amount: number } | null;   // 보유기간 최저 평가손익(저점 가격 기준)
  bigMoves: { threshold: number; count: number; days: { date: string; changeRate: number }[] }; // days는 최근 5건
  per: { atBuy: number; now: number; eps: number } | null;        // 매입가÷EPS → 현재가÷EPS (EPS 동일 가정)
  benchmark: (HoldingBenchmark & { excess: number }) | null;      // excess = 종목 − 지수 (%p)
}

const r2 = (n: number) => parseFloat(n.toFixed(2));
const r1 = (n: number) => parseFloat(n.toFixed(1));

export function computeHoldingPosition(input: HoldingPositionInput): HoldingPosition | null {
  const { avgPrice, quantity, currentPrice, buyDate, eps, benchmark } = input;
  const threshold = input.bigMoveThreshold ?? 15;
  if (!(avgPrice > 0)) return null;

  const chart = input.chart.filter((p) => p.close > 0 && !!p.date);
  const profitRate = currentPrice > 0 ? r2(((currentPrice - avgPrice) / avgPrice) * 100) : 0;
  const recoveryRate = currentPrice > 0 ? r2(((avgPrice / currentPrice) - 1) * 100) : null;

  // 관찰 구간 — buyDate 이후 행(매수일 당일 포함). 차트(최근 6개월)보다 오래 보유했으면
  // 6개월로 잘렸음을 basis로 표시하고, buyDate가 없으면 최근 6개월 전체를 폴백으로 쓴다.
  let startIdx = 0;
  let basis: HoldingWindowBasis = 'fallback6M';
  if (buyDate) {
    const idx = chart.findIndex((p) => p.date >= buyDate);
    if (idx === -1) {
      // 매수일이 차트 마지막 행보다 뒤(예: 오늘 장중 매수인데 차트가 어제까지) → 마지막 행만
      startIdx = Math.max(0, chart.length - 1);
      basis = 'buyDate';
    } else {
      startIdx = idx;
      basis = chart.length > 0 && buyDate < chart[0].date ? 'buyDateCapped6M' : 'buyDate';
    }
  }
  const window = chart.slice(startIdx);

  let high: HoldingPosition['high'] = null;
  let low: HoldingPosition['low'] = null;
  let maxPnl: HoldingPosition['maxPnl'] = null;
  let minPnl: HoldingPosition['minPnl'] = null;
  // 장중 고가/저가가 구간 전체에 있으면 그 기준(기간별 등락률 표와 동일), 하나라도 없으면 종가로 통일 폴백.
  const intraday = window.length > 0 && window.every((p) => typeof p.high === 'number' && p.high > 0 && typeof p.low === 'number' && p.low > 0);
  const hiOf = (p: HoldingChartPoint) => (intraday ? p.high! : p.close);
  const loOf = (p: HoldingChartPoint) => (intraday ? p.low! : p.close);
  if (window.length > 0) {
    let hi = window[0], lo = window[0];
    for (const p of window) {
      if (hiOf(p) > hiOf(hi)) hi = p;
      if (loOf(p) < loOf(lo)) lo = p;
    }
    const hiPrice = hiOf(hi), loPrice = loOf(lo);
    high = { date: hi.date, close: hiPrice, vsCurrent: currentPrice > 0 ? r2(((currentPrice - hiPrice) / hiPrice) * 100) : 0 };
    low  = { date: lo.date, close: loPrice, vsCurrent: currentPrice > 0 ? r2(((currentPrice - loPrice) / loPrice) * 100) : 0 };
    maxPnl = { date: hi.date, rate: r2(((hiPrice - avgPrice) / avgPrice) * 100), amount: Math.round((hiPrice - avgPrice) * quantity) };
    minPnl = { date: lo.date, rate: r2(((loPrice - avgPrice) / avgPrice) * 100), amount: Math.round((loPrice - avgPrice) * quantity) };
  }

  // 보유기간 중 |일간 등락률| ≥ threshold 인 날 — 직전 종가가 필요하므로 차트 첫 행은 제외.
  const bigDays: { date: string; changeRate: number }[] = [];
  for (let i = Math.max(1, startIdx); i < chart.length; i++) {
    const prev = chart[i - 1].close;
    const rate = ((chart[i].close - prev) / prev) * 100;
    if (Math.abs(rate) >= threshold) bigDays.push({ date: chart[i].date, changeRate: r2(rate) });
  }

  const per = eps !== null && eps > 0 && currentPrice > 0
    ? { atBuy: r1(avgPrice / eps), now: r1(currentPrice / eps), eps }
    : null;

  return {
    buyDate: buyDate || null,
    window: {
      from: window[0]?.date ?? (buyDate || ''),
      to: window[window.length - 1]?.date ?? '',
      tradingDays: window.length,
      basis,
    },
    profitRate,
    recoveryRate,
    priceBasis: intraday ? 'intraday' : 'close',
    high, low, maxPnl, minPnl,
    bigMoves: { threshold, count: bigDays.length, days: bigDays.slice(-5) },
    per,
    benchmark: benchmark ? { ...benchmark, excess: r2(benchmark.stockProfitRate - benchmark.indexChangeRate) } : null,
  };
}

const sgn = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const md = (d: string) => { const p = d.split('-'); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : d; };

// 관찰 구간 설명(카드 캡션·프롬프트 공용) — 폴백/절삭을 반드시 명시한다.
export function describeHoldingWindow(hp: HoldingPosition): string {
  const span = `${hp.window.from}~${hp.window.to}, ${hp.window.tradingDays}거래일`;
  if (hp.window.basis === 'fallback6M') return `매수일 미입력 → 최근 6개월 기준(${span})`;
  if (hp.window.basis === 'buyDateCapped6M') return `매수일 ${hp.buyDate} 이후 중 최근 6개월만 반영(${span})`;
  if (hp.window.basis === 'fallback1Y') return `매수일 미입력 → 최근 1년 기준(${span})`;
  if (hp.window.basis === 'buyDateCapped1Y') return `매수일 ${hp.buyDate} 이후 중 최근 1년만 반영(${span})`;
  return `매수일 ${hp.buyDate} 이후(${span})`;
}

// 고점/저점 가격 기준 라벨(카드·프롬프트 공용)
export function holdingPriceBasisLabel(hp: HoldingPosition): string {
  return hp.priceBasis === 'intraday' ? '장중 고가/저가 기준' : '종가 기준';
}

// 프롬프트 [내 포지션 데이터] 블록 — 서버 계산값을 그대로 나열. AI는 이 수치를 새로 만들지 않고
// 여기 있는 것만 인용한다.
export function buildHoldingPositionBlock(hp: HoldingPosition | null): string {
  if (!hp) return '보유 정보 부족으로 계산 없음';
  const lines: string[] = [];
  lines.push(`- 관찰 구간: ${describeHoldingWindow(hp)}`);
  if (hp.recoveryRate !== null) {
    lines.push(hp.recoveryRate > 0
      ? `- 평가손익 ${sgn(hp.profitRate)}% → 매입가까지 ${sgn(hp.recoveryRate)}% 필요 (산술값)`
      : `- 평가손익 ${sgn(hp.profitRate)}% → 매입가까지 ${hp.recoveryRate}% 여유 (산술값)`);
  }
  if (hp.high && hp.low) {
    const basisWord = hp.priceBasis === 'intraday' ? '장중' : '종가';
    lines.push(`- 구간 최고 ${basisWord === '장중' ? '장중 고가' : '종가'} ${won(hp.high.close)}(${md(hp.high.date)}) 대비 현재가 ${sgn(hp.high.vsCurrent)}% · 최저 ${basisWord === '장중' ? '장중 저가' : '종가'} ${won(hp.low.close)}(${md(hp.low.date)}) 대비 ${sgn(hp.low.vsCurrent)}%`);
  }
  if (hp.maxPnl && hp.minPnl) {
    lines.push(`- 구간 최대 평가손익 ${sgn(hp.maxPnl.rate)}%(${md(hp.maxPnl.date)}) · 최저 평가손익 ${sgn(hp.minPnl.rate)}%(${md(hp.minPnl.date)}) → 현재는 고점 대비 ${sgn(hp.high?.vsCurrent ?? 0)}% 되돌린 위치`);
  }
  lines.push(hp.bigMoves.count > 0
    ? `- 구간 내 ±${hp.bigMoves.threshold}% 이상 변동일 ${hp.bigMoves.count}일 (${hp.bigMoves.days.map((d) => `${md(d.date)} ${sgn(d.changeRate)}%`).join(', ')})`
    : `- 구간 내 ±${hp.bigMoves.threshold}% 이상 변동일 없음`);
  if (hp.per) {
    lines.push(`- 매입 시점 PER ${hp.per.atBuy}배 → 현재 PER ${hp.per.now}배 (현재 EPS ${hp.per.eps.toLocaleString()}원 동일 가정 — 매입 시점 실제 EPS가 아님)`);
  } else {
    lines.push('- PER 변화: EPS 없음(적자 등)으로 계산 불가');
  }
  if (hp.benchmark) {
    lines.push(`- 보유기간 ${hp.benchmark.indexName} ${sgn(hp.benchmark.indexChangeRate)}% vs 이 종목 ${sgn(hp.benchmark.stockProfitRate)}% (${sgn(hp.benchmark.excess)}%p, ${hp.benchmark.fromDate}~${hp.benchmark.toDate})`);
  }
  return lines.join('\n');
}
