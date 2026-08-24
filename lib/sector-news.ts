import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { fetchNaverNews } from './naver-news';
import type { NewsCandidate } from './news-selection';
import type { Database } from './database.types';

// 2026-07-31: selectRelevantNews(종목명+종목코드 검색)는 "종목명이 실제로 언급된" 기사만
// 후보 풀에 걸린다 — "필라델피아 반도체지수 8% 상승"처럼 특정 종목명이 전혀 등장하지 않는
// 순수 업종 뉴스는 애초에 검색 후보에 안 들어온다(SELECTION_SYSTEM_PROMPT 우선순위 지시를
// 아무리 고쳐도 후보에 없으면 선별할 수 없음). 이 모듈은 그 사각지대를 메우는 별도 경로 —
// KIS가 이미 내려주는 업종명(bstp_kor_isnm, StockPrice.sector)을 키로 업종 단위 매크로
// 뉴스를 조회한다. daily-email.ts의 fetchLiveMacroNews/selectMacroNews(코스피/코스닥
// 전체 대상)와 같은 "여러 키워드 검색 → Haiku 선별" 패턴이지만, 업종별 키워드가 필요해
// 별도 모듈로 둔다(daily-email.ts는 이미 배포된 크론 이메일 기능이라 회귀 리스크를 안
// 만들기 위해 손대지 않음).

const SECTOR_MACRO_TTL_MS = 60 * 60 * 1000; // 종목별 뉴스(20분)보다 재사용률이 높아 더 길게
const SECTOR_MACRO_MAX = 3;

let _sb: ReturnType<typeof createClient<Database>> | null = null;
function getSb() {
  if (!_sb) _sb = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return _sb;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// 업종명(KIS bstp_kor_isnm 기준) → 매크로 검색 키워드. 여기 없는 업종은 업종명 그대로
// 검색어로 쓴다(keywordsForSector 폴백) — 완벽한 커버리지보다 "검색 자체가 안 되는 것"을
// 피하는 게 목적.
//
// 2026-07-31 대표 종목 실측(fetchStockPrice)으로 확인: KIS bstp_kor_isnm은 "반도체"/
// "2차전지"/"자동차"/"조선"/"방산" 같은 세분류가 아니라 KRX 대분류(~20개) 수준이라 여러
// 업종이 한 라벨에 뭉친다 — 삼성전자·SK하이닉스·LG에너지솔루션·에코프로비엠이 전부
// "전기·전자"로, 현대차·기아·한화오션·삼성중공업·한화에어로스페이스가 전부
// "운송장비·부품"으로 나온다(자동차/조선/방산을 이 필드만으로 구분 불가능 — 그래서
// 아래 키워드도 세 업종을 다 포함하는 넓은 세트로 구성). 삼성바이오로직스·셀트리온은
// "제약"으로 깔끔하게 분리됨. 주의: 에코프로(지주사)·HD한국조선해양(지주사)처럼 지주회사
// 티커는 실제 사업과 무관하게 "금융"으로 나오는 경우가 있음(KB금융·신한지주 같은 진짜
// 은행과 구분 안 됨) — "금융" 폴백엔 은행/지주사 어느 쪽에도 크게 틀리지 않을 범용
// 매크로 키워드만 둠.
// 2026-08-24: 삼성전자 8/24 -8.70% 급락 재조사에서, "110조 주주환원도 시장 기대엔
// 못미쳐…삼성전자 주가 급락"(동아일보) 기사가 이 업종매크로 채널에 우연히 걸린 걸
// 확인했다 — 검색어에 필라델피아 반도체지수가 포함돼 있어서일 뿐, 자본배분(배당/자사주
// 소각) 자체를 겨냥한 키워드는 없었다. 종목 무관하게 자본배분 이슈가 업종 전체(특히
// 반도체 투톱처럼 같은 시기에 나란히 환원책을 내놓는 경우) 시황에 영향을 주는 경우가
// 실측 확인됐으므로 저비용 보강으로 키워드를 추가한다.
const SECTOR_KEYWORDS: Record<string, string[]> = {
  '전기·전자':     ['필라델피아 반도체지수', '나스닥 반도체', '리튬 가격', '전기차 수요', '주주환원', '자사주 소각'],
  '화학':          ['리튬 가격', '국제유가', '2차전지 소재'],
  '운송장비·부품': ['미국 자동차 관세', 'GM 실적', '포드 실적', '조선업 수주', '미국 방산주'],
  '제약':          ['FDA 승인', '임상 결과'],
  '금융':          ['미국 금리', '연준', '원달러 환율'],
};

function keywordsForSector(sectorName: string): string[] {
  const trimmed = sectorName.trim();
  if (SECTOR_KEYWORDS[trimmed]) return SECTOR_KEYWORDS[trimmed];
  const partial = Object.keys(SECTOR_KEYWORDS).find((k) => trimmed.includes(k));
  if (partial) return SECTOR_KEYWORDS[partial];
  return [trimmed];
}

function cacheKeyFor(sectorName: string): string {
  return `sector_macro_news_${sectorName.trim()}`;
}

async function loadFromCache(sectorName: string): Promise<NewsCandidate[] | null> {
  try {
    const { data } = await getSb()
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKeyFor(sectorName))
      .single();
    if (data?.data && Date.now() - new Date(data.updated_at as string).getTime() < SECTOR_MACRO_TTL_MS) {
      return data.data as unknown as NewsCandidate[];
    }
  } catch (e) {
    console.warn('[SECTOR-NEWS] 캐시 조회 실패, 새로 계산:', e instanceof Error ? e.message : e);
  }
  return null;
}

async function saveToCache(sectorName: string, items: NewsCandidate[]): Promise<void> {
  try {
    await getSb().from('market_cache').upsert({
      key: cacheKeyFor(sectorName),
      data: items as unknown as Database['public']['Tables']['market_cache']['Row']['data'],
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[SECTOR-NEWS] 캐시 저장 실패(계속 진행):', e instanceof Error ? e.message : e);
  }
}

const SECTOR_SELECTION_SYSTEM_PROMPT = `당신은 뉴스 제목 목록에서 특정 업종 전체에 영향을 줄 만한 거시/업황 뉴스를 골라내는 필터입니다.
아래 번호가 매겨진 뉴스 제목 목록에서, 주어진 업종 전반의 오늘 흐름에 실제로 영향을 줄 만한 사건(관련 해외 지수·환율·원자재 가격·글로벌 경쟁사 실적 등) 중 서로 다른 사건을 대표하는 것만 최대 3개까지 골라 JSON 배열로 반환하세요.
- 같은 사건이 여러 매체에 재배포되어 제목만 다르게 여러 건 있으면, 그 중 1건만 선택(최신순 우선)
- 이 업종과 무관한 개별 기업(다른 업종) 뉴스나 일반 사회/정치/연예 뉴스는 제외
- 관련 뉴스가 없으면 빈 배열 []
- 반드시 JSON 배열만 출력, 다른 텍스트 없이. 예) [0,2]`;

async function selectSectorMacro(sectorName: string, candidates: NewsCandidate[]): Promise<NewsCandidate[]> {
  if (candidates.length === 0) return [];
  try {
    const titleList = candidates.map((c, i) => `${i}: ${c.title}`).join('\n');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SECTOR_SELECTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `업종명: ${sectorName}\n\n뉴스 제목 목록:\n${titleList}` }],
    }, { timeout: 15_000, maxRetries: 0 });

    console.log('[TOKEN_USAGE]', {
      route: 'sector-news', sector: sectorName,
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
    return indices
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .slice(0, SECTOR_MACRO_MAX)
      .map((i) => candidates[i]);
  } catch (e) {
    console.warn(`[SECTOR-NEWS] ${sectorName} 선별 실패, 최신순 top3 폴백:`, e instanceof Error ? e.message : e);
    return candidates.slice(0, SECTOR_MACRO_MAX);
  }
}

// 업종 단위 매크로 뉴스 조회 — sectorName은 StockPrice.sector(KIS bstp_kor_isnm)를 그대로 전달.
export async function selectSectorMacroNews(
  sectorName: string,
): Promise<{ items: NewsCandidate[]; isCached: boolean }> {
  if (!sectorName || sectorName.trim().length < 2) {
    return { items: [], isCached: false };
  }

  const cached = await loadFromCache(sectorName);
  if (cached) {
    console.log(`[SECTOR-NEWS] ${sectorName} 캐시 히트 (${cached.length}건)`);
    return { items: cached, isCached: true };
  }

  const keywords = keywordsForSector(sectorName);
  const settled = await Promise.allSettled(
    keywords.map((kw) => fetchNaverNews(kw, { display: 5, sort: 'date' })),
  );

  const seen = new Set<string>();
  const candidates: NewsCandidate[] = [];
  let anyOk = false;
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      console.warn(`[SECTOR-NEWS] ${sectorName} 검색 실패 (${keywords[i]}):`, r.reason);
      return;
    }
    if (r.value.apiError) {
      console.warn(`[SECTOR-NEWS] ${sectorName} 검색 API 오류 (${keywords[i]})`);
      return;
    }
    anyOk = true;
    for (const item of r.value.items) {
      if (seen.has(item.title)) continue;
      seen.add(item.title);
      candidates.push({ title: item.title, summary: item.description, date: item.pubDate, url: item.url });
    }
  });

  console.log(`[SECTOR-NEWS] ${sectorName} 후보 ${candidates.length}건 (키워드: ${keywords.join(', ')})`);

  if (candidates.length === 0) {
    // 키워드 전부 실패(일시적 오류)면 "뉴스 없음"을 60분간 캐시하지 않는다 —
    // news-selection.ts의 bothFailed와 동일한 이유.
    if (anyOk) await saveToCache(sectorName, []);
    return { items: [], isCached: false };
  }

  const selected = await selectSectorMacro(sectorName, candidates);
  await saveToCache(sectorName, selected);
  return { items: selected, isCached: false };
}
