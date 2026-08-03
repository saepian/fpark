// app/api/admin/users/route.ts가 유저 1명당 3개 count 쿼리(N+1)를 날리던 것을 대체.
// 유저별로 개별 쿼리를 날리는 대신, 테이블당 1번씩 유저 전체의 로우를 벌크로 가져온 뒤
// 여기서 user_id별로 그룹핑하고 각자의 사이클 경계(getUsageCycleStart)로 집계한다.
// 기존 per-user 쿼리의 `.gte(..., cycleStart)` 경계 조건을 그대로 재현해야 결과가
// 일치하므로, DB 쿼리와 동일하게 "이상(>=)" 비교를 쓴다.

import { getUsageCycleStart, isStockAnalysisDaily, type Plan } from '@/lib/plan';
import { kstDateStr } from '@/lib/ai-grounding';

export interface UsageAggregationUser {
  id:                     string;
  plan:                   Plan;
  subscriptionStartDate:  string | null;
}

interface TimestampRow {
  user_id:    string | null;
  created_at: string | null;
}

interface UsageDateRow {
  user_id:    string | null;
  usage_date: string;
}

export interface UsageCounts {
  diagnosisUsed:      number;
  portfolioUsed:      number;
  stockAnalysisUsed:  number;
}

function groupTimestampsByUser(rows: TimestampRow[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.user_id || !row.created_at) continue;
    const ts = new Date(row.created_at).getTime();
    const list = map.get(row.user_id);
    if (list) list.push(ts); else map.set(row.user_id, [ts]);
  }
  return map;
}

function groupUsageDatesByUser(rows: UsageDateRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.user_id) continue;
    const list = map.get(row.user_id);
    if (list) list.push(row.usage_date); else map.set(row.user_id, [row.usage_date]);
  }
  return map;
}

// stock_diagnosis/portfolio_diagnosis/stock_analysis_usage 로우를 유저별 사용량
// 카운트로 집계한다. 무료 회원의 종목분석만 예외적으로 "오늘(KST)" 기준(isStockAnalysisDaily),
// 나머지는 전부 getUsageCycleStart가 계산한 이번 사이클 시작일 기준 누적치다.
export function aggregateUsageCounts(
  users:              UsageAggregationUser[],
  diagnosisRows:      TimestampRow[],
  portfolioRows:      TimestampRow[],
  stockAnalysisRows:  UsageDateRow[],
  now:                Date,
  todayKst:           string,
): Map<string, UsageCounts> {
  const diagnosisByUser     = groupTimestampsByUser(diagnosisRows);
  const portfolioByUser     = groupTimestampsByUser(portfolioRows);
  const stockAnalysisByUser = groupUsageDatesByUser(stockAnalysisRows);

  const result = new Map<string, UsageCounts>();
  for (const u of users) {
    const { cycleStart } = getUsageCycleStart(u.subscriptionStartDate, now);
    const cycleStartMs      = cycleStart.getTime();
    // 2026-08-03 버그 수정: cycleStart(KST 자정을 나타내는 절대시각)를 그냥
    // `.toISOString().split('T')[0]`로 변환하면 UTC로 하루 당겨진다(예: KST 7/1 00:00 →
    // "2026-06-30") — 사이클 시작 전날 사용분까지 하루 더 포함되는 과다집계 버그였다.
    // kstDateStr()(lib/ai-grounding.ts)은 +9h 보정 후 날짜를 뽑아 이 왕복을 정확히
    // 되돌린다. 이 버그는 app/api/stock/[ticker]/analysis, app/api/stock/overseas/
    // [ticker]/analysis(실제 종목분석 월간 한도 게이트), app/api/mypage(사용량 표시),
    // app/api/payment/bank-transfer/request(업그레이드 크레딧 계산)에도 동일하게 있어
    // 함께 수정했다 — 이 파일만 격리된 버그가 아니었음.
    const cycleStartDateStr = kstDateStr(cycleStart);

    const diagnosisUsed = (diagnosisByUser.get(u.id) ?? []).filter((ts) => ts >= cycleStartMs).length;
    const portfolioUsed = (portfolioByUser.get(u.id) ?? []).filter((ts) => ts >= cycleStartMs).length;

    const usageDates = stockAnalysisByUser.get(u.id) ?? [];
    const stockAnalysisUsed = isStockAnalysisDaily(u.plan)
      ? usageDates.filter((d) => d === todayKst).length
      : usageDates.filter((d) => d >= cycleStartDateStr).length;

    result.set(u.id, { diagnosisUsed, portfolioUsed, stockAnalysisUsed });
  }
  return result;
}

// 유저 전체의 사이클 시작일 중 최솟값 — 벌크 쿼리의 날짜 하한(gte)으로 써서 불필요한
// 과거 데이터 스캔을 줄인다. 정확도는 aggregateUsageCounts의 유저별 재필터링이 보장하므로,
// 이 값은 순수 성능 최적화용(너무 타이트하게 잡아 데이터를 누락시키면 안 됨 — 최솟값이라
// 모든 유저의 실제 cycleStart보다 항상 이르거나 같다).
export function minCycleStart(users: UsageAggregationUser[], now: Date): Date {
  let min: Date | null = null;
  for (const u of users) {
    const { cycleStart } = getUsageCycleStart(u.subscriptionStartDate, now);
    if (!min || cycleStart.getTime() < min.getTime()) min = cycleStart;
  }
  return min ?? now;
}
