// 시장 데이터 기준일 라벨 판정 (2026-09-04 메인페이지 A) — 순수 함수, 클라이언트 번들 안전.
//
// 배경: TOP MOVERS가 9/4 마감 데이터를 정확히 가져오고도 "전일 기준 · 09/04"로 표기됐다 —
// `isPrevDay = !isKoreanMarketOpen()`이라 마감 후엔 무조건 "전일"이 붙고, 장외 후보 거래일의
// 첫 번째는 당일(15:30 이후)이라 날짜는 오늘이 붙던 구조. 같은 위젯의 "장마감 · 시각 기준" 분기는
// 조건이 `장중 && 캐시`라 장중 캐시히트마다 "장마감"으로 오표기됐고, 히어로 "● 실시간" 배지는
// 조건이 아예 없었다. 요일·시각만 보는 isKoreanMarketOpen은 평일 공휴일을 "장중"으로 봤다.
//
// 규칙: "전일"이라는 상대어를 버리고 항상 데이터 날짜(MM/DD)를 명시한다. 상태는 시각(KST) +
// 앵커 종목 차트의 마지막 행 날짜(lib/market-day-context.ts getDomesticMarketDayContext)로
// 정한다 — 차트에 오늘 행이 없으면 공휴일.

import type { MarketDayContext } from './market-day-context';

export type MarketStatus = 'open' | 'closed' | 'pre_open' | 'holiday' | 'weekend';

export interface MarketDataStatus {
  status: MarketStatus;
  dataDate: string;      // YYYY-MM-DD — 표시 데이터의 기준 거래일
  dataDateLabel: string; // MM/DD
}

const OPEN_MIN = 9 * 60;
const CLOSE_MIN = 15 * 60 + 30;
// 개장 직후엔 KIS 일봉에 당일 행이 몇 분 늦게 생길 수 있어(2026-07-27 실측 09:12에 확인) 그 사이
// "오늘 행 없음"을 공휴일로 단정하지 않는다 — 이 유예 안에서는 거래일로 본다(공휴일이면 최대 30분
// 동안 "실시간"으로 보이는 대신, 매 거래일 개장 직후 "휴장"으로 오표기되는 쪽을 막는다).
export const OPEN_GRACE_MIN = 30;

function kstParts(now: Date): { weekday: number; minutes: number } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { weekday: kst.getUTCDay(), minutes: kst.getUTCHours() * 60 + kst.getUTCMinutes() };
}

export function toMonthDayLabel(yyyymmdd: string): string {
  const [, m, d] = yyyymmdd.split('-');
  return `${m}/${d}`;
}

// ctx: getDomesticMarketDayContext(앵커 차트, now). 09:00 이전은 ctx가 보류(거래일 취급)라 여기서
// 시각으로 pre_open을 갈라낸다.
export function resolveMarketStatus(ctx: MarketDayContext, now: Date = new Date()): MarketDataStatus {
  const { weekday, minutes } = kstParts(now);
  const withDate = (status: MarketStatus, dataDate: string): MarketDataStatus => ({ status, dataDate, dataDateLabel: toMonthDayLabel(dataDate) });

  if (weekday === 0 || weekday === 6) return withDate('weekend', ctx.lastTradingDate);
  if (minutes < OPEN_MIN) return withDate('pre_open', ctx.lastTradingDate);
  if (!ctx.isTradingDay) {
    if (minutes < OPEN_MIN + OPEN_GRACE_MIN) return withDate('open', ctx.lastTradingDate); // 개장 직후 유예
    return withDate('holiday', ctx.lastTradingDate);
  }
  return withDate(minutes < CLOSE_MIN ? 'open' : 'closed', ctx.lastTradingDate);
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
}

// 위젯별 라벨 — 2026-09-04 합의 표.
//  TOP MOVERS: 장중 "실시간(· HH:MM 기준)" / 마감 후 "MM/DD 마감 기준" / 개장 전·휴일 "MM/DD 종가 기준"
//  MARKET SUMMARY: 장중 "실시간" / 그 외 "MM/DD 종가 기준"
//  히어로 배지: 장중 "실시간" / 그 외 "마감 · MM/DD"
export function marketStatusLabel(
  widget: 'movers' | 'summary' | 'hero',
  s: { status: MarketStatus; dataDateLabel: string },
  cachedAt?: string | null,
): string {
  if (s.status === 'open') {
    return widget === 'movers' && cachedAt ? `실시간 · ${hhmm(cachedAt)} 기준` : '실시간';
  }
  if (widget === 'hero') return `마감 · ${s.dataDateLabel}`;
  if (widget === 'movers' && s.status === 'closed') return `${s.dataDateLabel} 마감 기준`;
  return `${s.dataDateLabel} 종가 기준`;
}

// 서버가 상태 필드를 못 준 구 응답(배포 경계 등)용 폴백 — 예전 isPrevDay/prevDateLabel로 근사.
export function statusFromLegacy(isPrevDay: boolean | undefined, prevDateLabel: string | undefined): { status: MarketStatus; dataDateLabel: string } {
  return { status: isPrevDay ? 'closed' : 'open', dataDateLabel: prevDateLabel ?? '' };
}
