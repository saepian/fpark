// 2026-07-27 AI 리포트 4종(국내/해외 종목분석, 기업분석, 포트폴리오분석)이 휴장일(주말·
// 공휴일)에도 마지막 거래일 데이터를 "오늘 마감/오늘 등락"인 것처럼 서술하는 문제의 원인
// 조사 결과 — 4개 라우트 모두 "오늘이 거래일인가"를 확인하는 단계 자체가 없었다(공통
// 유틸의 버그가 아니라 공통 유틸의 부재). 이 파일은 그 판단을 한 곳에서 제공한다.
//
// 국내: isKoreanMarketOpen()(요일+시간, lib/market-utils.ts)만으로는 공휴일을 못 잡는다.
// 별도 KIS 재조회 없이, 각 라우트가 이미 fetchDailyChart로 받아둔 최근 1년 일별 차트의
// 마지막 행 날짜(실제 체결 데이터)를 재사용해서 "오늘 데이터가 있는지"로 공휴일까지
// 정확히 판정한다 — 새 API 호출이 없으므로 지연·비용 증가가 없다.
//
// 2026-07-27 실측 확인(로컬 QA, 실제 KIS 응답): inquire-daily-itemchartprice의 "오늘" 행은
// 애초 가정("완료된 거래일 단위라 마감 전엔 안 채워진다")과 달리, 정규장 개장(09:00)
// 직후부터 당일 진행중 캔들을 실시간에 가깝게 반영한다 — 09:12 KST 실측에서 거래량이
// 그날 최종치(2천만주대) 대비 210만주 수준으로 뚜렷한 "장중 누적치"였다. 즉 09:00 이후엔
// "차트에 오늘 행이 없다"는 사실 자체가 이미 신뢰할 수 있는 휴장 신호다(실제 거래일이면
// 개장 직후 곧바로 행이 생기기 때문). 그래서 판정을 보류하는 구간은 자정~개장(09:00)
// 직전, 즉 아직 어떤 데이터도 나올 수 없는 새벽 시간대 하나뿐이다 — 이 시간대만 실제
// 거래일이든 공휴일이든 데이터가 없는 게 똑같아서 차트만으로 구분이 불가능하다.
//
// 해외: Yahoo가 이미 거래소별 정확한 개장 상태(marketState)를 제공하므로 그대로 재사용
// — 시차·서머타임·현지 공휴일을 국내처럼 별도로 계산할 필요가 없다.

import { kstYearMonthDay, kstDateStr, daysBetween } from './ai-grounding';

export interface MarketDayContext {
  isTradingDay: boolean;
  lastTradingDate: string;          // YYYY-MM-DD — 데이터의 실제 기준일(거래일이면 오늘)
  daysSinceLastTradingDate: number; // 0 = 오늘 자체가 거래일
  reason: 'weekend' | 'holiday' | null;
}

const MARKET_OPEN_MINUTES_KST = 9 * 60; // 09:00 — 이 시각 이전은 판정 보류 대상(위 주석 참고)

function kstMinutesSinceMidnight(d: Date): number {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

// kstYearMonthDay()로 뽑은 KST 캘린더 날짜(y/m/d)의 요일. Date.UTC(y,m,d)로 순수 캘린더
// 날짜만 구성해 getUTCDay()를 쓴다 — 요일은 타임존 오프셋과 무관하게 캘린더 날짜 자체의
// 속성이므로, kstMidnight()(KST 자정에 대응하는 실제 UTC 시각)을 쓰면 -9h 보정 때문에
// 하루 전 요일이 나오는 함정이 있다(이 값은 순수 요일 계산 전용으로만 쓸 것).
function isKstWeekend(now: Date): boolean {
  const { year, month, day } = kstYearMonthDay(now);
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

// 국내 — chart는 호출부가 이미 fetchDailyChart(ticker, '1Y')로 받아둔 결과를 그대로
// 전달한다(추가 API 호출 없음). chart 조회 자체가 실패했으면(빈 배열) 요일만으로 폴백.
export function getDomesticMarketDayContext(
  chart: { date: string }[],
  now: Date = new Date(),
): MarketDayContext {
  const todayStr = kstDateStr(now);
  const lastChartDate = chart.length > 0 ? chart[chart.length - 1].date : null;

  if (lastChartDate === todayStr) {
    return { isTradingDay: true, lastTradingDate: todayStr, daysSinceLastTradingDate: 0, reason: null };
  }

  const weekend = isKstWeekend(now);

  // 평일 개장(09:00) 전 새벽 — 아직 어떤 데이터도 나올 수 없는 시간이라 공휴일과 데이터상
  // 구분 불가(위 파일 상단 주석 참고). 보수적으로 평시(거래일)로 간주.
  if (!weekend && kstMinutesSinceMidnight(now) < MARKET_OPEN_MINUTES_KST) {
    return {
      isTradingDay: true,
      lastTradingDate: lastChartDate ?? todayStr,
      daysSinceLastTradingDate: lastChartDate ? daysBetween(todayStr, lastChartDate) : 0,
      reason: null,
    };
  }

  // 차트 조회 자체가 실패한 경우(lastChartDate 없음) — 공휴일 여부는 확정 못 하므로
  // 요일로 확정 가능한 주말만 휴장으로 판단하고, 평일이면 보수적으로 거래일 간주.
  if (!lastChartDate) {
    if (weekend) return { isTradingDay: false, lastTradingDate: todayStr, daysSinceLastTradingDate: 0, reason: 'weekend' };
    return { isTradingDay: true, lastTradingDate: todayStr, daysSinceLastTradingDate: 0, reason: null };
  }

  // 주말이거나, 평일 개장(09:00) 이후인데도 차트에 오늘 행이 없음 → 휴장(공휴일 포함).
  // 09:00 이후엔 "오늘 행이 없다"는 사실 자체가 신뢰할 수 있는 신호다(위 실측 주석 참고).
  return {
    isTradingDay: false,
    lastTradingDate: lastChartDate,
    daysSinceLastTradingDate: daysBetween(todayStr, lastChartDate),
    reason: weekend ? 'weekend' : 'holiday',
  };
}

// 해외 — Yahoo marketState(PRE/REGULAR/POST/CLOSED 등) 재사용. PRE/REGULAR/POST는 모두
// "오늘 세션이 존재한다"는 뜻이라 거래일로 본다. CLOSED면 마지막 차트 행 날짜로 휴장
// 기간을 계산한다 — 국내와 달리 "개장 전 새벽 보류" 개념이 필요 없다(marketState 자체가
// 이미 그 거래소 로컬 캘린더를 반영한 정확한 상태이기 때문).
export function getOverseasMarketDayContext(
  chart: { date: string }[],
  marketState: string | undefined,
  now: Date = new Date(),
): MarketDayContext {
  const todayStr = kstDateStr(now);
  const lastChartDate = chart.length > 0 ? chart[chart.length - 1].date : null;

  if (marketState === 'REGULAR' || marketState === 'PRE' || marketState === 'POST') {
    return {
      isTradingDay: true,
      lastTradingDate: lastChartDate ?? todayStr,
      daysSinceLastTradingDate: lastChartDate ? daysBetween(todayStr, lastChartDate) : 0,
      reason: null,
    };
  }

  if (!lastChartDate) {
    return { isTradingDay: false, lastTradingDate: todayStr, daysSinceLastTradingDate: 0, reason: null };
  }
  const daysSince = daysBetween(todayStr, lastChartDate);
  return {
    isTradingDay: daysSince === 0,
    lastTradingDate: lastChartDate,
    daysSinceLastTradingDate: daysSince,
    reason: daysSince > 0 ? (isKstWeekend(now) ? 'weekend' : 'holiday') : null,
  };
}

// 4개 AI 리포트 라우트가 공통으로 프롬프트 최상단(## 거래일 상태)에 그대로 삽입할 텍스트.
// 여기서 문구를 통일해야 라우트마다 표현이 갈려 프롬프트 유지보수가 흩어지는 걸 막는다
// (TEMPORAL_GROUNDING_INSTRUCTION과 같은 이유 — lib/ai-grounding.ts 8행 주석 참고).
export function buildMarketDayBlock(ctx: MarketDayContext): string {
  if (ctx.isTradingDay) return '오늘은 정규장이 열리는 거래일입니다.';

  const label = ctx.reason === 'weekend' ? '주말 휴장일' : ctx.reason === 'holiday' ? '공휴일 휴장일' : '휴장일';
  const gapLine = ctx.daysSinceLastTradingDate === 1
    ? `마지막 거래일은 어제(${ctx.lastTradingDate})입니다.`
    : `마지막 거래일은 ${ctx.daysSinceLastTradingDate}일 전인 ${ctx.lastTradingDate}입니다.`;

  return `오늘은 정규장이 열리지 않는 ${label}입니다. ${gapLine} 아래 시세·수급 데이터는 전부 그 날짜의 마감 확정치이며, "오늘 마감/오늘 등락"이 아니라 반드시 "${ctx.lastTradingDate} 마감 기준"으로 서술하세요.`;
}
