import type { MarketIndexData, ChartDataPoint, PriceChangeBadge, PortfolioPeriodChange } from './types';
import { kstYearMonthDay, kstMidnight, kstDateStr } from './ai-grounding';

// Yahoo Finance Chart API로 해외 지수/환율 조회 — KIS 인증 불필요, 무료.
// app/api/market/route.ts(국내증시 카드)와 cron/morning-briefing(미국증시 개장 전 요약)이 공유한다.
export async function fetchYahooIndex(symbol: string): Promise<MarketIndexData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const result = data.chart?.result?.[0];
    const meta   = result?.meta;
    if (!meta?.regularMarketPrice) return null;

    const rawCloses: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const closes = rawCloses.filter((v): v is number => v != null && isFinite(v));

    const price      = meta.regularMarketPrice as number;
    const prev       = closes[closes.length - 2] ?? (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
    const change     = price - prev;
    const changeRate = prev > 0 ? ((price - prev) / prev) * 100 : 0;

    return { value: price, change, changeRate, sparkline: closes };
  } catch (e) {
    console.warn(`[market-utils] ${symbol} 조회 실패:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export function isKoreanMarketOpen(): boolean {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}

// 오늘(KST) 기준 거꾸로 최대 maxCandidates개의 "평일" 후보 날짜를 생성한다.
// 공휴일 캘린더가 없으므로 요일만으로 후보를 만들고, 실제 거래일 여부(공휴일 스킵)는
// 호출 측이 KIS 응답이 비어있지 않은지로 판별한다 (findFirstNonEmptyByDate 참고).
export function getTradingDateCandidates(maxCandidates = 7): { yyyymmdd: string; label: string }[] {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const fmtLabel = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  const day     = kst.getDay();
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  const includeToday = day >= 1 && day <= 5 && minutes >= 15 * 60 + 30;

  const candidates: { yyyymmdd: string; label: string }[] = [];
  const cursor = new Date(kst);
  if (!includeToday) cursor.setDate(cursor.getDate() - 1);

  while (candidates.length < maxCandidates) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
      candidates.push({ yyyymmdd: fmt(cursor), label: fmtLabel(cursor) });
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return candidates;
}

// 가장 최근 완료된 거래일 반환 (주말 건너뜀, 공휴일은 미지원) — 표시용 라벨
// (prevDateLabel 등)에만 사용. 날짜 파라미터 결정에는 getTradingDateCandidates()와
// findFirstNonEmptyByDate()를 사용할 것.
export function getLastTradingDate(): { yyyymmdd: string; label: string } {
  return getTradingDateCandidates(1)[0];
}

// 후보 날짜를 순서대로 시도해, 응답이 비어있지 않은 첫 날짜를 채택한다.
// fetcher가 던지는 예외는 "그 날짜는 데이터 없음"으로 간주하고 다음 후보로 넘어간다.
export async function findFirstNonEmptyByDate<T>(
  candidates: { yyyymmdd: string; label: string }[],
  fetcher: (yyyymmdd: string) => Promise<T[]>,
): Promise<{ date: string; label: string; rows: T[] } | null> {
  for (const { yyyymmdd, label } of candidates) {
    try {
      const rows = await fetcher(yyyymmdd);
      if (rows.length > 0) return { date: yyyymmdd, label, rows };
    } catch {
      // 다음 후보로 재시도
    }
  }
  return null;
}

// 오름차순(과거→최신) 차트에서 targetDateStr 이하인 가장 최근 거래일 봉을 찾는다.
// KIS 일별시세는 휴장일 row 자체가 없으므로 "이전 마지막 거래일 찾기"로 공휴일이
// 자동 처리된다 — 별도 공휴일 캘린더 불필요.
export function findClosestPastClose(
  points: ChartDataPoint[],
  targetDateStr: string,
): ChartDataPoint | null {
  let result: ChartDataPoint | null = null;
  for (const p of points) {
    if (p.date <= targetDateStr) result = p;
    else break;
  }
  return result;
}

// 1년/6개월/1개월/1주일 전 타겟 날짜. computePriceChangeBadges와 computePortfolioPeriodChange가
// 공유한다(포트폴리오 집계도 "같은 4개 시점"을 종목별로 반복 적용하는 것뿐이라 별도
// 타겟 정의가 필요 없음). Date.setFullYear/setMonth/setDate 같은 서버 런타임 로컬
// 타임존 연산 대신 kstYearMonthDay/kstMidnight을 쓰는 이유는 Vercel 기본 UTC 런타임에서
// KST 00:00~08:59 호출 시 날짜가 하루 밀리는 문제를 피하기 위함(ai-grounding.ts의
// kstYearMonthDay 주석에 있는 동일 클래스 회귀 사례 참고).
export function getPriceChangeTargets(now: Date = new Date()): { label: PriceChangeBadge['label']; date: Date }[] {
  const { year, month, day } = kstYearMonthDay(now);
  return [
    { label: '1년 전',   date: kstMidnight(year - 1, month, day) },
    { label: '6개월 전', date: kstMidnight(year, month - 6, day) },
    { label: '1개월 전', date: kstMidnight(year, month - 1, day) },
    { label: '1주일 전', date: kstMidnight(year, month, day - 7) },
  ];
}

// 현재가 대비 1년/6개월/1개월/1주일 전 종가 등락률. points는 fetchDailyChart(ticker, '1Y')
// 결과(오름차순)를 그대로 전달. 상장 1년 미만 등으로 기준일 이전 데이터가 없으면 해당
// 항목은 생략(호출부가 있는 것만 렌더링).
export function computePriceChangeBadges(
  points: ChartDataPoint[],
  currentPrice: number,
  now: Date = new Date(),
): PriceChangeBadge[] {
  const targets = getPriceChangeTargets(now);
  const out: PriceChangeBadge[] = [];
  for (const { label, date } of targets) {
    const past = findClosestPastClose(points, kstDateStr(date));
    if (!past || past.close <= 0) continue;

    // pastDate(포함)~오늘 구간의 최고가/최저가 — 같은 points 배열에서 뽑으므로 추가
    // 조회 없음. periodPoints는 past 본인도 포함하므로 seed 없이 reduce해도 항상
    // 최소 1개 원소가 있어 안전하다.
    const periodPoints = points.filter((p) => p.date >= past.date);
    const periodHigh = periodPoints.reduce((max, p) => Math.max(max, p.high), -Infinity);
    const periodLow = periodPoints.reduce((min, p) => Math.min(min, p.low), Infinity);

    out.push({
      label,
      pastDate: past.date,
      pastClose: past.close,
      changeRate: ((currentPrice - past.close) / past.close) * 100,
      periodHigh,
      periodLow,
    });
  }
  return out;
}

// 포트폴리오진단 "기간별 포트폴리오 전체 평가금액 변동" 집계. holdings의 points는
// 종목별로 이미 조회해온 병합 차트(near12+near6+main1Y, computePriceChangeBadges와
// 동일 소스)를 그대로 받는다 — 이 함수 자체는 신규 조회를 하지 않는다.
// currentTotalValue는 항상 호출부가 전달한 값(포트폴리오 전체 현재 평가금액)을 그대로
// 쓴다 — 일부 종목의 과거 종가를 못 찾아도 "현재" 쪽은 깎지 않으므로, missingTickers가
// 있는 기간의 changeRate는 "조회된 종목의 과거가치 대비 전체 종목의 현재가치"라는
// 비대칭 비교가 된다(호출부가 UI에 이 사실을 명시해야 함).
export function computePortfolioPeriodChange(
  holdings: { ticker: string; quantity: number; points: ChartDataPoint[] | null }[],
  currentTotalValue: number,
  now: Date = new Date(),
): PortfolioPeriodChange[] {
  const targets = getPriceChangeTargets(now);
  return targets
    .map(({ label, date }) => {
      const targetStr = kstDateStr(date);
      let pastValue = 0;
      const missingTickers: string[] = [];
      for (const h of holdings) {
        const past = h.points ? findClosestPastClose(h.points, targetStr) : null;
        if (past && past.close > 0) {
          pastValue += past.close * h.quantity;
        } else {
          missingTickers.push(h.ticker);
        }
      }
      return {
        label,
        pastValue,
        changeRate: pastValue > 0 ? ((currentTotalValue - pastValue) / pastValue) * 100 : 0,
        missingTickers,
      };
    })
    .filter((r) => r.missingTickers.length < holdings.length); // 전 종목 실패한 기간은 행 자체를 생략
}
