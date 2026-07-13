// 2026-07-08 삼성전자 2분기 잠정실적 발표를 AI 리포트가 "실적 발표를 앞두고"라며 이미 일어난
// 일을 미래형으로 서술한 버그(커밋 db58ba8)의 재발 방지용 공통 그라운딩/검증 유틸.
// 원인은 두 가지였다 — (1) 뉴스 검색 자체가 실적 기사를 못 찾음 (2) 찾아도 관련도 채점에서
// 탈락함. 두 원인 모두 결과적으로 "모델이 최신 사실관계를 모른 채 사전지식으로 추측"하게
// 만들었다는 공통점이 있다. 이 파일은 그 버그 클래스(이미 일어난 사건을 미래형으로 서술)를
// (a) 프롬프트 단계에서 예방하고 (b) 생성 후 휴리스틱으로 잡아내는 두 안전장치를 제공한다.
// 새 AI 리포트/인사이트 엔드포인트를 추가할 때도 이 파일의 함수들을 재사용할 것 — 각 파일에서
// 따로 비슷한 문구를 정의하면 문구가 흩어져 다음 종목/이벤트에서 같은 버그가 반복되기 쉽다.

// KST 기준 오늘 날짜 문자열(YYYY-MM-DD). "직전 리포트/진단과의 간격" 계산처럼
// 날짜 단위로만 비교하면 되는 곳(시각까지는 불필요)에 report_date 컬럼과 짝을 맞춰 쓴다.
export function kstDateStr(d: Date = new Date()): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

// 두 KST 날짜 문자열(YYYY-MM-DD) 사이의 일수 차이.
export function daysBetween(todayStr: string, prevDateStr: string): number {
  return Math.round((new Date(todayStr).getTime() - new Date(prevDateStr).getTime()) / 86_400_000);
}

export function nowKstString(): string {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const yyyy = kst.getFullYear();
  const mm = kst.getMonth() + 1;
  const dd = kst.getDate();
  const hh = String(kst.getHours()).padStart(2, '0');
  const mi = String(kst.getMinutes()).padStart(2, '0');
  return `${yyyy}년 ${mm}월 ${dd}일 ${hh}:${mi} (KST)`;
}

// 뉴스 메타데이터(건수, 가장 최근 기사 날짜)를 프롬프트에 명시 — 모델이 "내가 참조한 뉴스가
// 며칠 전 것인지" 스스로 인지하게 해서, 정보가 부족한데도 확정적으로 서술하는 것을 억제한다.
// news는 호출부에서 관련도/최신순으로 이미 정렬된 배열을 전달할 것(첫 원소를 "가장 최근"으로 사용).
export function buildNewsFreshnessLine(news: { title: string; date?: string }[]): string {
  if (news.length === 0) return '참조 뉴스: 0건 (최근 관련 뉴스 미확인)';
  const mostRecent = news.find((n) => n.date)?.date;
  return `참조 뉴스: ${news.length}건${mostRecent ? ` (가장 최근 기사: ${mostRecent})` : ''}`;
}

// 모든 리포트 생성 프롬프트에 공통 주입하는 시간적 사실관계 그라운딩 지침.
export const TEMPORAL_GROUNDING_INSTRUCTION =
  '아래에 제공된 사실관계 외에는 추측하지 마세요. 특히 이미 공시·발표된 사건(실적 발표, 계약 체결, ' +
  '제품 출시 등)을 "발표를 앞두고 있다", "발표 예정이다", "발표를 기다리고 있다" 같은 미래형·예정형으로 ' +
  '서술하지 말고, 이미 지난 일은 반드시 과거형으로만 서술하세요(예: "실적을 발표했다", "영업이익이 X로 ' +
  '나타났다"). 제공된 뉴스 데이터에 없는 사건은 본인의 사전 지식으로 추측해서 서술하지 말고 "최근 관련 ' +
  '뉴스 미확인"으로 처리하며, 확정적인 어조로 서술하지 마세요.';

// ── 사후 검증(sanity check) ──────────────────────────────────────────────────
// 정교한 NLP 대신 간단한 패턴 대조로 시작 — "이미 일어난 일을 미래형으로 쓰는" 이번 버그
// 클래스를 잡아내는 데 특화된 휴리스틱이다. 리포트 본문에 미래형 표현이 있는데, 같은 요청에
// 사용된 뉴스 데이터(제목·요약)에 그 사건이 이미 과거형으로 보도돼 있으면 불일치로 플래그한다.
// 완벽한 문장 이해가 아니라 "명백한 모순"만 걸러내는 저비용 안전망 — 오탐이 있어도 로그만
// 남기므로(자동 재생성 대상 라우트 제외) 사용자 경험에 영향은 없다.
const FUTURE_TENSE_PATTERNS = [/앞두고/, /앞둔/, /예정/, /기다리고\s*있/];
const PAST_TENSE_EVENT_PATTERNS = [
  /발표했(다|음)/, /공시했(다|음)/, /집계됐(다|음)/, /확정됐(다|음)/,
  /출시했(다|음)/, /체결했(다|음)/, /달성했(다|음)/,
];

export interface TemporalCheckResult {
  flagged: boolean;
  matchedFuture?: string;
  matchedPast?: string;
}

export function checkTemporalConsistency(reportText: string, newsText: string): TemporalCheckResult {
  const futureRe = FUTURE_TENSE_PATTERNS.find((re) => re.test(reportText));
  if (!futureRe) return { flagged: false };
  const pastRe = PAST_TENSE_EVENT_PATTERNS.find((re) => re.test(newsText));
  if (!pastRe) return { flagged: false };
  return {
    flagged: true,
    matchedFuture: reportText.match(futureRe)?.[0],
    matchedPast: newsText.match(pastRe)?.[0],
  };
}

// 온디맨드 단발성 리포트(사용자가 직접 요청 → 응답을 기다림) 전용 재생성 래퍼.
// 배치/크론처럼 유저 수만큼 반복 호출되는 라우트에는 쓰지 않는다 — N배로 비용이 늘어나기 때문에
// 그런 라우트는 로그만 남기고(checkTemporalConsistency 직접 호출) 재생성은 하지 않는 것으로 결정.
// 최대 1회만 재시도 — 그래도 불일치가 남으면 로그만 남기고 그 결과를 그대로 반환한다(무한 재시도 방지).
export async function withTemporalRetry<T>(
  generate: () => Promise<{ parsed: T; reportText: string }>,
  newsText: string,
  logPrefix: string,
): Promise<T> {
  const first = await generate();
  const check1 = checkTemporalConsistency(first.reportText, newsText);
  if (!check1.flagged) return first.parsed;

  console.warn(`${logPrefix} 시간적 사실관계 불일치 감지, 1회 재생성 시도:`, check1);
  const second = await generate();
  const check2 = checkTemporalConsistency(second.reportText, newsText);
  if (check2.flagged) {
    console.error(`${logPrefix} 재생성 후에도 불일치 감지 — 결과는 그대로 반환, 모니터링 필요:`, check2);
  } else {
    console.log(`${logPrefix} 재생성으로 불일치 해소됨`);
  }
  return second.parsed;
}
