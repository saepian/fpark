import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { fetchNaverNews } from './naver-news';
import type { Database } from './database.types';

// 2026-07-23: 종목명 단독 검색(display=5)이 "네이버"/"카카오"처럼 일상어·그룹명과
// 겹치는 종목에서 수백만 건의 무관한 최신 기사에 실제 회사 뉴스가 완전히 파묻히는
// 문제를 실측 확인(예: "네이버" 검색 total 530만건, top100에도 실제 관련기사 없음
// vs 종목코드 검색 total 5.4만건, top5에 바로 등장). 종목명+종목코드 병행 검색으로
// 후보군을 넓힌 뒤, 저렴한 모델(Haiku)로 1차 관련성 선별을 거쳐 노이즈를 제거한다.
// pickRelevantNews(제목에 종목명 포함 시 가산점)는 이 노이즈에 대해 무력하다 —
// 노이즈 후보도 검색어 자체가 종목명이라 전부 제목에 종목명을 포함하기 때문.

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

const SELECTION_SYSTEM_PROMPT = `당신은 뉴스 제목 목록에서 특정 종목과 직접 관련된 "서로 다른 사건"만 골라내는 필터입니다.
아래 번호가 매겨진 뉴스 제목 목록에서, 주어진 종목(회사)과 직접 관련된 기사 중 서로 다른 사건/주제를 대표하는 것만 최대 5개까지 골라 JSON 배열로 반환하세요.
- 같은 사건이 여러 매체에 재배포되어 제목만 다르게 여러 건 있으면, 그 중 1건만 선택
- 종목명이 단순히 다른 맥락(예: 서비스명, 지명, 인명, 동음이의어)으로 언급된 기사는 제외
- 그 회사의 실적, 사업, 제품, 계약, 경영, 주가, 공시 등 직접 관련 기사만 포함
- 관련 기사가 없으면 빈 배열 []
- 반드시 JSON 배열만 출력, 다른 텍스트 없이. 예) [3,7,12]`;

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

  let selected: NewsCandidate[];
  try {
    const titleList = candidates.map((c, i) => `${i}: ${c.title}`).join('\n');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SELECTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `종목명: ${stockName}\n\n뉴스 제목 목록:\n${titleList}` }],
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
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .map((i) => candidates[i]);
    if (selected.length === 0 && indices.length > 0) {
      // 인덱스는 파싱됐지만 전부 범위 밖 — 폴백이 더 안전
      throw new Error('유효 인덱스 없음');
    }
  } catch (e) {
    console.warn(`[NEWS-SELECTION] ${ticker} Haiku 선별 실패, 최신순 top3 폴백:`, e instanceof Error ? e.message : e);
    selected = fallback();
  }

  selected = selected.slice(0, NEWS_SELECTION_MAX);
  await saveToCache(ticker, selected);
  return { items: selected, isCached: false, apiError: false };
}
