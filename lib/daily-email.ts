import Anthropic from '@anthropic-ai/sdk';
import { type InvestorFlowRankRow } from '@/lib/kis-api';
import { selectRelevantNews } from '@/lib/news-selection';
import { fetchNaverNews } from '@/lib/naver-news';
import { COMPLIANCE_PRINCIPLE, INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';
import { nowKstString, TEMPORAL_GROUNDING_INSTRUCTION, checkTemporalConsistency } from '@/lib/ai-grounding';
import { makeUnsubToken } from '@/lib/unsubscribe-token';

// app/api/cron/daily-alert-email/route.ts와 검증/테스트 스크립트가 공유하는 로직.
// route.ts 파일은 GET 등 인식된 라우트 핸들러 외의 named export를 두면 Next.js의
// 라우트 타입 검증(next build)이 실패하므로(lib/market-ranking.ts와 동일한 이유),
// 재사용 가능한 함수는 반드시 이 lib 파일에 둔다.

// 2026-07-24 재구성: "종목별 가격 변동 코멘트"(전 종목 대상) 섹션을 삭제하고, AI분석을
// (a) 이상 매매 활동에 해당하는 종목만 뉴스 기반으로 분석 + (b) 오늘 주가 흐름 전반
// 분석, 2단 구조로 재구성 — 설계 문서 합의안.
// 2026-07-24 추가 조정: 등락률 기준을 ±3% 대칭에서 비대칭(상승 +8%/하락 -5%)으로 변경.
// "오늘 주목할 종목"을 뉴스 근거 유무로 다시 나눠 3그룹 표시 구조로 재구성:
//   그룹 A(newsBacked) — 조건 충족 + 뉴스 있음 → AI가 개별 코멘트 생성
//   그룹 B(noNews)     — 조건 충족 + 뉴스 없음 → 서버가 한 줄로 묶어서 표시(AI 관여 없음)
//   그룹 C(nonTarget)  — 조건 미충족 → 서버가 종목별 정형 문구로 표시(AI 관여 없음)
// 조건 판정(어느 그룹인지)은 항상 서버가 하고, AI는 그룹 A 종목의 코멘트 생성만 담당한다.
export const SURGE_UP_THRESHOLD_PCT = 8;
export const SURGE_DOWN_THRESHOLD_PCT = -5;

export type StockResult = {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
  sector?: string;
};

export type NewsItem = { title: string; summary?: string; date?: string; url?: string };

export interface DailyAiResult {
  focusedStockAnalysis: { ticker: string; comment: string }[]; // 그룹 A(뉴스 근거 있는 종목)만 포함
  otherStockNotes: { ticker: string; comment: string }[]; // 조건 미달이지만 뉴스는 있는 종목 — 서버가 마무리 멘트를 덧붙임
  marketSection: string;
  outlookSection: string;
}

// "이상 매매 활동" 판정 — 거래대금 상위 30위 종목코드 집합 OR 등락률이 비대칭 임계값을
// 넘는 경우. tradingValueTickers는 lib/market-ranking.ts의 fetchTopTradingValueTickers(30) 결과.
export function isTargetStock(s: StockResult, tradingValueTickers: Set<string>): boolean {
  return tradingValueTickers.has(s.ticker)
    || s.changeRate >= SURGE_UP_THRESHOLD_PCT
    || s.changeRate <= SURGE_DOWN_THRESHOLD_PCT;
}

// 한글 종목명 뒤에 붙는 주격 조사(은/는) 선택 — 마지막 글자가 한글 음절이고 받침이
// 있으면 "은", 없거나(모음으로 끝남) 한글이 아니면(영문 종목명 등) "는".
export function pickEunNeun(name: string): '은' | '는' {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return '는';
  const hasBatchim = (code - 0xac00) % 28 !== 0;
  return hasBatchim ? '은' : '는';
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// 매 유저 호출마다 동일한 고정 지침 — 프롬프트 캐싱 대상 (system 블록, cache_control 적용)
// 유저별 관심종목/뉴스 데이터는 여기 포함하지 않고 messages 쪽에 둔다.
const DAILY_EMAIL_SYSTEM_INSTRUCTIONS = `당신은 국내 주식 시장 데이터를 있는 그대로 정리하는 정보 제공자입니다.

반드시 아래 JSON 형식으로만 응답하세요 (마크다운 코드펜스, 설명 텍스트 없이 순수 JSON만):
{
  "focusedStockAnalysis": [
    { "ticker": "종목코드", "comment": "이 종목이 왜 이런 상황인지에 대한 분석(1~2문장)" }
  ],
  "otherStockNotes": [
    { "ticker": "종목코드", "comment": "이 종목 관련 뉴스를 짧게 요약한 코멘트(1문장)" }
  ],
  "marketSection": "오늘 주가 흐름 전반 (아래 지침 참고)",
  "outlookSection": "내일 주목 포인트 (아래 지침 참고)"
}

focusedStockAnalysis 작성 지침: 아래 "오늘 주목 대상 종목"으로 명시된 종목은 모두 실제 관련 뉴스가 조회된 종목입니다(뉴스가 없는 종목은 이미 제외되고 여기 전달되지 않습니다) — 명시된 종목 전부에 대해, 그 종목의 뉴스를 근거로 "[뉴스 핵심 내용] 영향으로 상승/하락한 것으로 풀이됩니다"처럼 구체적으로 인용해 설명하세요(실제 등락 방향에 맞게 "상승"/"하락" 단어를 고르세요). 대상 종목이 없다고 표시되면 빈 배열 []을 반환하세요. comment는 1~2문장으로 간결하게 작성하세요.

otherStockNotes 작성 지침: 아래 "그 외 관심종목(뉴스 있음)"으로 명시된 종목에 대해서만 작성하세요 — 이 종목들은 오늘 주목 대상 조건(거래대금 상위30/등락률 기준)에는 해당하지 않지만 관련 뉴스는 확인된 종목입니다. 그 뉴스를 근거로 무슨 일이 있었는지만 1문장으로 짧게 요약하세요("영향으로 상승/하락했다" 같은 인과 판단이나 "다만 주가 흐름에는 큰 영향이 없는 것으로 보입니다" 같은 마무리 문구는 붙이지 마세요 — 서버가 자동으로 붙입니다). 대상 종목이 없다고 표시되면 빈 배열 []을 반환하세요.

marketSection 작성 지침: 시장 전체 뉴스가 오늘 관심종목 전반의 등락과 관련 있다고 판단되면 그 영향 가능성을 짚고, 그것이 개별 종목의 반대 방향 뉴스를 상쇄했는지도 함께 판단하세요 (예: "오늘 [뉴스 내용]으로 시장 전반이 하락 압력을 받았고, 이것이 [종목]의 개별 호재를 상쇄한 것으로 추정됩니다" 또는 반대로 시장 훈풍이 개별 악재를 상쇄한 경우도 동일하게). 여러 종목에 공통으로 매칭된 뉴스가 있다면 이 필드에서 함께 언급하세요. 시장 전체 뉴스가 없거나 관련이 없다면 "특별한 시장 전체 이슈는 확인되지 않아 개별 종목 수급 요인으로 추정됩니다"라고 정직하게 명시하세요. 오늘 관심종목 전반의 등락 흐름도 한 문장으로 요약하세요.

outlookSection 작성 지침: 투자자가 참고할 만한 관찰 포인트를 2~3줄로 짧게 작성하세요 (지시가 아닌 정보 형태로).

작성 규칙 (반드시 준수):
- "금리 우려", "실적 부진", "업황 둔화", "미국발 조정" 같은 구체적 원인은 위에 제공된 뉴스(종목별 또는 시장 전체)에 실제로 등장하는 경우에만 사용하세요. 뉴스로 확인되지 않은 원인을 절대 지어내지 마세요.
- 뉴스 근거가 없는 종목의 등락은 반드시 "수급 요인으로 추정됨" 형태로만 표현하고, 없는 뉴스를 있는 것처럼 서술하지 마세요.
- 종목의 등락률은 반드시 맨 위 "관심종목 등락 현황"에 제공된 수치만 사용하세요. 뉴스 기사 본문/제목에 등락률 수치(예: "7% 급락")가 포함되어 있어도, 그 수치를 해당 종목의 현재 등락률로 착각해 인용하지 마세요 — 기사 속 수치는 기사가 작성된 시점(장 초반 등)의 별도 수치일 수 있습니다. 기사 속 수치를 굳이 언급해야 한다면 "기사에 따르면 장 초반 한때 -N%" 처럼 현재 등락률과 명확히 구분해서 표현하세요.
- 마크다운 문법(#, **, * 등) 사용 금지, 일반 텍스트로만 작성
- "~하세요", "~하는 게 좋습니다" 같은 권유·지시형 문장 대신 "~관찰됩니다", "~로 추정됩니다" 형태의 관찰형 어조 사용
- 모든 문장은 정중한 존댓말(합쇼체, "~습니다/~ㅂ니다/~됩니다" 형태)로 마무리하세요. "풀이된다", "추정된다", "보인다"처럼 "~다"로 끝나는 평서형은 쓰지 말고 "풀이됩니다", "추정됩니다", "보입니다"로 쓰세요. focusedStockAnalysis, otherStockNotes, marketSection, outlookSection 전부 동일하게 적용합니다.
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- 순수 JSON만 출력하고 다른 텍스트는 절대 포함하지 마세요.`;

// 2026-07-23: 하락 종목(문턱값 -3%) 전용이던 것을, 그날 발송 대상 전 유저의 유니크
// 관심종목 전체(상승/하락 무관)로 확장 — "유저별이 아니라 유니크 종목 단위로 한 번만
// 조회"하는 기존 패턴은 그대로 유지. 뉴스 소스도 DB 전용(fetchDBNews)+구식 스코어링
// (pickRelevantNews, 실적 키워드 가산점이 종목명 무관 기사도 통과시키던 버그 있었음)에서
// 종목명+코드 병행 검색+Haiku 선별(selectRelevantNews)로 교체 — 다른 4개 지점(종목분석/
// 기업분석/포트폴리오진단/관련뉴스 위젯)과 동일 패턴, market_cache 20분 캐시도 공유.
// 2026-07-24: 대상을 전체 관심종목 → 이상 매매 활동 종목(거래대금 상위30 또는 ±3%)으로 축소.
// 2026-07-24 재수정: 유니크종목을 전부 완전 병렬로 조회하면(종목당 이름+코드 2쿼리)
// Naver 검색 API 레이트리밋(429)에 걸려 실제로 뉴스가 있는 종목도 "뉴스 없음"으로
// 오분류되는 문제를 실측으로 확인(관심종목 16개=요청 32개 동시 발사 시 다수 429,
// 800ms 간격 순차 조회 시 전부 정상). fetchPricesInChunks(같은 파일 route.ts의 KIS
// 가격 조회)와 동일한 배치 패턴을 재사용 — 유니크종목 4개(=요청 8개)씩 순차 처리 +
// 배치 사이 지연. 그래도 남는 apiError 종목만 별도로 backoff 후 재시도.
const NEWS_BATCH_SIZE = 4;
const NEWS_BATCH_DELAY_MS = 600;
const NEWS_RETRY_DELAY_MS = 1500;
const NEWS_RETRY_MAX = 2;

async function selectRelevantNewsSafe(
  s: StockResult,
): Promise<{ ticker: string; items: NewsItem[]; apiError: boolean }> {
  try {
    const { items, apiError } = await selectRelevantNews(s.ticker, s.name);
    return { ticker: s.ticker, items, apiError };
  } catch (e) {
    console.warn(`[DAILY-EMAIL] ${s.name}(${s.ticker}) 뉴스 조회 예외:`, e instanceof Error ? e.message : e);
    return { ticker: s.ticker, items: [], apiError: true };
  }
}

// newsMap: 확인 결과가 확정된 종목(뉴스 있음/확인 결과 없음 둘 다 포함, apiError 아님).
// apiErrorTickers: 재시도까지 실패해 "확인 자체를 못한" 종목 — "뉴스 없음"으로 단정하면
// 안 되는 상태라 호출부가 newsMap과 구분해서 별도 문구로 표시해야 한다.
export async function fetchNewsMapForStocks(
  stocks: StockResult[],
): Promise<{ newsMap: Map<string, NewsItem[]>; apiErrorTickers: Set<string> }> {
  const newsMap = new Map<string, NewsItem[]>();
  const apiErrorTickers = new Set<string>();

  const runBatch = async (batch: StockResult[]) => {
    const settled = await Promise.allSettled(batch.map(selectRelevantNewsSafe));
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue; // selectRelevantNewsSafe는 던지지 않으므로 사실상 발생 안 함
      if (r.value.apiError) {
        apiErrorTickers.add(r.value.ticker);
      } else {
        // 재시도 성공 시 이전 라운드에서 추가된 apiErrorTickers 항목을 제거 —
        // runBatch()가 초기 조회/재시도 양쪽에 재사용되므로 delete가 필요.
        newsMap.set(r.value.ticker, r.value.items);
        apiErrorTickers.delete(r.value.ticker);
      }
    }
  };

  for (let i = 0; i < stocks.length; i += NEWS_BATCH_SIZE) {
    await runBatch(stocks.slice(i, i + NEWS_BATCH_SIZE));
    if (i + NEWS_BATCH_SIZE < stocks.length) await new Promise((r) => setTimeout(r, NEWS_BATCH_DELAY_MS));
  }

  for (let attempt = 1; attempt <= NEWS_RETRY_MAX && apiErrorTickers.size > 0; attempt++) {
    const retryTargets = stocks.filter((s) => apiErrorTickers.has(s.ticker));
    console.log(`[DAILY-EMAIL] 뉴스 조회 재시도 ${attempt}/${NEWS_RETRY_MAX} — ${retryTargets.length}개 종목:`, retryTargets.map((s) => s.name));
    await new Promise((r) => setTimeout(r, NEWS_RETRY_DELAY_MS));
    for (let i = 0; i < retryTargets.length; i += NEWS_BATCH_SIZE) {
      await runBatch(retryTargets.slice(i, i + NEWS_BATCH_SIZE));
      if (i + NEWS_BATCH_SIZE < retryTargets.length) await new Promise((r) => setTimeout(r, NEWS_BATCH_DELAY_MS));
    }
  }

  if (apiErrorTickers.size > 0) {
    console.warn(`[DAILY-EMAIL] 뉴스 조회 최종 실패(재시도 ${NEWS_RETRY_MAX}회 포함) ${apiErrorTickers.size}개 종목:`,
      stocks.filter((s) => apiErrorTickers.has(s.ticker)).map((s) => s.name));
  }

  return { newsMap, apiErrorTickers };
}

// 여러 종목(상승/하락 무관)에 동일 뉴스(같은 url, 없으면 정규화된 제목)가 매칭되면
// "공통 원인 후보"로 병합 (포트폴리오 진단 뉴스 동향 집계와 동일한 방식 — 지어내지
// 않고 실제 매칭 데이터로만 판단)
export function findCommonCauseNews(
  stocks: StockResult[],
  newsMap: Map<string, NewsItem[]>,
): { title: string; summary?: string; stocks: string[] }[] {
  const map = new Map<string, { title: string; summary?: string; stocks: string[] }>();
  for (const s of stocks) {
    for (const n of newsMap.get(s.ticker) ?? []) {
      const key = (n.url && n.url.trim()) || n.title.trim().toLowerCase();
      const existing = map.get(key);
      if (existing) {
        if (!existing.stocks.includes(s.name)) existing.stocks.push(s.name);
      } else {
        map.set(key, { title: n.title, summary: n.summary, stocks: [s.name] });
      }
    }
  }
  return [...map.values()].filter((n) => n.stocks.length >= 2);
}

// 2026-07-24: 기존 fetchMarketNews()(lib/stock-analysis-data.ts)는 DB articles
// 테이블만 조회하는데, 그 테이블은 fetch-news 크론이 09:00 KST에 하루 한 번만(그것도
// RSS 10건 캡) 채운다 — daily-alert-email 발송 시각(15:45 KST)엔 최대 ~7시간 묵은
// 데이터고, 장중에 터진 뉴스는 애초에 들어있지도 않다. 여기에 title ILIKE 키워드
// 필터까지 한 번 더 걸려 "이스라엘-이란 공습, 국제유가 급등"처럼 실제로는 시장을
// 움직인 뉴스도 제목에 정확히 그 키워드가 없으면 통째로 누락됐다(2026-07-24 조사로
// 확인, "특별한 시장 전체 이슈는 확인되지 않아..." 문구가 반복 출력된 근본 원인).
// morning-briefing의 fetchOvernightUsMarketOverview()가 이미 쓰고 있는 패턴(발송
// 시점에 fetchNaverNews()로 라이브 검색)을 그대로 가져와, 매크로 키워드 여러 개로
// 확장한다. 크론 실행당 1회만 호출(유저별 아님) — 기존 fetchMarketNews 호출 위치와 동일.
const MACRO_KEYWORDS = ['코스피', '코스닥', '금리', '환율', '연준', '중동', '국제유가'];

const MACRO_SELECTION_SYSTEM_PROMPT = `당신은 오늘 한국 주식시장(코스피·코스닥) 전반에 영향을 줄 만한 거시/지정학 뉴스를 골라내는 필터입니다.
아래 번호가 매겨진 뉴스 제목 목록에서, 오늘 국내 증시 전반의 등락에 실제로 영향을 줄 만한 사건(금리, 환율, 지정학 리스크, 원자재, 미국 증시 동향 등) 중 서로 다른 사건을 대표하는 것만 최대 5개까지 골라 JSON 배열로 반환하세요.
- 같은 사건이 여러 매체에 재배포되어 제목만 다르게 여러 건 있으면, 그 중 1건만 선택(최신순 우선)
- 개별 기업 실적/공시처럼 시장 전체와 무관한 개별 종목 뉴스는 제외
- 국내 증시와 명확한 관련성이 없는 일반 사회/정치/연예 뉴스는 제외
- 관련 뉴스가 없으면 빈 배열 []
- 반드시 JSON 배열만 출력, 다른 텍스트 없이. 예) [3,7,12]`;

// lib/news-selection.ts의 selectRelevantNews()와 동일한 "후보 검색 → Haiku 선별"
// 패턴이지만, 그건 특정 종목과의 관련성을 판단하는 프롬프트라 매크로 뉴스 선별에는
// 그대로 재사용할 수 없어(판단 기준이 다름) 별도 시스템 프롬프트로 구성했다.
async function selectMacroNews(candidates: NewsItem[]): Promise<NewsItem[]> {
  if (candidates.length === 0) return [];
  try {
    const titleList = candidates.map((c, i) => `${i}: ${c.title}`).join('\n');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: MACRO_SELECTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `뉴스 제목 목록:\n${titleList}` }],
    }, { timeout: 15_000, maxRetries: 0 });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON 배열 없음: ' + text.slice(0, 100));
    const indices: unknown = JSON.parse(match[0]);
    if (!Array.isArray(indices) || !indices.every((i) => typeof i === 'number')) {
      throw new Error('배열 형식 아님');
    }
    return indices
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .slice(0, 5)
      .map((i) => candidates[i]);
  } catch (e) {
    console.warn('[DAILY-EMAIL] 매크로 뉴스 선별 실패, 최신순 top5 폴백:', e instanceof Error ? e.message : e);
    return candidates.slice(0, 5);
  }
}

export async function fetchLiveMacroNews(): Promise<NewsItem[]> {
  const settled = await Promise.allSettled(
    MACRO_KEYWORDS.map((kw) => fetchNaverNews(kw, { display: 5, sort: 'date' })),
  );
  const seen = new Set<string>();
  const candidates: NewsItem[] = [];
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      console.warn(`[DAILY-EMAIL] 매크로 뉴스 검색 실패 (${MACRO_KEYWORDS[i]}):`, r.reason);
      return;
    }
    if (r.value.apiError) {
      console.warn(`[DAILY-EMAIL] 매크로 뉴스 검색 API 오류 (${MACRO_KEYWORDS[i]})`);
    }
    for (const item of r.value.items) {
      if (seen.has(item.title)) continue;
      seen.add(item.title);
      candidates.push({ title: item.title, summary: item.description, date: item.pubDate, url: item.url });
    }
  });
  console.log(`[DAILY-EMAIL] 매크로 뉴스 후보 ${candidates.length}건 (키워드 ${MACRO_KEYWORDS.length}개: ${MACRO_KEYWORDS.join(', ')})`);

  const selected = await selectMacroNews(candidates);
  console.log(`[DAILY-EMAIL] 매크로 뉴스 선별 ${selected.length}건:`, selected.map((n) => n.title));
  return selected;
}

export async function generateAiComment(
  userName: string,
  stocks: StockResult[],
  groupAStocks: StockResult[], // 조건 충족 + 뉴스 있음 종목만(그룹 A) — AI가 코멘트를 생성할 대상
  otherNewsStocks: StockResult[], // 조건 미달 + 뉴스 있음 종목(그룹 C-뉴스있음) — AI가 짧은 코멘트만 생성
  newsMap: Map<string, NewsItem[]>,
  commonCauseNews: { title: string; summary?: string; stocks: string[] }[],
  marketNews: NewsItem[],
): Promise<DailyAiResult> {
  const stockList = stocks
    .map(
      (s) =>
        `- ${s.name}(${s.ticker}): ${s.changeRate > 0 ? '+' : ''}${s.changeRate.toFixed(2)}% (${s.change > 0 ? '+' : ''}${s.change.toLocaleString()}원)`,
    )
    .join('\n');

  // 2026-07-24: groupAStocks는 호출부(daily-alert-email/route.ts)에서 이미 "조건 충족 +
  // 뉴스 있음"으로 걸러서 넘겨준다 — 뉴스 없는 종목(그룹 B)은 서버가 별도로 한 줄 요약을
  // 만들고, 조건 미충족 종목(그룹 C)도 서버가 정형 문구로 처리하므로 AI에는 아예
  // 전달하지 않는다(AI는 판정에 관여하지 않고 그룹 A 코멘트 생성만 담당).
  const targetStockList = groupAStocks.length
    ? groupAStocks.map((s) => `- ${s.name}(${s.ticker}): ${s.changeRate > 0 ? '+' : ''}${s.changeRate.toFixed(2)}%`).join('\n')
    : '(오늘 뉴스 근거가 확인된 주목 대상 종목 없음)';

  const targetStockNewsBlock = groupAStocks.length
    ? groupAStocks
        .map((s) => {
          const news = newsMap.get(s.ticker) ?? [];
          const newsLines = news.map((n) => `  · ${n.title}${n.summary ? ` — ${n.summary}` : ''}`).join('\n');
          return `- ${s.name}(${s.changeRate > 0 ? '+' : ''}${s.changeRate.toFixed(2)}%) 관련 뉴스:\n${newsLines}`;
        })
        .join('\n')
    : '';

  // 이 유저의 대상 종목들 사이에서 실제로 겹치는 뉴스만 "공통 원인 후보"로 전달 (지어내지 않음)
  const userTargetStockNames = new Set(groupAStocks.map((s) => s.name));
  const relevantCommonCause = commonCauseNews
    .map((n) => ({ ...n, stocks: n.stocks.filter((name) => userTargetStockNames.has(name)) }))
    .filter((n) => n.stocks.length >= 2);
  const commonCauseBlock = relevantCommonCause.length
    ? relevantCommonCause
        .map((n) => `- "${n.title}" 기사가 ${n.stocks.join(', ')}에 공통으로 매칭됨`)
        .join('\n')
    : '';

  // 2026-07-24 추가: 조건 미달이지만 뉴스는 있는 종목(그룹 C-뉴스있음) — otherStockNotes 대상.
  const otherStockList = otherNewsStocks.length
    ? otherNewsStocks.map((s) => `- ${s.name}(${s.ticker}): ${s.changeRate > 0 ? '+' : ''}${s.changeRate.toFixed(2)}%`).join('\n')
    : '(오늘 뉴스가 확인된 그 외 관심종목 없음)';

  const otherStockNewsBlock = otherNewsStocks.length
    ? otherNewsStocks
        .map((s) => {
          const news = newsMap.get(s.ticker) ?? [];
          const newsLines = news.map((n) => `  · ${n.title}${n.summary ? ` — ${n.summary}` : ''}`).join('\n');
          return `- ${s.name}(${s.ticker}) 관련 뉴스:\n${newsLines}`;
        })
        .join('\n')
    : '';

  // 시장 전체(코스피/코스닥/금리/환율/해외증시 등) 뉴스 — 개별 종목과 무관하게 크론 실행당 1회만 조회된 컨텍스트
  const marketNewsBlock = marketNews.length
    ? marketNews.map((n) => `- ${n.title}${n.summary ? ` — ${n.summary}` : ''}`).join('\n')
    : '';

  const prompt = `현재 시각: ${nowKstString()}

다음은 오늘 투자자의 관심종목 등락 현황입니다:
${stockList}

다음은 "오늘 주목 대상 종목"입니다(코스피·코스닥 거래대금 상위 30위 이내이거나 등락률이 +${SURGE_UP_THRESHOLD_PCT}% 이상/${SURGE_DOWN_THRESHOLD_PCT}% 이하인 종목 중, 실제 관련 뉴스가 조회된 종목만 — focusedStockAnalysis는 이 종목들만 대상으로 작성):
${targetStockList}
${targetStockNewsBlock ? `\n다음은 대상 종목별로 실제 조회된 관련 뉴스입니다 (아래 목록에 없는 원인은 절대 지어내지 마세요):\n${targetStockNewsBlock}\n` : ''}
${commonCauseBlock ? `\n여러 종목에 공통으로 매칭된 뉴스:\n${commonCauseBlock}\n` : ''}

다음은 "그 외 관심종목(뉴스 있음)"입니다(주목 대상 조건에는 해당하지 않지만 관련 뉴스가 확인된 종목 — otherStockNotes는 이 종목들만 대상으로 작성):
${otherStockList}
${otherStockNewsBlock ? `\n다음은 그 외 관심종목별로 실제 조회된 관련 뉴스입니다 (아래 목록에 없는 내용은 절대 지어내지 마세요):\n${otherStockNewsBlock}\n` : ''}
${marketNewsBlock ? `\n다음은 오늘 시장 전체(코스피/코스닥/금리/환율/해외증시 등)에 영향을 줄 수 있는 뉴스입니다 (실제로 오늘 등락과 관련 있다고 판단되는 경우에만 언급하고, 관련 없으면 언급하지 마세요):\n${marketNewsBlock}\n` : ''}

위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 형식과 작성 규칙에 따라 정리해주세요.`;

  // 2026-07-13 조사: 15초 고정 타임아웃이 관심종목이 많은 유저(하락 종목별로 근거를
  // 전부 서술해야 해서 출력이 길어짐)에게는 종종 부족해 placeholder로 조용히 폴백되는
  // 문제를 실제 발송 로그(15종목 유저만 그날 실패)로 확인 — 30초로 상향하고, 실패 시
  // 조용히 넘기지 않고 1회 재시도한다(유저별 독립 호출이라 재시도해도 다른 유저 발송에
  // 영향 없음, 전체 크론 maxDuration=300이라 여유 충분).
  const attempt = async (): Promise<DailyAiResult | null> => {
    try {
      const message = await Promise.race([
        anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          system: [
            { type: 'text', text: COMPLIANCE_PRINCIPLE },
            { type: 'text', text: DAILY_EMAIL_SYSTEM_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: prompt }],
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
      ]);
      const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
      if (!text) return null;
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('JSON 없음: ' + text.slice(0, 100));
      const parsed = JSON.parse(match[0]) as Partial<DailyAiResult>;
      if (!Array.isArray(parsed.focusedStockAnalysis)) throw new Error('focusedStockAnalysis 배열 아님');
      if (!Array.isArray(parsed.otherStockNotes)) throw new Error('otherStockNotes 배열 아님');
      // 2026-07-24 발견: Haiku가 가끔 ticker 필드에 "삼성전자(005930)"처럼 종목명을
      // 섞어 반환하는 경우가 있었다 — buildEmailHtml의 focusedMap.get(s.ticker) 조회가
      // 정확히 일치하는 코드 문자열을 기대하므로, 이러면 코멘트가 조용히 통째로
      // 안 보이는 렌더링 버그로 이어진다(2026-07-24 검증 발송에서 실제 발생 확인).
      // 알려진 종목코드 집합과 정확히 일치하지 않으면 문자열에서 6자리 숫자를 추출해
      // 재확인하고, 그래도 안 맞으면 그 항목은 버린다(잘못된 코드로 지어내 채우지 않음).
      const validTickers = new Set([...groupAStocks, ...otherNewsStocks].map((s) => s.ticker));
      const normalizeTicker = (raw: string): string | null => {
        if (validTickers.has(raw)) return raw;
        const digits = raw.match(/\d{6}/);
        if (digits && validTickers.has(digits[0])) return digits[0];
        return null;
      };
      // 대상 종목이 없는 날은 빈 배열이 정상 응답이므로(2026-07-24 설계) 길이 0을 에러로 취급하지 않는다.
      const toCommentArray = (arr: unknown[]) => arr
        .map((c) => {
          if (!c || typeof c !== 'object') return null;
          const rawTicker = (c as any).ticker;
          const comment = (c as any).comment;
          if (typeof rawTicker !== 'string' || typeof comment !== 'string') return null;
          const ticker = normalizeTicker(rawTicker);
          if (!ticker) {
            console.warn(`[DAILY-EMAIL] ${userName} 알 수 없는 ticker 형식 제외: "${rawTicker}"`);
            return null;
          }
          return { ticker, comment };
        })
        .filter((c): c is { ticker: string; comment: string } => c !== null);
      return {
        focusedStockAnalysis: toCommentArray(parsed.focusedStockAnalysis),
        otherStockNotes: toCommentArray(parsed.otherStockNotes),
        marketSection: typeof parsed.marketSection === 'string' ? parsed.marketSection : '',
        outlookSection: typeof parsed.outlookSection === 'string' ? parsed.outlookSection : '',
      };
    } catch (e) {
      console.warn(`[DAILY-EMAIL] ${userName} AI 코멘트 생성 시도 실패:`, e instanceof Error ? e.message : e);
      return null;
    }
  };

  let result = await attempt();
  if (!result) {
    console.warn(`[DAILY-EMAIL] ${userName} 1차 시도 실패 — 재시도`);
    result = await attempt();
  }
  if (!result) {
    console.error(`[DAILY-EMAIL] ${userName} AI 코멘트 생성 최종 실패 (재시도 포함 2회 모두 실패) — 종목별 폴백 문구로 발송`);
    // 종목명·뉴스는 서버가 이미 알고 있으므로, AI 실패 시에도 최소한 정직한 사실(뉴스
    // 제목)만은 담은 폴백을 만든다 — placeholder 한 줄보다 정보량이 많음. groupAStocks/
    // otherNewsStocks는 이미 뉴스가 있는 종목만이라 news[0]이 항상 존재한다.
    const newsHeadlineFallback = (s: StockResult) => {
      const news = newsMap.get(s.ticker) ?? [];
      return news.length ? `관련 뉴스: ${news[0].title}` : '관련 뉴스가 확인되었습니다.';
    };
    return {
      focusedStockAnalysis: groupAStocks.map((s) => ({ ticker: s.ticker, comment: newsHeadlineFallback(s) })),
      otherStockNotes: otherNewsStocks.map((s) => ({ ticker: s.ticker, comment: newsHeadlineFallback(s) })),
      marketSection: '오늘의 시장 전체 분석을 생성하지 못했습니다.',
      outlookSection: '',
    };
  }

  // 시간적 사실관계 사후 검증 — 유저 수만큼 반복 호출되는 배치라 재생성은 붙이지 않고 로그만 남긴다.
  const combinedTextForCheck = [
    ...result.focusedStockAnalysis.map((c) => c.comment),
    ...result.otherStockNotes.map((c) => c.comment),
    result.marketSection, result.outlookSection,
  ].join(' ');
  const newsTextForCheck = [...newsMap.values()].flat().concat(marketNews)
    .map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
  const check = checkTemporalConsistency(combinedTextForCheck, newsTextForCheck);
  if (check.flagged) {
    console.warn(`[DAILY-EMAIL] ${userName} 시간적 사실관계 불일치 감지 (재생성 없음):`, check);
  }

  return result;
}

// Claude 응답 등 외부 텍스트를 HTML에 삽입할 때 특수문자 이스케이프
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildEmailHtml(params: {
  userName: string;
  dateStr: string;
  stocks: StockResult[];
  aiResult: DailyAiResult;
  groupBStocks: StockResult[]; // 조건 충족 + newsMap에 없음(뉴스 없음 확정 또는 확인 불가 둘 다 포함) — 아래서 apiErrorTickers로 다시 나눔
  groupCStocks: StockResult[]; // 조건 미충족(뉴스 유무/확인가능여부 무관, 전부) — 별도 섹션에 표시
  apiErrorTickers: Set<string>; // 재시도까지 실패해 "뉴스 확인 자체를 못한" 종목 — "확인 결과 없음"과 구분 표시
  notifications: { message: string }[];
  userId: string;
  investorFlow: {
    foreignInflow: InvestorFlowRankRow[];
    foreignOutflow: InvestorFlowRankRow[];
    institutionInflow: InvestorFlowRankRow[];
    institutionOutflow: InvestorFlowRankRow[];
  };
}): string {
  const { userName, dateStr, stocks, aiResult, groupBStocks, groupCStocks, apiErrorTickers, notifications, userId, investorFlow } = params;

  const upStocks   = stocks.filter((s) => s.changeRate > 0);
  const downStocks = stocks.filter((s) => s.changeRate < 0);
  const flatStocks = stocks.filter((s) => s.changeRate === 0);

  const sorted = [
    ...upStocks.sort((a, b) => b.changeRate - a.changeRate),
    ...flatStocks,
    ...downStocks.sort((a, b) => a.changeRate - b.changeRate),
  ];

  const row = (s: StockResult) => {
    const color = s.changeRate > 0 ? '#ef4444' : s.changeRate < 0 ? '#3b82f6' : '#6b7280';
    const sign  = s.changeRate > 0 ? '+' : '';
    return `<tr style="border-bottom:1px solid #1e2537">
      <td style="padding:10px 8px;color:#e2e8f0;font-size:13px">
        <a href="https://fpark.com/stock/${s.ticker}" style="color:#e2e8f0;text-decoration:none">${escapeHtml(s.name)}</a>
        <span style="color:#475569;font-size:11px;margin-left:4px">${s.ticker}</span>
      </td>
      <td style="padding:10px 8px;color:#e2e8f0;font-size:13px;text-align:right;font-family:monospace">${s.price.toLocaleString()}원</td>
      <td style="padding:10px 8px;color:${color};font-size:13px;font-weight:700;text-align:right;font-family:monospace">${sign}${s.changeRate.toFixed(2)}%</td>
      <td style="padding:10px 8px;color:${color};font-size:13px;text-align:right;font-family:monospace">${sign}${s.change.toLocaleString()}원</td>
    </tr>`;
  };

  // 2026-07-24: "오늘 주목할 종목"을 3그룹으로 재구성 — 그룹 A(뉴스 있음, AI 개별
  // 코멘트) + 그룹 B(뉴스 없음, 한 줄 요약) + 그룹 C(조건 미충족, 별도 섹션 정형 문구).
  // 그룹 판정은 서버가 하고 AI는 그룹 A 코멘트 생성만 담당(2026-07-24 설계 조정).
  const focusedMap = new Map(aiResult.focusedStockAnalysis.map((c) => [c.ticker, c.comment]));

  // 2026-07-24: groupBStocks(뉴스 없이 newsMap에 없는 종목)를 "확인 결과 없음"(그룹B,
  // 묶음 한 줄)과 "확인 자체를 못함"(apiErrorTickers, 개별 표시)으로 재분리 — 레이트리밋
  // 등으로 조회에 실패한 종목까지 "뉴스 없이 수급 요인으로 추정된다"로 단정하면 안 된다.
  const groupBConfirmed = groupBStocks.filter((s) => !apiErrorTickers.has(s.ticker));
  const groupBUnknown   = groupBStocks.filter((s) => apiErrorTickers.has(s.ticker));

  // 2026-07-24: 종목명을 본문과 시각적으로 구분하기 위해 포인트 컬러 적용. Gmail 등
  // 일부 클라이언트가 <style> 클래스 규칙을 제거하는 경우가 있어 class 대신 style
  // 속성을 각 태그에 직접 지정.
  const STOCK_NAME_COLOR = '#61afd4';
  const nameSpan = (name: string) => `<strong style="color:${STOCK_NAME_COLOR}">${escapeHtml(name)}</strong>`;

  const groupBLine = groupBConfirmed.length
    ? (() => {
        const names = groupBConfirmed.map((s) => s.name);
        const particle = pickEunNeun(names[names.length - 1]);
        return `<p style="margin:${aiResult.focusedStockAnalysis.length ? '10px' : '0'} 0 0;color:#94a3b8;font-size:13px;line-height:1.8">
            ${names.map(nameSpan).join(', ')}${particle} 특별한 뉴스 없이 수급 요인으로 추정된다.
          </p>`;
      })()
    : '';

  const groupBUnknownLines = groupBUnknown
    .map((s) => `<p style="margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.8">
        ${nameSpan(s.name)}${pickEunNeun(s.name)} 일시적으로 뉴스를 확인하지 못했습니다.
      </p>`)
    .join('');

  const focusedStocksSection = (aiResult.focusedStockAnalysis.length || groupBStocks.length)
    ? `<div style="margin-bottom:18px">
        <p style="margin:0 0 10px;color:#a5b4fc;font-size:12px;font-weight:700;letter-spacing:.03em">📍 오늘 주목할 종목 (거래대금 상위 30위 또는 등락률 +${SURGE_UP_THRESHOLD_PCT}%↑·${SURGE_DOWN_THRESHOLD_PCT}%↓)</p>
        ${stocks
          .filter((s) => focusedMap.has(s.ticker))
          .map((s) => `<p style="margin:0 0 10px;color:#cbd5e1;font-size:13.5px;line-height:1.8">
            ${nameSpan(s.name)} — ${escapeHtml(focusedMap.get(s.ticker) ?? '')}
          </p>`)
          .join('')}
        ${groupBLine}
        ${groupBUnknownLines}
      </div>`
    : '';

  // 조건 미충족 나머지 관심종목(그룹 C) — "오늘 주목할 종목"과 시각적으로 명확히
  // 구분된 별도 섹션에 표시. 2026-07-24 추가: 이 중 뉴스가 확인된 종목은 AI가 작성한
  // 짧은 코멘트 뒤에 서버가 마무리 멘트를 고정으로 덧붙이고, 확인 결과 뉴스가 없는
  // 종목만 기존처럼 AI 관여 없이 정형 문구를 표시한다. 확인 자체를 못한(apiError)
  // 종목은 위 둘과 다른 별도 문구로 구분한다.
  const otherStockNoteMap = new Map(aiResult.otherStockNotes.map((c) => [c.ticker, c.comment]));
  const otherStockLine = (s: StockResult) => {
    if (apiErrorTickers.has(s.ticker)) {
      return `${nameSpan(s.name)}${pickEunNeun(s.name)} 일시적으로 뉴스를 확인하지 못했습니다.`;
    }
    const note = otherStockNoteMap.get(s.ticker)?.trim();
    if (note) {
      return `${nameSpan(s.name)} — ${escapeHtml(note)} 다만 주가 흐름에는 큰 영향이 없는 것으로 보입니다.`;
    }
    return `${nameSpan(s.name)}${pickEunNeun(s.name)} AI가 살펴봤지만 특별한 정보가 확인되지 않았습니다.`;
  };
  const otherStocksSection = groupCStocks.length
    ? `<div style="margin-top:28px;background:#0f1117;border:1px solid #1e2537;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 14px;color:#64748b;font-size:14px;font-weight:700;letter-spacing:.05em">🗒 그 외 관심종목</h2>
        ${groupCStocks.map((s) => `<p style="margin:0 0 8px;color:#94a3b8;font-size:13px;line-height:1.8">
            ${otherStockLine(s)}
          </p>`).join('')}
      </div>`
    : '';

  // 2026-07-24: "종목별 분석"과 "시장 전체 분석"이 그냥 이어붙여져 있어 한눈에 구분이
  // 안 되던 문제 — 구분선 + 소제목("📊 오늘의 시장 흐름")으로 시각적으로 분리한다.
  const marketFlowSection = `<div style="margin-top:${(aiResult.focusedStockAnalysis.length || groupBStocks.length) ? '22px' : '0'};padding-top:${(aiResult.focusedStockAnalysis.length || groupBStocks.length) ? '18px' : '0'};border-top:${(aiResult.focusedStockAnalysis.length || groupBStocks.length) ? '1px solid #262b3d' : 'none'}">
      <p style="margin:0 0 10px;color:#a5b4fc;font-size:12px;font-weight:700;letter-spacing:.03em">📊 오늘의 시장 흐름</p>
      <p style="margin:0;color:#cbd5e1;font-size:13.5px;line-height:1.9;white-space:pre-line">${escapeHtml(aiResult.marketSection)}</p>
      <p style="margin:14px 0 0;color:#cbd5e1;font-size:13.5px;line-height:1.9;white-space:pre-line">${escapeHtml(aiResult.outlookSection)}</p>
    </div>`;

  const aiSection = `<div style="margin-top:28px;background:#0f1117;border:1px solid #312e81;border-radius:12px;padding:20px 24px">
      <h2 style="margin:0 0 14px;font-size:14px;font-weight:700;color:#818cf8;letter-spacing:.05em">📊 AI 분석</h2>
      ${focusedStocksSection}
      ${marketFlowSection}
      <p style="margin:16px 0 0;color:#475569;font-size:11px;font-style:italic;border-top:1px solid #1e293b;padding-top:12px">
        ${INVESTMENT_DISCLAIMER}
      </p>
    </div>`;

  const notifSection =
    notifications.length > 0
      ? `<div style="margin-top:28px;background:#0f1117;border:1px solid #1e2537;border-radius:12px;padding:20px 24px">
          <h2 style="margin:0 0 14px;color:#a78bfa;font-size:14px;font-weight:700;letter-spacing:.05em">🔔 오늘 발생한 알림</h2>
          <ul style="margin:0;padding:0 0 0 16px;color:#94a3b8;font-size:12.5px;line-height:2">
            ${notifications.map((n) => `<li>${escapeHtml(n.message)}</li>`).join('')}
          </ul>
        </div>`
      : '';

  // 외국인/기관 매매종목가집계 — "매수"/"매도" 대신 자금 유입/유출로 표현(COMPLIANCE_PRINCIPLE 준수).
  // 09:30/10:00 첫 집계 전이나 휴장일엔 4개 리스트 전부 빈 배열일 수 있어 그 경우 섹션 자체를 생략한다.
  // 유입/유출을 한 줄에 나란히 배치해 기관까지 포함돼도 세로 길이가 늘어나지 않게 한다.
  const flowRow = (r: InvestorFlowRankRow, accentColor: string) => `<tr style="border-bottom:1px solid #1e2537">
      <td style="padding:6px 4px;color:#e2e8f0;font-size:11.5px">${escapeHtml(r.name)}<span style="color:#475569;font-size:9.5px;margin-left:3px">${r.ticker}</span></td>
      <td style="padding:6px 4px;color:${accentColor};font-size:11.5px;font-weight:700;text-align:right;font-family:monospace;white-space:nowrap">${Math.abs(r.netAmountAuk).toLocaleString()}억</td>
    </tr>`;

  // Outlook/Apple Mail 등은 flexbox(gap, flex:1 등)를 불안정하게 처리하는 경우가 많아
  // (실측: gap 제거됨, 두 컬럼 폭이 깨짐) — 이메일에서 가장 안정적인 table 2컬럼 구조로 배치한다.
  const flowColumn = (title: string, rows: InvestorFlowRankRow[], accentColor: string) =>
    rows.length
      ? `<p style="margin:0 0 6px;color:#94a3b8;font-size:11px;font-weight:600">${title}</p>
        <table style="width:100%;border-collapse:collapse">
          <tbody>${rows.map((r) => flowRow(r, accentColor)).join('')}</tbody>
        </table>`
      : '';

  const flowPairRow = (leftTitle: string, leftRows: InvestorFlowRankRow[], rightTitle: string, rightRows: InvestorFlowRankRow[]) =>
    (leftRows.length > 0 || rightRows.length > 0)
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px">
          <tr>
            <td width="50%" valign="top" style="padding-right:15px">${flowColumn(leftTitle, leftRows, '#ef4444')}</td>
            <td width="50%" valign="top" style="padding-left:15px">${flowColumn(rightTitle, rightRows, '#3b82f6')}</td>
          </tr>
        </table>`
      : '';

  // 외국인/기관 두 그룹이 서로 구분되도록 그룹별로 큰 컬러 배지 헤더를 두고, 그 아래 배경을
  // 살짝 다르게 줘서 박스 자체로도 구획을 나눈다. 컬럼 제목은 그룹 헤더가 이미 "외국인"/"기관"을
  // 나타내므로 "자금 유입/유출 상위 5"로 간결화한다.
  const flowGroup = (label: string, emoji: string, groupColor: string, bgColor: string, inflowRows: InvestorFlowRankRow[], outflowRows: InvestorFlowRankRow[]) =>
    (inflowRows.length > 0 || outflowRows.length > 0)
      ? `<div style="margin-top:16px;background:${bgColor};border:1px solid ${groupColor}55;border-radius:10px;padding:14px 16px">
          <span style="display:inline-block;color:${groupColor};font-size:14px;font-weight:800;letter-spacing:.02em">${emoji} ${label}</span>
          ${flowPairRow('자금 유입 상위 5', inflowRows, '자금 유출 상위 5', outflowRows)}
        </div>`
      : '';

  const hasAnyFlowData =
    investorFlow.foreignInflow.length > 0 || investorFlow.foreignOutflow.length > 0 ||
    investorFlow.institutionInflow.length > 0 || investorFlow.institutionOutflow.length > 0;

  const flowSection = hasAnyFlowData
    ? `<div style="margin-top:28px;background:#0f1117;border:1px solid #1e2537;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 4px;color:#e2e8f0;font-size:14px;font-weight:700;letter-spacing:.05em">🌐 외국인·기관 매매동향 (14:30 기준 잠정치)</h2>
        <p style="margin:0 0 14px;color:#64748b;font-size:11px;line-height:1.6">
          장중 집계 자료로, 장마감(15:30) 이후 최종 수치와 다를 수 있습니다. 전 종목 대상 자금 유입·유출 상위 5개입니다.
        </p>
        ${flowGroup('외국인', '🌍', '#38bdf8', '#0c1a24', investorFlow.foreignInflow, investorFlow.foreignOutflow)}
        ${flowGroup('기관', '🏛', '#fbbf24', '#241c0c', investorFlow.institutionInflow, investorFlow.institutionOutflow)}
        <p style="margin:16px 0 0;color:#475569;font-size:11px;font-style:italic;border-top:1px solid #1e293b;padding-top:12px">
          ${INVESTMENT_DISCLAIMER}
        </p>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finance Park 일일 리포트</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#060810">
    <tr>
      <td align="center">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px 48px;text-align:left">

    <!-- 헤더 -->
    <div style="text-align:center;padding:32px 0 24px">
      <div style="font-size:22px;font-weight:800;color:#818cf8;letter-spacing:-.02em">Finance Park</div>
      <p style="margin:8px 0 0;color:#64748b;font-size:12px">${dateStr} 관심종목 일일 리포트</p>
    </div>

    <!-- 인사말 -->
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:12px;padding:16px 20px;margin-bottom:20px">
      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.7">
        안녕하세요, <strong style="color:#e2e8f0">${userName}</strong>님.<br>
        오늘 관심종목 <strong style="color:#e2e8f0">${stocks.length}개</strong>의 종가 현황을 전달해 드립니다.
      </p>
    </div>

    <!-- 관심종목 현황 -->
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:12px;padding:20px 24px">
      <h2 style="margin:0 0 16px;color:#e2e8f0;font-size:14px;font-weight:700;letter-spacing:.05em">📈 관심종목 등락 현황</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid #334155">
            <th style="padding:6px 8px;color:#64748b;font-size:11px;font-weight:600;text-align:left;letter-spacing:.05em">종목</th>
            <th style="padding:6px 8px;color:#64748b;font-size:11px;font-weight:600;text-align:right;letter-spacing:.05em">현재가</th>
            <th style="padding:6px 8px;color:#64748b;font-size:11px;font-weight:600;text-align:right;letter-spacing:.05em">등락률</th>
            <th style="padding:6px 8px;color:#64748b;font-size:11px;font-weight:600;text-align:right;letter-spacing:.05em">등락금액</th>
          </tr>
        </thead>
        <tbody>${sorted.map(row).join('')}</tbody>
      </table>

      <!-- 요약 통계 -->
      <div style="display:flex;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid #1e2537">
        <div style="flex:1;text-align:center;padding:8px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px">
          <div style="color:#ef4444;font-size:18px;font-weight:700">${upStocks.length}</div>
          <div style="color:#64748b;font-size:10px;margin-top:2px">상승</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px;background:rgba(100,116,139,.08);border:1px solid rgba(100,116,139,.2);border-radius:8px">
          <div style="color:#94a3b8;font-size:18px;font-weight:700">${flatStocks.length}</div>
          <div style="color:#64748b;font-size:10px;margin-top:2px">보합</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:8px">
          <div style="color:#3b82f6;font-size:18px;font-weight:700">${downStocks.length}</div>
          <div style="color:#64748b;font-size:10px;margin-top:2px">하락</div>
        </div>
      </div>
    </div>

    ${flowSection}
    ${aiSection}
    ${otherStocksSection}
    ${notifSection}

    <!-- CTA 버튼 -->
    <div style="text-align:center;margin-top:28px">
      <a href="https://fpark.com" style="display:inline-block;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:13.5px;font-weight:600">
        fpark.com에서 자세히 보기 →
      </a>
    </div>

    <!-- 푸터 -->
    <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #1e2537">
      <p style="color:#334155;font-size:11px;margin:0 0 8px">Finance Park · Pro 구독자 전용 일일 리포트</p>
      <a href="https://fpark.com/api/email/unsubscribe?token=${makeUnsubToken(userId)}&type=evening" style="color:#475569;font-size:11px;text-decoration:underline">
        이메일 수신 거부
      </a>
    </div>

  </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function getKstInfo(): { dateStr: string; notifDate: string; mm: number; dd: number } {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const mm = kst.getMonth() + 1;
  const dd = kst.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dateStr:   `${kst.getFullYear()}년 ${mm}월 ${dd}일`,
    notifDate: `${kst.getFullYear()}-${pad(mm)}-${pad(dd)}`,
    mm,
    dd,
  };
}
