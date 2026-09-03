import { fetchStockPrice } from '@/lib/kis-api';

// 2026-07-10 발견: fetchStockPrice/fetchStockInfo(KIS inquire-price)와
// fetchDailyChart(KIS inquire-daily-itemchartprice)의 "오늘" 행은 정규장 마감(15:30 KST)
// 전까지는 장중 누적/실시간 값이고, 마감 후에야 그날의 최종 확정치가 된다. 그런데 당일
// 캐시는 report_date만 보고 무조건 재사용해서, 장중에 생성된 리포트가 마감 후 재방문에도
// 그대로 남아 "장중 스냅샷을 오늘자 최종 리포트인 것처럼" 계속 보여주는 문제가 있었다.
// 장 마감 후 첫 방문 때만, 캐시가 장중에 생성된 것이면 무시하고 재생성한다(일일 재생성
// 상한 MAX_DAILY_REGENS 적용 — 아래 장중 신선도 로직과 공유).
//
// 2026-09-03: app/api/stock/[ticker]/analysis/route.ts에서 이 파일로 옮김 — Next.js
// App Router는 route.ts가 GET/POST 등 인식된 이름 외의 임의 함수를 export하는 걸
// 허용하지 않아(빌드 타입체크 실패), 재생성 트리거 로직을 단위 테스트하려면 애초에
// route.ts 밖(lib)에 있어야 했다. 로직 자체는 그대로다.
const MARKET_OPEN_MINUTES_KST = 9 * 60; // 09:00
const MARKET_CLOSE_MINUTES_KST = 15 * 60 + 30; // 15:30

function kstMinutesSinceMidnight(d: Date): number {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

export function isIntradayCacheStale(cachedCreatedAt: string): boolean {
  const generatedBeforeClose = kstMinutesSinceMidnight(new Date(cachedCreatedAt)) < MARKET_CLOSE_MINUTES_KST;
  const nowIsAfterClose = kstMinutesSinceMidnight(new Date()) >= MARKET_CLOSE_MINUTES_KST;
  return generatedBeforeClose && nowIsAfterClose;
}

// 2026-07-15 "장중 캐시 신선도" 개선: 위 장마감 무효화만으로는 아침에 생성된
// 리포트가 장마감 전까지 하루 종일 그대로 유지되는 문제가 있었다(가격이 크게
// 움직이거나 새 뉴스가 나와도 아침 리포트가 그대로 노출됨). 장중에도 "일정 시간
// 경과 AND 가격이 유의미하게 변동"했을 때만 재생성한다 — 시간만 보면(고정 주기)
// 안 움직인 날도 기계적으로 비용이 발생하고, 가격만 보면 생성 직후 정상 변동폭
// 에도 바로 재트리거(thrashing)되므로 AND로 묶어 둘 다 회피한다. 가격 조회 자체가
// KIS 호출 1회를 유발하므로 시간 조건을 먼저 걸러, 최소 시간 미경과 시엔 가격
// 조회조차 하지 않는다(캐시 히트 시 대부분 KIS 호출 0회를 유지).
//
// 2026-07-30 발견: 위 단일 조건(2시간+2.5%)은 개장 직후처럼 리포트 생성 직후 큰
// 갭이 열리는 경우를 놓쳤다 — SK하이닉스가 09:16 생성 후 1.5시간 만에 -5.28%→
// +2.93%(8%p+)로 움직였는데도 2시간 미만이라 가격 확인 자체를 안 해서 재생성이
// 전혀 트리거되지 않았다. 급격한 변동은 더 짧은 경과 시간에도 빠르게 잡도록
// 2단 임계값으로 분리한다 — "느슨한 변동 + 긴 대기" 조합(기존 취지)은 그대로 두고,
// "급격한 변동 + 짧은 대기" 조합을 추가해 개장 직후 큰 갭만 예외적으로 빠르게 잡는다.
//
// 2026-09-03 재조사(7/29 제보 후속): 위 2단 임계값이 실제로 이 정확한 시나리오를
// 잡아내는지 실측(단위테스트, lib/stock-analysis-refresh.test.ts)으로 재검증 완료 —
// 정상 작동함. DB 실측(stock_analysis_history 188건 전수)에서 발견된 "재생성 안 된
// 큰 변동 리포트" 사례는 전부 그날 재방문 자체가 없었던 경우였다(이 로직은 방문
// 시점에만 평가되는 온디맨드 방식이라, 재방문이 없으면 트리거 자체가 호출되지 않음
// — 로직 결함이 아니라 무방문 관찰 부재). 상세는 보고서 참고.
const INTRADAY_FAST_MIN_HOURS_ELAPSED = 0.5; // 30분
const INTRADAY_FAST_PRICE_MOVE_THRESHOLD = 0.05; // ±5%
const INTRADAY_MIN_HOURS_ELAPSED = 2;
const INTRADAY_PRICE_MOVE_THRESHOLD = 0.025; // ±2.5%

// 하루 재생성 총 상한(초기 생성 포함) — 변동이 잦은 종목이 무한정 비용을 늘리지
// 않도록 하는 안전장치. 단, 장마감 강제 재생성(isIntradayCacheStale)은 이 상한과
// 무관하게 항상 보장한다 — "그날의 최종 확정 데이터"라는 점에서 인트라데이 노이즈성
// 재생성과 성격이 다르고, 장중에 변동성이 커서 이미 상한을 다 쓴 종목일수록 오히려
// 장마감 후 정확한 최종 스냅샷이 더 중요하기 때문(2026-07-20 발견 — 상한에 걸리면
// 장마감 후에도 낡은 장중 스냅샷이 그대로 남아, 애초에 이 로직이 막으려던 문제를
// 재현하는 모순이 있었음). regen_count는 이 경우에도 정상적으로 +1 기록되어
// 4를 넘을 수 있다(모니터링용 — 별도 상한으로 작동하지 않음).
// 2026-09-03: DB 실측(188건) 기준 자연 발생한 최대 regen_count는 3(장마감 강제
// 재생성 제외) — 4가 실제로 조기 소진돼 갱신이 막힌 실사례는 없었다(유일한
// regen_count=4 기록은 과거 QA 테스트용으로 수동 삽입된 데이터). 현재 여유가 있어
// 상향 조정하지 않는다.
export const MAX_DAILY_REGENS = 4;

export async function isIntradayRefreshDue(
  cachedCreatedAt: string,
  storedPrice: number | null,
  ticker: string,
): Promise<{ due: boolean; reason?: string }> {
  const now = new Date();
  const nowMinutes = kstMinutesSinceMidnight(now);
  if (nowMinutes < MARKET_OPEN_MINUTES_KST || nowMinutes >= MARKET_CLOSE_MINUTES_KST) return { due: false };

  const hoursSinceCreated = (now.getTime() - new Date(cachedCreatedAt).getTime()) / (60 * 60 * 1000);
  if (hoursSinceCreated < INTRADAY_FAST_MIN_HOURS_ELAPSED) return { due: false };
  if (!storedPrice) return { due: false };

  // 2시간 이상 지났으면 완화된(2.5%) 기준, 그 전(30분~2시간)이면 급변만 잡는
  // 엄격한(5%) 기준 — 경과 시간이 길수록 "낡았다"고 판단하는 기준을 낮춘다.
  const threshold = hoursSinceCreated >= INTRADAY_MIN_HOURS_ELAPSED
    ? INTRADAY_PRICE_MOVE_THRESHOLD
    : INTRADAY_FAST_PRICE_MOVE_THRESHOLD;

  try {
    const price = await fetchStockPrice(ticker);
    const movePct = Math.abs(price.price - storedPrice) / storedPrice;
    if (movePct < threshold) return { due: false };
    return { due: true, reason: `${hoursSinceCreated.toFixed(1)}h 경과·가격 ${(movePct * 100).toFixed(1)}% 변동` };
  } catch (e) {
    console.warn('[ANALYSIS] 장중 신선도 가격 조회 실패, 기존 캐시 유지:', ticker, e instanceof Error ? e.message : e);
    return { due: false };
  }
}
