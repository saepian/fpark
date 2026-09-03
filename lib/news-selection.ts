import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { fetchNaverNews } from './naver-news';
import { kstDateStr } from './ai-grounding';
import type { Database } from './database.types';

// 2026-07-23: 종목명 단독 검색(display=5)이 "네이버"/"카카오"처럼 일상어·그룹명과
// 겹치는 종목에서 수백만 건의 무관한 최신 기사에 실제 회사 뉴스가 완전히 파묻히는
// 문제를 실측 확인(예: "네이버" 검색 total 530만건, top100에도 실제 관련기사 없음
// vs 종목코드 검색 total 5.4만건, top5에 바로 등장). 종목명+종목코드 병행 검색으로
// 후보군을 넓힌 뒤, 저렴한 모델(Haiku)로 1차 관련성 선별을 거쳐 노이즈를 제거한다.
// pickRelevantNews(제목에 종목명 포함 시 가산점)는 이 노이즈에 대해 무력하다 —
// 노이즈 후보도 검색어 자체가 종목명이라 전부 제목에 종목명을 포함하기 때문.
//
// 2026-07-31: 급등/급락일에는 후보가 수백 건까지 몰리는데, 이때 "美 반도체주
// 급반등…필라델피아지수 8.19% 상승"처럼 오늘 주가 변동의 실제 원인인 시황성
// 기사가 후보 풀엔 이미 들어있음에도(검색 자체는 문제 없음) 목표주가 상향·신제품
// 같은 개별 기업 뉴스에 5개 슬롯을 다 뺏겨 탈락하는 걸 실측 확인(삼성전자 급등일
// 재현). SELECTION_SYSTEM_PROMPT에 "이 종목과 함께 보도되는 업종·시장 이슈는
// 우선순위를 둘 것" 지시를 추가해 대응 — 검색/후보 수집 로직은 그대로.
//
// 2026-08-24 재조사(삼성전자 8/24 -8.70% 급락 리포트가 "110조 주주환원 실망"이라는
// 표면적 사실만 나열하고 실제 원인 — 30조 현금배당+15조 임직원용 자사주로 구성된 점,
// SK하이닉스 40조 전량소각과의 대비 등 — 을 못 짚어낸 문제)에서, 위 2026-07-31 대응이
// 충분치 않았음을 실측으로 확인: 규칙 1이 "업종·시장 전체 이슈"에만 최우선순위를 걸어서
// 원인이 매크로가 아니라 종목 자체의 결정(이번 사례처럼 자사주 정책 구성)일 때는 최우선
// 규칙이 발동하지 않고, 규칙 2("사건 다양성")가 지배해 원인 설명 기사가 무관한 PR성
// 기사(신제품·수상 등)에 밀려 탈락했다 — 후보 풀에 원인 설명 기사가 10건 이상 있었는데
// 최종 5건 중 0건 선택됨(같은 날 SK하이닉스는 규칙 2 지배에도 원인 기사가 우연히
// 살아남아 대비군 역할). 규칙 1을 "매크로든 종목 자체 이슈든 오늘 가격변동의 실제
// 원인"으로 일반화하고 최우선으로 재명시했고(규칙 2·3은 후순위로 재배치), 선별 입력에
// title뿐 아니라 description(스니펫)도 포함시켰다. 또한 이 판단을 LLM에만 맡기지 않고
// heuristicPriceRelevanceScore()로 오늘 등락률 숫자·가격반응 키워드·발행일 신선도를
// 규칙 기반으로 미리 스코어링해 후보 정렬 순서와 ★ 마킹으로 힌트를 준다 — LLM 판단의
// 대체가 아니라 보완재(★ 없어도 선택 가능하다고 프롬프트에 명시, 새로운 표현의 헤드라인을
// 놓치지 않기 위함).

const NEWS_SELECTION_TTL_MS = 20 * 60 * 1000; // 뉴스는 DART와 달리 실시간성이 중요해 짧게
const NEWS_SELECTION_MAX = 5; // Haiku가 지시보다 더 반환해도 여기서 하드캡

let _sb: ReturnType<typeof createClient<Database>> | null = null;
function getSb() {
  if (!_sb) _sb = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return _sb;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface NewsCandidate {
  title: string;
  summary?: string;
  date?: string;
  url?: string;
  source?: string; // 표시용 출처(예: '네이버뉴스', DB 기사 원 출처명) — 호출자가 필요할 때만 사용
}

const SELECTION_SYSTEM_PROMPT = `당신은 뉴스 목록에서 특정 종목과 직접 관련된 기사 중, 오늘 이 종목의 가격 변동을 설명하는 데 가장 도움이 되는 기사를 골라내는 필터입니다.
아래 번호가 매겨진 뉴스 목록(제목 — 스니펫)에서, 주어진 종목(회사)과 직접 관련된 기사 중 최대 5개까지 골라 JSON 배열로 반환하세요.

선택 순서(우선순위 — 아래 순서를 반드시 지킬 것):
1. [최우선] 오늘 이 종목이 큰 폭으로 움직였다면(사용자 메시지의 "오늘 등락률" 참고), 그 원인을 설명하는 기사를 최소 1건은 반드시 선택하세요. 원인이 미국 증시·업종 지수·환율 같은 매크로든, 이 회사 자체의 결정(자사주 정책, 실적 발표, 계약 파기, 소송 등)이든 상관없이 "오늘 가격 변동을 가장 잘 설명하는 기사"가 항상 최우선입니다. 신제품·수상·목표주가 상향 같은 다른 사건으로 다양성을 채우려고 이 기사를 빼면 안 됩니다 — 원인을 설명하는 기사를 후보에서 봤는데도 고르지 않는 것은 오답입니다. 목록에 ★ 표시가 있으면 사전 스코어링에서 오늘 가격변동과 관련성이 높다고 판단된 후보이니 우선 검토하세요(단, ★가 없어도 내용상 원인 설명력이 있으면 선택하세요 — ★는 참고용 힌트일 뿐 절대 기준이 아닙니다).
2. 같은 사건(예: 같은 정책 발표)을 다루는 기사가 여러 건이면 그 중 1건만 남기되, "발표 시점" 기사보다 "오늘 가격 반응까지 반영한" 기사(마감시황·특징주 등 사후 반응 기사)를 우선하고, 그래도 동률이면 더 최신 기사를 선택하세요 — 오래되고 논조가 밋밋한 기사를 대표로 남기지 마세요.
3. 남은 슬롯은 그 회사의 실적, 사업, 제품, 계약, 경영, 주가, 공시 등 직접 관련 기사로 채우되 서로 다른 사건을 대표하도록 다양성을 고려하세요 — 단, 이 다양성 기준은 1·2번보다 낮은 우선순위이며, 원인 설명력이 있는 기사를 다양성 때문에 빼는 것은 항상 오답입니다.

그 외 규칙:
- 종목명이 단순히 다른 맥락(예: 서비스명, 지명, 인명, 동음이의어)으로 언급된 기사는 제외
- 이 종목이 언급되지 않고 시장 전체만 다루는 기사(이 종목과 무관한 순수 시황 기사)까지 무리하게 끼워넣지는 마세요
- 관련 기사가 없으면 빈 배열 []
- 반드시 JSON 배열만 출력, 다른 텍스트 없이. 예) [3,7,12]`;

// ── 대안4: 결정론적 사전필터(대안1의 보완재, 단독 사용 금지) ────────────────────
// LLM 판단만으로는 200건 안팎 후보 목록에서 원인 기사가 어딘가에 묻혀 다양성 규칙에
// 밀릴 위험이 남는다 — 오늘 등락률 숫자·가격반응 키워드·발행일 신선도를 규칙 기반으로
// 미리 스코어링해 후보 정렬 순서와 ★ 마킹으로 힌트를 준다. ★가 없어도 선택 가능하다고
// SELECTION_SYSTEM_PROMPT에 명시했으므로, 아래 키워드 목록에 없는 새로운 표현의
// 헤드라인(예: "삼전 내리고, 하닉 오른 이유")도 LLM이 여전히 선택할 수 있다.
const PRICE_REACTION_KEYWORDS = [
  '마감시황', '개장시황', '장중시황', '특징주', '시황',
  '급등', '급락', '급증', '급감', '폭등', '폭락', '반등', '반락',
  '실망', '우려', '부담', '호재', '악재',
];

// changeRate=-8.70 → ["8.7","8.7%","8.70","8.70%","9","9%"] 같은 표기 변형 집합.
// 언론사마다 소수점 자리수·반올림이 제각각이라(예: "8.7%", "8.70%", "9% 급락") 여러
// 형태를 모두 매칭 대상으로 둔다.
function priceMoveTextVariants(changeRate: number): string[] {
  const abs = Math.abs(changeRate);
  if (abs === 0) return [];
  const forms = new Set<string>([abs.toFixed(1), abs.toFixed(2), String(Math.round(abs))]);
  const variants = new Set<string>();
  forms.forEach((f) => { variants.add(f); variants.add(`${f}%`); });
  return [...variants];
}

function isPublishedToday(dateStr: string | undefined): boolean {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return false;
  return kstDateStr(new Date(t)) === kstDateStr();
}

// 점수 기준: 오늘 등락률 숫자 직접 매칭(가장 강한 신호, +3) > 가격반응 키워드(+2) >
// 오늘 발행(+1). 상한 없이 합산 — 신호가 겹칠수록 더 확실한 후보이므로.
// 2026-08-24: lib/stock-analysis-data.ts의 buildNewsBlock()이 선별된 5건 중 상위 3건만
// 실제 생성 프롬프트에 넣으면서(과거부터 있던 별개의 캡), 선별에는 성공했지만 다시
// 절삭 단계에서 원인기사가 밀려나는 사례를 실측 확인(SK하이닉스 8/24 사례 — "40조
// 전량소각" 비교기사가 선별은 됐으나 날짜상 가장 오래된 항목이라 절삭에서 탈락). 절삭
// 기준을 "최신 3건 고정"에서 "이 점수 기준 상위 3건"으로 바꾸기 위해 export한다.
export function heuristicPriceRelevanceScore(candidate: NewsCandidate, todayChangeRate?: number): number {
  const text = `${candidate.title} ${candidate.summary ?? ''}`;
  let score = 0;
  if (typeof todayChangeRate === 'number') {
    if (priceMoveTextVariants(todayChangeRate).some((v) => text.includes(v))) score += 3;
  }
  if (PRICE_REACTION_KEYWORDS.some((k) => text.includes(k))) score += 2;
  if (isPublishedToday(candidate.date)) score += 1;
  return score;
}

const HEURISTIC_MARK_THRESHOLD = 2;

// 2026-09-03 조사(9/2 기업분석 검토, 셀트리온 사례 — "코스피 강보합 마감" 같은 시장 전체
// 기사가 참고기사에 섞여 들어옴): 실측(market_cache의 news_selection_* 캐시 154개 종목,
// 709건 전수 조사) 결과 종목명이 본문에 전혀 언급되지 않는 참고기사가 다수 확인됨 —
// 예) 현대차(005380) 리포트에 "스노우플레이크 실적 상향" 기사(무관 타종목), S-Oil(010950)
// 리포트에 반도체(삼성전자·SK하이닉스) 시황 기사(무관 타업종), 오리온홀딩스(001800)
// 리포트에 "항공·여행·식음료 업종 수혜" 순수 업종 나열 기사. 원인은 SELECTION_SYSTEM_PROMPT
// 규칙 1이 "오늘 가격변동을 설명하는 기사는 매크로든 뭐든 최소 1건 반드시 선택"을 지시하면서도,
// 그 매크로 기사가 "실제로 이 종목과 인과관계가 있는지"를 강제하는 장치가 없었기 때문 —
// LLM 판단(대안1)에만 의존하고 결정론적 하한선(대안4, heuristicPriceRelevanceScore)은
// 정렬·마킹에만 쓰이고 최종 채택 여부에는 전혀 관여하지 않았다.
// 처음엔 heuristicPriceRelevanceScore(★ 마킹 기준)를 그대로 예외 조건으로 재사용하려
// 했으나, PRICE_REACTION_KEYWORDS(급등/급락/반등/시황 등)는 시장 전체 마감시황 기사 자체가
// "오늘 코스피가 몇 % 급락했다"를 보도하는 게 본업이라 거의 모든 시황 기사가 이 키워드를
// 포함해 통과선을 넘어버리는 허점을 실측 중 발견(예: "코스피 4% 급락…6600선으로 후퇴"도
// "급락" 키워드만으로 통과) — 원래 이 스코어는 정렬용 힌트일 뿐 채택 여부를 가르는 하한선으로
// 설계되지 않았기 때문. 그래서 예외 조건을 "이 종목의 오늘 실제 등락률 숫자가 본문에 직접
// 언급되는가"(priceMoveTextVariants)로 좁혔다 — 시장 전체 지수 등락률이 아니라 이 종목
// 자신의 등락률이 본문에 있어야만 하므로, 무관한 시황 기사가 우연히 통과할 여지가 훨씬
// 적다(07/31 전례처럼 실제로 이 종목의 등락과 함께 보도된 매크로 기사는 대개 그 종목의
// 등락률도 같이 언급하므로 여전히 살아남는다). 개수가 줄어들더라도(빈 배열 포함) 무관한
// 기사로 억지로 채우지 않는 쪽을 택했다 — 사용자 결정.
// 대소문자만 다른 표기(예: 실측 확인된 "kt 밀리의서재" vs 종목명 "KT밀리의서재")로 인한
// 오탐(불필요하게 걸러지는 것)을 줄이기 위해 대소문자 무시 비교.
function mentionsStock(candidate: NewsCandidate, ticker: string, stockName: string): boolean {
  const text = `${candidate.title} ${candidate.summary ?? ''}`.toLowerCase();
  return text.includes(stockName.toLowerCase()) || text.includes(ticker);
}

function explainsOwnPriceMove(candidate: NewsCandidate, todayChangeRate?: number): boolean {
  if (typeof todayChangeRate !== 'number') return false;
  const text = `${candidate.title} ${candidate.summary ?? ''}`;
  return priceMoveTextVariants(todayChangeRate).some((v) => text.includes(v));
}

export function filterUnrelated(
  items: NewsCandidate[],
  ticker: string,
  stockName: string,
  todayChangeRate?: number,
): NewsCandidate[] {
  return items.filter((c) => mentionsStock(c, ticker, stockName) || explainsOwnPriceMove(c, todayChangeRate));
}

function cacheKeyFor(ticker: string): string {
  return `news_selection_${ticker}`;
}

async function loadFromCache(ticker: string): Promise<NewsCandidate[] | null> {
  try {
    const { data } = await getSb()
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKeyFor(ticker))
      .single();
    if (data?.data && Date.now() - new Date(data.updated_at as string).getTime() < NEWS_SELECTION_TTL_MS) {
      return data.data as unknown as NewsCandidate[];
    }
  } catch (e) {
    console.warn('[NEWS-SELECTION] 캐시 조회 실패, 새로 계산:', e instanceof Error ? e.message : e);
  }
  return null;
}

async function saveToCache(ticker: string, items: NewsCandidate[]): Promise<void> {
  try {
    await getSb().from('market_cache').upsert({
      key: cacheKeyFor(ticker),
      data: items as unknown as Database['public']['Tables']['market_cache']['Row']['data'],
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[NEWS-SELECTION] 캐시 저장 실패(계속 진행):', e instanceof Error ? e.message : e);
  }
}

// 종목명+종목코드 병행 검색(display=100) → 제목 중복제거 → Haiku 1차 관련성 선별.
// extraCandidates: DB 캐시(articles) 등 호출자가 이미 갖고 있는 후보를 함께 판단시키고
// 싶을 때 전달 — Promise로 받아서 캐시 히트 시엔 기다리지 않고, 캐시 미스일 때만
// Naver 조회와 병렬로 resolve되게 한다(호출자가 미리 시작해둔 DB 쿼리를 그대로 활용).
// 2026-07-24: apiError 필드 추가 — 이름/코드 검색이 둘 다 레이트리밋(429) 등으로
// 실패하면(bothFailed) items가 빈 배열로 나오는데, 기존엔 이걸 "검색해서 실제로 뉴스가
// 없음"과 구분할 방법이 없었다(bothFailed는 캐싱 여부 판단에만 쓰이고 반환되지 않았음).
// 호출부(daily-alert-email의 fetchNewsMapForStocks)가 "확인된 없음"과 "확인 자체를
// 못함"을 구분해 다른 문구를 보여줄 수 있도록 명시적으로 반환한다. 기존 호출부 5곳은
// 전부 { items } 구조분해만 하므로 필드 추가는 하위호환.
export async function selectRelevantNews(
  ticker: string,
  stockName: string,
  extraCandidates: Promise<NewsCandidate[]> | NewsCandidate[] = [],
  todayChangeRate?: number,
): Promise<{ items: NewsCandidate[]; isCached: boolean; apiError: boolean }> {
  const cached = await loadFromCache(ticker);
  if (cached) {
    console.log(`[NEWS-SELECTION] ${ticker} 캐시 히트 (${cached.length}건)`);
    return { items: cached, isCached: true, apiError: false };
  }

  const [byName, byCode, extra] = await Promise.all([
    fetchNaverNews(stockName, { display: 100, sort: 'date' }),
    fetchNaverNews(ticker, { display: 100, sort: 'date' }),
    Promise.resolve(extraCandidates),
  ]);

  const naverByNameCandidates: NewsCandidate[] = byName.items.map((n) => ({
    title: n.title, summary: n.description, date: n.pubDate, url: n.url, source: '네이버뉴스',
  }));
  const naverByCodeCandidates: NewsCandidate[] = byCode.items.map((n) => ({
    title: n.title, summary: n.description, date: n.pubDate, url: n.url, source: '네이버뉴스',
  }));

  const seen = new Set<string>();
  const candidates = [...extra, ...naverByNameCandidates, ...naverByCodeCandidates].filter((c) => {
    if (seen.has(c.title)) return false;
    seen.add(c.title);
    return true;
  });

  console.log(`[NEWS-SELECTION] ${ticker} 후보 ${candidates.length}건 (name apiError:${byName.apiError}, code apiError:${byCode.apiError})`);

  // 둘 다 실패(일시적 네트워크/레이트리밋 문제일 가능성) — 이 상태를 20분간 캐시하면
  // 그 사이 들어오는 모든 요청이 "뉴스 없음"을 강제로 떠안게 되므로 캐시하지 않는다.
  const bothFailed = byName.apiError && byCode.apiError;

  if (candidates.length === 0) {
    if (!bothFailed) await saveToCache(ticker, []);
    return { items: [], isCached: false, apiError: bothFailed };
  }

  const fallback = (): NewsCandidate[] => naverByNameCandidates.slice(0, 3);

  // 대안4 사전필터 — Haiku 호출 전에 규칙기반 점수로 정렬(안정 정렬, 동점은 원래
  // 순서 유지) + 상위 후보 ★ 마킹. scored의 순서가 곧 Haiku에 보여줄 번호(i)가 된다.
  const scored = candidates
    .map((c) => ({ c, score: heuristicPriceRelevanceScore(c, todayChangeRate) }))
    .sort((a, b) => b.score - a.score);

  const changeRateLine = typeof todayChangeRate === 'number'
    ? `오늘 등락률: ${todayChangeRate >= 0 ? '+' : ''}${todayChangeRate.toFixed(2)}%${Math.abs(todayChangeRate) >= 5 ? ' (오늘 큰 폭으로 움직임 — 규칙 1 최우선 적용)' : ''}`
    : '오늘 등락률: 정보 없음';

  let selected: NewsCandidate[];
  try {
    // title뿐 아니라 description(스니펫)도 함께 전달 — 기존엔 제목만 보고 판단해
    // 원인 관련 구체적 디테일(예: "정규배당 30조+임직원 보상용 자사주 15조")이
    // 스니펫에만 있어도 선별 단계에서 활용할 방법이 없었다.
    const titleList = scored.map(({ c, score }, i) => {
      const mark = score >= HEURISTIC_MARK_THRESHOLD ? '★ ' : '';
      const snippet = c.summary ? ` — ${c.summary}` : '';
      return `${i}: ${mark}${c.title}${snippet}`;
    }).join('\n');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      // 2026-08-24 검증 중 실측: 에코프로(086520)에서 Haiku가 "분석 과정"을 프리앰블로
      // 먼저 쓰다가 300 토큰에서 잘려 JSON을 못 낸 사례 발생(4회 중 1회, 폴백으로 안전하게
      // 처리됨). 시스템 프롬프트가 "JSON만 출력"을 명시해도 드물게 프리앰블을 쓰는 걸
      // 막지 못하므로, 정상 응답(보통 10~20토큰)엔 영향 없이 여유를 두어 잘림을 완화한다.
      max_tokens: 500,
      system: SELECTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `종목명: ${stockName}\n${changeRateLine}\n\n뉴스 목록:\n${titleList}` }],
    }, { timeout: 15_000, maxRetries: 0 });

    console.log('[TOKEN_USAGE]', {
      route: 'news-selection', ticker,
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    });

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON 배열 없음: ' + text.slice(0, 100));
    const indices: unknown = JSON.parse(match[0]);
    if (!Array.isArray(indices) || !indices.every((i) => typeof i === 'number')) {
      throw new Error('배열 형식 아님');
    }
    selected = indices
      .filter((i) => Number.isInteger(i) && i >= 0 && i < scored.length)
      .map((i) => scored[i].c);
    if (selected.length === 0 && indices.length > 0) {
      // 인덱스는 파싱됐지만 전부 범위 밖 — 폴백이 더 안전
      throw new Error('유효 인덱스 없음');
    }
  } catch (e) {
    console.warn(`[NEWS-SELECTION] ${ticker} Haiku 선별 실패, 최신순 top3 폴백:`, e instanceof Error ? e.message : e);
    selected = fallback();
  }

  const beforeFilterCount = selected.length;
  selected = filterUnrelated(selected, ticker, stockName, todayChangeRate);
  if (selected.length < beforeFilterCount) {
    console.log(`[NEWS-SELECTION] ${ticker} 종목명 미언급+무관 기사 ${beforeFilterCount - selected.length}건 제외 (${beforeFilterCount} → ${selected.length})`);
  }

  // 2026-07-31: 선별("이 5건을 고를지")과 표시 순서("고른 걸 어떤 순서로 보여줄지")는
  // 별개 문제인데, 후자를 정하는 로직이 아예 없어서 Haiku가 반환한 인덱스 순서(선택
  // 우선순위 판단 과정의 부산물일 뿐 시간순이 아님)가 그대로 화면 표시 순서가 되고
  // 있었다 — 관련 뉴스 위젯에서 "18분 전 → 5시간 전 → 25분 전"처럼 뒤섞여 보이는
  // 버그로 실측 확인. 최신순으로 재정렬한다.
  // date가 없거나 파싱 불가(NaN)면 가장 오래된 것으로 취급해 맨 뒤로 보낸다 — 호출부
  // 4곳 중 3곳(app/api/stock/[ticker]/analysis, lib/stock-analysis-data.ts 경유 기업분석/
  // 포트폴리오진단)이 date를 toLocaleDateString('ko-KR')("2026. 7. 31." 형식)으로 넘겨
  // 시각 정보 없이 자정으로 뭉개지는데, 이 값 자체는 Node(V8)가 관대하게 파싱해 NaN은
  // 안 나지만 다른 포맷이 섞이거나 완전히 깨진 문자열이 들어와도 정렬이 깨지지 않도록
  // NaN까지 명시적으로 방어한다(Array.sort는 비교 함수가 NaN을 반환하면 동작이
  // 명세상 정의돼 있지 않음).
  const dateValue = (d?: string): number => {
    if (!d) return -Infinity;
    const t = new Date(d).getTime();
    return isNaN(t) ? -Infinity : t;
  };
  selected = selected
    .slice(0, NEWS_SELECTION_MAX)
    .sort((a, b) => dateValue(b.date) - dateValue(a.date));
  await saveToCache(ticker, selected);
  return { items: selected, isCached: false, apiError: false };
}
