// 아침 섹터 알림 메일 (2026-09-04) — 본인 전용(수신자 1명) 개인 기능.
//
// 구성(설계 합의):
//  1) morning-sector-analysis 크론(08:30 KST): 밤사이 거시 뉴스 + 전일 미국증시 마감을 Claude에
//     넣어 "오늘 주목 예상 섹터"를 만들고 market_cache(sector_mail_morning, 6h)에만 저장. 메일 없음.
//  2) sector-mail 크론(10:05 KST): 테마 마스터 + 업종 등락률 + 외국인/기관 수급(매매종목가집계 4목록
//     + 상위 섹터 대표종목 추정가집계 보충)을 모아 Claude가 상위 3개 섹터를 고르고, 1)의 아침 분석과
//     비교한 뒤 메일 1통 발송. 1)이 실패해도 "아침 분석 생략"으로 폴백해서 메일은 나간다.
//
// 데이터 결손 정책: KIS/뉴스/Claude 어느 단계가 실패해도 그 섹션만 "데이터 없음"으로 표기하고 발송은
// 진행한다(전체 실패로 메일이 안 오는 것보다 부분 결손이 낫다).
//
// 개인용 기능이라 유저 대상 컴플라이언스 문구 체계(lib/ai-compliance)는 적용 대상이 아니다. 대신
// 수신자가 SECTOR_MAIL_TO 단일 주소인지 코드로 보장한다(resolveSectorMailRecipient) — users 테이블
// 조회 금지.

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';
import {
  fetchInvestorFlowRanking,
  fetchIndexCategoryPrices,
  fetchIndexPrice,
  fetchInvestorTrendEstimate,
  fetchDailyChart,
  type SectorIndexRow,
} from '@/lib/kis-api';
import { fetchFluctuation, isValidStockItem, EXCLUDE_PATTERN } from '@/lib/market-ranking';
import { fetchNaverNews } from '@/lib/naver-news';
import { fetchYahooIndex } from '@/lib/market-utils';
import { fetchLiveMacroNews, getKstInfo, type NewsItem } from '@/lib/daily-email';
import { getDomesticMarketDayContext, type MarketDayContext } from '@/lib/market-day-context';
import { fetchThemeMasterCached, buildTickerPrimarySectorIndex, findMissingThemeCodes } from '@/lib/theme-master';
import { SECTOR_GROUPS, SECTOR_GROUP_BY_ID } from '@/lib/sector-groups';
import { nowKstString, kstDateStr } from '@/lib/ai-grounding';
import type { MarketIndexData } from '@/lib/types';

const LOG = '[SECTOR-MAIL]';
const SECTOR_MAIL_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_SECTOR_MAIL_TO = 'saepian2@gmail.com';
export const MORNING_CACHE_KEY = 'sector_mail_morning';
export const MORNING_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// 대표종목 추정가집계(HHPTJ04160200) 보충 호출 상한 — 고정 호출(업종 8 + 수급 4 + 거래대금 2 = 14)과
// 합쳐 크론 1회 KIS 호출이 40건을 넘지 않도록 26으로 둔다.
export const SUPPLEMENT_MAX_CALLS = 26;
export const SUPPLEMENT_TOP_SECTORS = 5;
export const REPRESENTATIVES_PER_SECTOR = 5;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── 수신자 보장 ────────────────────────────────────────────────────────────────
// 쉼표/세미콜론/공백이 섞인 다중 주소는 거부 — 이 메일은 어떤 경우에도 1명에게만 간다.
export function resolveSectorMailRecipient(raw: string | undefined = process.env.SECTOR_MAIL_TO): string {
  const value = (raw ?? '').trim() || DEFAULT_SECTOR_MAIL_TO;
  if (!/^[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+$/.test(value)) {
    throw new Error(`SECTOR_MAIL_TO가 단일 이메일 주소가 아님: "${value}"`);
  }
  return value;
}

// ── 거래일 가드 ────────────────────────────────────────────────────────────────
// daily-alert-email과 동일한 앵커 종목(삼성전자) 1주 차트 패턴. 09:00 이전엔 판정이 보류돼 평일이면
// 항상 거래일로 나온다(lib/market-day-context.ts 주석) — 08:30 크론은 주말만 걸러지고 평일 공휴일은
// 그대로 실행된다(Claude 호출 1회 비용). 10:05 크론은 신뢰 구간이라 공휴일까지 정확히 걸러진다.
export async function checkDomesticTradingDay(): Promise<{ ctx: MarketDayContext; kisCalls: number }> {
  const chart = await fetchDailyChart('005930', '1W', { priority: 'cron' }).catch(() => []);
  return { ctx: getDomesticMarketDayContext(chart), kisCalls: 1 };
}

// ── Claude 공통 ────────────────────────────────────────────────────────────────
// 구조화 출력(output_config.format json_schema) — 2026-09-04 재집계 검증 중 reason 문자열 안의 큰따옴표로
// JSON.parse가 깨져 폴백으로 떨어진 사례가 있어, 스키마 강제로 항상 유효한 JSON을 받는다.
// 파라미터(2026-09-04 프로빙 실측): effort medium + max_tokens 1500 + 60s에서 3회 중 2회가 "max_tokens 초과"
// (적응형 사고 토큰이 max_tokens에 포함됨) 또는 60s 타임아웃으로 1차 실패 → effort low(표에서 3개 고르는
// 수준의 과제), max_tokens 6000, 90s로 조정. 같은 프로빙 3회 연속 1차 성공 확인.
const NAMED_REASON_LIST = {
  type: 'array',
  items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'], additionalProperties: false },
} as const;
const MORNING_SCHEMA = {
  type: 'object',
  properties: { usSummary: { type: 'string' }, expectedSectors: NAMED_REASON_LIST, overallNote: { type: 'string' } },
  required: ['usSummary', 'expectedSectors', 'overallNote'],
  additionalProperties: false,
} as const;
const SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: { topSectors: NAMED_REASON_LIST, morningComparison: { type: 'string' }, marketNote: { type: 'string' } },
  required: ['topSectors', 'morningComparison', 'marketNote'],
  additionalProperties: false,
} as const;

async function askClaudeJson<T>(label: string, system: string, prompt: string, maxTokens: number, timeoutMs: number, schema: Record<string, unknown>): Promise<T> {
  const message = await Promise.race([
    anthropic.messages.create({
      model: SECTOR_MAIL_MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} Claude timeout ${timeoutMs}ms`)), timeoutMs)),
  ]);
  if (message.stop_reason === 'refusal') throw new Error(`${label} Claude refusal`);
  if (message.stop_reason === 'max_tokens') throw new Error(`${label} Claude max_tokens 초과`);
  const text = message.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('\n').trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/); // 구조화 출력이면 여기 올 일이 없지만 방어
    if (!match) throw new Error(`${label} JSON 없음: ${text.slice(0, 120)}`);
    return JSON.parse(match[0]) as T;
  }
}

const SECTOR_NAME_LIST = SECTOR_GROUPS.map((g) => g.name).join(', ');

// ── 1) 아침 분석 ───────────────────────────────────────────────────────────────
export interface MorningAnalysis {
  generatedAt: string;
  dateKst: string; // YYYY-MM-DD — 같은 날 것만 10:05 메일에 쓴다
  usIndices: { nasdaq: MarketIndexData | null; sp500: MarketIndexData | null; dow: MarketIndexData | null };
  usNews: { title: string; url: string }[];
  macroNews: NewsItem[];
  usSummary: string;
  expectedSectors: { name: string; reason: string }[];
  overallNote: string;
}

const MORNING_SYSTEM = `당신은 한국 주식시장 개장 전에 "오늘 장에서 주목받을 가능성이 있는 섹터"를 정리하는 리서치 보조입니다.
이 결과는 작성자 본인만 읽는 개인 메모이며, 아래 JSON 형식으로만 응답하세요(마크다운·설명문 금지):
{
  "usSummary": "전일 미국증시 마감 요약 — 제공된 지수 등락률 수치를 반드시 포함, 2~3문장",
  "expectedSectors": [ { "name": "섹터명", "reason": "근거 1~2문장(어떤 뉴스/지표 때문인지 명시)" } ],
  "overallNote": "오늘 국내 시장 전반에 대한 한 줄 관찰"
}
규칙:
- expectedSectors는 3~5개. name은 반드시 다음 목록 중 하나를 그대로 사용: ${SECTOR_NAME_LIST}
- 제공된 뉴스와 지수만 근거로 삼고, 없는 사실을 지어내지 마세요. 근거가 약하면 그 점을 reason에 적으세요.
- 시각 표현은 제공된 현재 시각 기준으로만 쓰세요.`;

export async function runMorningAnalysis(): Promise<MorningAnalysis> {
  const [nasdaq, sp500, dow] = await Promise.all([
    fetchYahooIndex('^IXIC'),
    fetchYahooIndex('^GSPC'),
    fetchYahooIndex('^DJI'),
  ]);
  const [usNewsRes, macroNewsRes] = await Promise.allSettled([
    fetchNaverNews('뉴욕증시', { sort: 'date', display: 5 }),
    fetchLiveMacroNews(),
  ]);
  const usNews = usNewsRes.status === 'fulfilled' && !usNewsRes.value.apiError
    ? usNewsRes.value.items.map((n) => ({ title: n.title, url: n.url }))
    : [];
  const macroNews = macroNewsRes.status === 'fulfilled' ? macroNewsRes.value : [];
  if (usNewsRes.status === 'rejected') console.error(`${LOG} 뉴욕증시 뉴스 조회 실패:`, usNewsRes.reason);
  if (macroNewsRes.status === 'rejected') console.error(`${LOG} 거시 뉴스 조회 실패:`, macroNewsRes.reason);

  const indexLine = (label: string, d: MarketIndexData | null) =>
    d ? `- ${label}: ${d.value.toLocaleString()} (${d.changeRate >= 0 ? '+' : ''}${d.changeRate.toFixed(2)}%)` : `- ${label}: 조회 실패`;
  const prompt = `현재 시각: ${nowKstString()}

## 전일 미국증시 마감
${indexLine('나스닥', nasdaq)}
${indexLine('S&P500', sp500)}
${indexLine('다우존스', dow)}

## 뉴욕증시 관련 뉴스
${usNews.length ? usNews.map((n, i) => `${i + 1}. ${n.title}`).join('\n') : '없음'}

## 밤사이 거시/국내 뉴스
${macroNews.length ? macroNews.map((n, i) => `${i + 1}. ${n.title}${n.summary ? ` — ${n.summary}` : ''}`).join('\n') : '없음'}

위 자료로 시스템 프롬프트의 JSON을 작성하세요.`;

  const parsed = await askClaudeJson<{ usSummary?: string; expectedSectors?: { name?: string; reason?: string }[]; overallNote?: string }>(
    '아침 분석', MORNING_SYSTEM, prompt, 6000, 90_000, MORNING_SCHEMA,
  );
  const validNames = new Set(SECTOR_GROUPS.map((g) => g.name));
  const expectedSectors = (parsed.expectedSectors ?? [])
    .map((s) => ({ name: String(s?.name ?? '').trim(), reason: String(s?.reason ?? '').trim() }))
    .filter((s) => s.name);
  const unknown = expectedSectors.filter((s) => !validNames.has(s.name)).map((s) => s.name);
  if (unknown.length) console.warn(`${LOG} 아침 분석이 목록 밖 섹터명을 사용:`, unknown);

  const analysis: MorningAnalysis = {
    generatedAt: new Date().toISOString(),
    dateKst: kstDateStr(),
    usIndices: { nasdaq, sp500, dow },
    usNews,
    macroNews,
    usSummary: String(parsed.usSummary ?? '').trim(),
    expectedSectors: expectedSectors.slice(0, 5),
    overallNote: String(parsed.overallNote ?? '').trim(),
  };
  const { error } = await adminClient
    .from('market_cache')
    .upsert({ key: MORNING_CACHE_KEY, data: analysis as any, updated_at: analysis.generatedAt });
  if (error) throw new Error(`아침 분석 캐시 저장 실패: ${error.message}`);
  return analysis;
}

export function isMorningAnalysisUsable(row: { data: unknown; updated_at: string } | null, now: Date = new Date()): boolean {
  if (!row?.data || typeof row.data !== 'object') return false;
  const age = now.getTime() - new Date(row.updated_at).getTime();
  if (!(age >= 0 && age < MORNING_CACHE_TTL_MS)) return false;
  return (row.data as MorningAnalysis).dateKst === kstDateStr(now);
}

export async function loadMorningAnalysis(): Promise<MorningAnalysis | null> {
  try {
    const { data } = await adminClient
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', MORNING_CACHE_KEY)
      .maybeSingle();
    return data && isMorningAnalysisUsable(data) ? (data.data as unknown as MorningAnalysis) : null;
  } catch (e) {
    console.warn(`${LOG} 아침 분석 캐시 조회 실패:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── 2-c) 업종 등락률 ──────────────────────────────────────────────────────────
export interface IndustryRow extends SectorIndexRow { market: 'KOSPI' | 'KOSDAQ' }
export interface SectorIndexSnapshot {
  kospi: SectorIndexRow | null;
  kosdaq: SectorIndexRow | null;
  industries: IndustryRow[];
  failed: string[];
}

// 코스피 0005~0030만 업종(0001~0004는 종합/규모, 0163 이상은 배당·TR·VKOSPI 파생).
// 코스닥 1005~1041만 업종(1001~1004 종합/규모, 1042~1045 우량/벤처/중견/기술성장, 1049 글로벌, 1196 TR, 3xxx KSQ150).
export function selectIndustryRows(rows: SectorIndexRow[], market: 'KOSPI' | 'KOSDAQ'): IndustryRow[] {
  const [lo, hi] = market === 'KOSPI' ? [5, 30] : [1005, 1041];
  return rows
    .filter((r) => /^\d{4}$/.test(r.code) && Number(r.code) >= lo && Number(r.code) <= hi)
    .map((r) => ({ ...r, market }));
}

// 코스닥 제조(1009)/건설(1010)/통신(1032)/IT서비스(1033)는 목록 API 어느 조합에도 없어 개별 조회(2026-09-04 실측).
const KOSDAQ_INDIVIDUAL_INDUSTRIES: [string, string][] = [['1009', '제조'], ['1010', '건설'], ['1032', '통신'], ['1033', 'IT 서비스']];

export async function fetchSectorIndexSnapshot(): Promise<{ snapshot: SectorIndexSnapshot; kisCalls: number }> {
  const [kospiRes, kosdaqGeneralRes, kosdaqOtherRes, kosdaqIndexRes, ...individualRes] = await Promise.allSettled([
    fetchIndexCategoryPrices({ iscd: '0001', mkt: 'K', blng: '0' }, { priority: 'cron' }),
    fetchIndexCategoryPrices({ iscd: '1001', mkt: 'Q', blng: '3' }, { priority: 'cron' }),
    fetchIndexCategoryPrices({ iscd: '1001', mkt: 'Q', blng: '1' }, { priority: 'cron' }),
    fetchIndexPrice('1001', '코스닥', { priority: 'cron' }),
    ...KOSDAQ_INDIVIDUAL_INDUSTRIES.map(([code, name]) => fetchIndexPrice(code, name, { priority: 'cron' })),
  ]);
  const failed: string[] = [];
  const note = (label: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === 'rejected') { failed.push(label); console.error(`${LOG} ${label} 조회 실패:`, r.reason); }
  };
  note('코스피 전업종', kospiRes); note('코스닥 일반구분', kosdaqGeneralRes); note('코스닥 기타구분', kosdaqOtherRes); note('코스닥 종합', kosdaqIndexRes);
  individualRes.forEach((r, i) => note(`코스닥 ${KOSDAQ_INDIVIDUAL_INDUSTRIES[i][1]}`, r));

  const industries: IndustryRow[] = [];
  const seen = new Set<string>();
  const push = (rows: IndustryRow[]) => { for (const r of rows) { if (!seen.has(r.code)) { seen.add(r.code); industries.push(r); } } };
  if (kospiRes.status === 'fulfilled') push(selectIndustryRows(kospiRes.value.rows, 'KOSPI'));
  if (kosdaqGeneralRes.status === 'fulfilled') push(selectIndustryRows(kosdaqGeneralRes.value.rows, 'KOSDAQ'));
  if (kosdaqOtherRes.status === 'fulfilled') push(selectIndustryRows(kosdaqOtherRes.value.rows, 'KOSDAQ'));
  push(individualRes.flatMap((r) => (r.status === 'fulfilled' ? [{ ...(r.value as SectorIndexRow), market: 'KOSDAQ' as const }] : [])));
  return {
    snapshot: {
      kospi: kospiRes.status === 'fulfilled' ? { ...kospiRes.value.summary, name: '코스피' } : null,
      kosdaq: kosdaqIndexRes.status === 'fulfilled' ? kosdaqIndexRes.value : null,
      industries,
      failed,
    },
    kisCalls: 4 + KOSDAQ_INDIVIDUAL_INDUSTRIES.length,
  };
}

// ── 2-d/e) 수급 ───────────────────────────────────────────────────────────────
export interface FlowStock {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  foreignAuk: number;
  institutionAuk: number;
  tradingValueAuk: number;
  source: 'ranking' | 'estimate'; // estimate = 추정가집계 수량 × 현재가 근사
  estimateHour?: string;
}

export async function fetchFlowStocks(): Promise<{ stocks: FlowStock[]; failed: string[]; kisCalls: number }> {
  const combos = [['foreign', 'inflow'], ['foreign', 'outflow'], ['institution', 'inflow'], ['institution', 'outflow']] as const;
  const settled = await Promise.allSettled(combos.map(([inv, dir]) => fetchInvestorFlowRanking(inv, dir, 30)));
  const failed: string[] = [];
  const byTicker = new Map<string, FlowStock>();
  settled.forEach((r, i) => {
    const label = `${combos[i][0] === 'foreign' ? '외국인' : '기관'} ${combos[i][1] === 'inflow' ? '순매수' : '순매도'}`;
    if (r.status === 'rejected') { failed.push(label); console.error(`${LOG} ${label} 조회 실패:`, r.reason); return; }
    for (const row of r.value) {
      if (!row.ticker || byTicker.has(row.ticker)) continue;
      byTicker.set(row.ticker, {
        ticker: row.ticker, name: row.name, price: row.price, changeRate: row.changeRate,
        foreignAuk: row.foreignNetAuk, institutionAuk: row.institutionNetAuk,
        tradingValueAuk: row.tradingValueAuk, source: 'ranking',
      });
    }
  });
  return { stocks: [...byTicker.values()], failed, kisCalls: 4 };
}

export interface PoolStock { ticker: string; name: string; price: number; changeRate: number; tradingValueAuk: number }

// 거래대금 상위 30×2시장 — 대표종목 보충 후보 풀(수급 4목록에 없는 종목 중 거래대금이 큰 것).
export async function fetchTradingValuePool(): Promise<{ pool: PoolStock[]; failed: string[]; kisCalls: number }> {
  const settled = await Promise.allSettled([fetchFluctuation('3', 'KOSPI'), fetchFluctuation('3', 'KOSDAQ')]);
  const failed: string[] = [];
  const pool: PoolStock[] = [];
  settled.forEach((r, i) => {
    const label = i === 0 ? '코스피 거래대금 상위' : '코스닥 거래대금 상위';
    if (r.status === 'rejected') { failed.push(label); console.error(`${LOG} ${label} 조회 실패:`, r.reason); return; }
    const rows: any[] = r.value.output ?? [];
    for (const item of rows) {
      if (!isValidStockItem(item) || EXCLUDE_PATTERN.test(item.hts_kor_isnm ?? '')) continue;
      const ticker = item.stck_shrn_iscd || item.mksc_shrn_iscd;
      if (!ticker) continue;
      pool.push({
        ticker, name: String(item.hts_kor_isnm).trim(), price: Number(item.stck_prpr),
        changeRate: Number(item.prdy_ctrt), tradingValueAuk: Math.round(Number(item.acml_tr_pbmn || 0) / 1e8),
      });
    }
  });
  return { pool, failed, kisCalls: 2 };
}

export interface SectorFlowAgg {
  id: string;
  name: string;
  foreignAuk: number;
  institutionAuk: number;
  totalAuk: number;            // 절대금액(참고용)
  tradingValueAuk: number;     // 집계된 구성 종목의 당일 거래대금 합(억원) — 섹터 전체가 아니라 "수급 목록+보충으로 잡힌 종목"의 합
  intensityPct: number | null; // 수급 강도 = totalAuk ÷ tradingValueAuk × 100. 거래대금이 INTENSITY_MIN_TRADING_VALUE_AUK 미만이면 null(노이즈 방지)
  weightedChangeRate: number;  // 거래대금 가중 등락률(%)
  dominant: { name: string; sharePct: number } | null; // 단일 종목 기여도(|순매수| 비중) ≥ DOMINANT_SHARE_PCT면 표기
  stocks: FlowStock[];         // 거래대금 내림차순
  supplementCount: number;
}

// 2026-09-04 재설계(사용자 지시): 절대금액 순위는 대형주가 속한 섹터가 항상 이기므로 "수급 강도"(순매수 ÷
// 거래대금)로 순위를 매기고 절대금액은 참고로만 병기한다. 상승률은 거래대금 가중 평균으로 별도 순위.
export const INTENSITY_MIN_TRADING_VALUE_AUK = 30;
export const DOMINANT_SHARE_PCT = 70;

export function aggregateSectorFlows(stocks: FlowStock[], tickerIndex: Map<string, string[]>): SectorFlowAgg[] {
  const aggs = new Map<string, SectorFlowAgg>();
  for (const s of stocks) {
    for (const id of tickerIndex.get(s.ticker) ?? []) {
      const g = SECTOR_GROUP_BY_ID.get(id);
      if (!g) continue;
      const agg = aggs.get(id) ?? {
        id, name: g.name, foreignAuk: 0, institutionAuk: 0, totalAuk: 0, tradingValueAuk: 0,
        intensityPct: null, weightedChangeRate: 0, dominant: null, stocks: [], supplementCount: 0,
      };
      agg.foreignAuk += s.foreignAuk;
      agg.institutionAuk += s.institutionAuk;
      agg.tradingValueAuk += Math.max(0, s.tradingValueAuk);
      agg.stocks.push(s);
      if (s.source === 'estimate') agg.supplementCount++;
      aggs.set(id, agg);
    }
  }
  const list = [...aggs.values()];
  for (const a of list) {
    a.totalAuk = a.foreignAuk + a.institutionAuk;
    a.stocks.sort((x, y) => y.tradingValueAuk - x.tradingValueAuk);
    a.intensityPct = a.tradingValueAuk >= INTENSITY_MIN_TRADING_VALUE_AUK ? (a.totalAuk / a.tradingValueAuk) * 100 : null;
    const tvSum = a.stocks.reduce((acc, x) => acc + Math.max(0, x.tradingValueAuk), 0);
    a.weightedChangeRate = tvSum > 0
      ? a.stocks.reduce((acc, x) => acc + x.changeRate * Math.max(0, x.tradingValueAuk), 0) / tvSum
      : a.stocks.reduce((acc, x) => acc + x.changeRate, 0) / Math.max(1, a.stocks.length);
    const absSum = a.stocks.reduce((acc, x) => acc + Math.abs(x.foreignAuk + x.institutionAuk), 0);
    if (absSum > 0 && a.stocks.length > 1) {
      const top = a.stocks.reduce((best, x) => (Math.abs(x.foreignAuk + x.institutionAuk) > Math.abs(best.foreignAuk + best.institutionAuk) ? x : best), a.stocks[0]);
      const sharePct = (Math.abs(top.foreignAuk + top.institutionAuk) / absSum) * 100;
      if (sharePct >= DOMINANT_SHARE_PCT) a.dominant = { name: top.name, sharePct };
    } else if (a.stocks.length === 1 && absSum > 0) {
      a.dominant = { name: a.stocks[0].name, sharePct: 100 };
    }
  }
  return rankByIntensity(list);
}

// 수급 강도 순위 — 강도 없는(거래대금 미달) 섹터는 뒤로, 동률이면 절대금액.
export function rankByIntensity(aggs: SectorFlowAgg[]): SectorFlowAgg[] {
  return [...aggs].sort((a, b) => {
    if (a.intensityPct == null && b.intensityPct == null) return b.totalAuk - a.totalAuk;
    if (a.intensityPct == null) return 1;
    if (b.intensityPct == null) return -1;
    return b.intensityPct - a.intensityPct || b.totalAuk - a.totalAuk;
  });
}
// 상승률 순위 — 거래대금 가중 등락률.
export function rankByChange(aggs: SectorFlowAgg[]): SectorFlowAgg[] {
  return [...aggs].sort((a, b) => b.weightedChangeRate - a.weightedChangeRate || b.tradingValueAuk - a.tradingValueAuk);
}
// 절대금액 순위(참고/비교용 — 2026-09-04 이전 로직).
export function rankByAmount(aggs: SectorFlowAgg[]): SectorFlowAgg[] {
  return [...aggs].sort((a, b) => b.totalAuk - a.totalAuk);
}

// 보충 대상: 수급 합계 상위 SUPPLEMENT_TOP_SECTORS개 섹터마다 "구성 종목 중 거래대금 상위
// REPRESENTATIVES_PER_SECTOR개"를 대표종목으로 보고(수급 4목록 + 거래대금 상위 풀을 합쳐 거래대금순),
// 그중 수급 목록에 이미 있는 종목은 같은 값을 다시 받을 뿐이라 제외 — 즉 "거래대금은 큰데 외국인/기관
// 상위 30위 목록엔 없는" 종목만 추정가집계를 호출한다. 전체 maxCalls 이내.
export function pickSupplementTargets(
  aggs: SectorFlowAgg[],
  pool: PoolStock[],
  tickerIndex: Map<string, string[]>,
  covered: Set<string>,
  maxCalls: number = SUPPLEMENT_MAX_CALLS,
): PoolStock[] {
  const targets: PoolStock[] = [];
  const chosen = new Set<string>();
  const poolByTicker = new Map(pool.map((p) => [p.ticker, p]));
  for (const agg of aggs.slice(0, SUPPLEMENT_TOP_SECTORS)) {
    // 이 섹터의 대표종목 후보 = (수급 목록에 있는 구성 종목) ∪ (풀에서 이 섹터에 속하는 종목), 거래대금순 상위 N
    const candidates = new Map<string, PoolStock>();
    for (const s of agg.stocks) candidates.set(s.ticker, { ticker: s.ticker, name: s.name, price: s.price, changeRate: s.changeRate, tradingValueAuk: s.tradingValueAuk });
    for (const p of pool) if ((tickerIndex.get(p.ticker) ?? []).includes(agg.id) && !candidates.has(p.ticker)) candidates.set(p.ticker, p);
    const representatives = [...candidates.values()].sort((a, b) => b.tradingValueAuk - a.tradingValueAuk).slice(0, REPRESENTATIVES_PER_SECTOR);
    for (const r of representatives) {
      if (targets.length >= maxCalls) break;
      if (covered.has(r.ticker) || chosen.has(r.ticker)) continue;
      targets.push(poolByTicker.get(r.ticker) ?? r); chosen.add(r.ticker);
    }
    if (targets.length >= maxCalls) break;
  }
  return targets;
}

// KIS 호출 묶음 페이서 — 묶음 시작 간격을 최소 gapMs로 벌려 초당 피크를 묶음 크기 이하로 묶는다.
// (2026-09-04 병렬 실행 실측 피크 14/s가 하드캡 15/s 직전이라 순차 전환. 라우트의 앵커 차트 1건 +
//  첫 묶음 8건 = 9건이 같은 초에 들어갈 수 있으므로 묶음 크기 상한은 8. 간격 1.0s 실측 피크가 10건이라
//  1.5s로 늘림 — 토큰/게이트 대기로 늦게 나간 앞 묶음 호출이 다음 묶음과 같은 1초 창에 겹치는 것을 막는다.)
export const KIS_CHUNK_MAX = 8;
export const KIS_CHUNK_GAP_MS = 1500;
export function createChunkPacer(gapMs: number = KIS_CHUNK_GAP_MS): () => Promise<void> {
  let lastStart = 0;
  return async () => {
    const wait = lastStart + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
  };
}

export async function supplementWithEstimates(targets: PoolStock[], pace?: () => Promise<void>): Promise<{ added: FlowStock[]; failed: number; kisCalls: number }> {
  const settled: PromiseSettledResult<Awaited<ReturnType<typeof fetchInvestorTrendEstimate>>>[] = [];
  for (let i = 0; i < targets.length; i += KIS_CHUNK_MAX) {
    if (pace) await pace();
    settled.push(...await Promise.allSettled(targets.slice(i, i + KIS_CHUNK_MAX).map((t) => fetchInvestorTrendEstimate(t.ticker, { priority: 'cron' }))));
  }
  const added: FlowStock[] = [];
  let failed = 0;
  settled.forEach((r, i) => {
    const t = targets[i];
    if (r.status === 'rejected') { failed++; console.warn(`${LOG} 추정가집계 실패 ${t.name}(${t.ticker}):`, r.reason instanceof Error ? r.reason.message : r.reason); return; }
    const latest = r.value[0]; // 최신 입력분이 먼저
    if (!latest) return;      // 아직 입력 전(빈 배열) — 정상
    added.push({
      ticker: t.ticker, name: t.name, price: t.price, changeRate: t.changeRate,
      foreignAuk: Math.round((latest.foreignQty * t.price) / 1e8),
      institutionAuk: Math.round((latest.institutionQty * t.price) / 1e8),
      tradingValueAuk: t.tradingValueAuk, source: 'estimate', estimateHour: latest.hourCode,
    });
  });
  return { added, failed, kisCalls: targets.length };
}

// ── 종합(Claude) ──────────────────────────────────────────────────────────────
export interface SectorSynthesis {
  topSectors: { name: string; reason: string }[];
  morningComparison: string;
  marketNote: string;
  usedFallback: boolean;
}

const SYNTHESIS_SYSTEM = `당신은 한국 주식시장 장초반(09:00~10:00) 데이터를 보고 "지금 자금이 실제로 몰리는 섹터"를 고르는 리서치 보조입니다.
이 결과는 작성자 본인만 읽는 개인 메모이며, 아래 JSON 형식으로만 응답하세요(마크다운·설명문 금지):
{
  "topSectors": [ { "name": "섹터명", "reason": "근거 1~2문장 — 수급 강도(%)와 가중 등락률(%) 수치를 인용하고, 절대금액은 참고로만" } ],
  "morningComparison": "아침 예상 섹터와 장초반 실측이 일치하는지, 어긋난다면 무엇이 달랐는지 2~3문장 (아침 분석이 없으면 '아침 분석 없음'이라고만)",
  "marketNote": "장초반 시장 전반 한 줄 관찰"
}
선정 기준(반드시 준수):
- topSectors는 정확히 3개. name은 제공된 표에 있는 섹터명을 그대로 사용.
- "상승률(거래대금 가중 등락률) 상위이면서 수급 강도(순매수÷거래대금)가 동반되는 섹터"를 우선 선정.
- 외국인/기관 순매수 절대금액이 크다는 이유만으로 선정하는 것을 금지. 절대금액은 참고 지표일 뿐이다.
- 소형 섹터(거래대금·종목 수가 작음)라도 강도와 상승이 동반되면 선정한다. 다만 "사실상 단일 종목" 표기가 있으면 그 사실을 reason에 명시.
- 제공된 수치만 근거로 삼고, 없는 사실을 지어내지 마세요. 금액은 억원 단위입니다.
- 각 종목은 대표 섹터 1개에만 집계돼 있습니다(중복 없음).
- 시각 표현은 제공된 현재 시각 기준으로만 쓰세요.`;

function fmtAuk(n: number): string { return `${n > 0 ? '+' : ''}${n.toLocaleString()}`; }
function fmtIntensity(n: number | null): string { return n == null ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`; }
function fmtPct(n: number): string { return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`; }

export async function synthesizeSectors(input: {
  morning: MorningAnalysis | null;
  index: SectorIndexSnapshot | null;
  aggs: SectorFlowAgg[];
}): Promise<SectorSynthesis> {
  const fallback = (): SectorSynthesis => ({
    topSectors: rankByIntensity(input.aggs).slice(0, 3).map((a) => ({ name: a.name, reason: `수급 강도 ${fmtIntensity(a.intensityPct)} / 가중 등락률 ${fmtPct(a.weightedChangeRate)} (자동 강도순, AI 종합 실패)` })),
    morningComparison: 'AI 종합 생성에 실패해 비교를 생략합니다.',
    marketNote: '',
    usedFallback: true,
  });
  if (!input.aggs.length) return { ...fallback(), morningComparison: '수급 데이터가 없어 비교를 생략합니다.' };

  const industries = input.index?.industries ?? [];
  const sortedInd = [...industries].sort((a, b) => b.changeRate - a.changeRate);
  const indLine = (r: IndustryRow) => `- [${r.market}] ${r.name}: ${fmtPct(r.changeRate)}`;
  const byIntensity = rankByIntensity(input.aggs);
  const byChange = rankByChange(input.aggs);
  const aggLine = (a: SectorFlowAgg) => `- ${a.name}: 강도 ${fmtIntensity(a.intensityPct)} / 가중등락률 ${fmtPct(a.weightedChangeRate)} / 순매수 합계 ${fmtAuk(a.totalAuk)}(외 ${fmtAuk(a.foreignAuk)}, 기 ${fmtAuk(a.institutionAuk)}) / 거래대금 ${a.tradingValueAuk.toLocaleString()} / 종목 ${a.stocks.length}${a.supplementCount ? `(추정 ${a.supplementCount})` : ''}${a.dominant ? ` / 사실상 ${a.dominant.name} 단일 종목(${a.dominant.sharePct.toFixed(0)}%)` : ''}`;
  const morningBlock = input.morning
    ? `## 아침 분석(08:30 생성)
미국증시: ${input.morning.usSummary || '요약 없음'}
예상 섹터:
${input.morning.expectedSectors.map((s) => `- ${s.name}: ${s.reason}`).join('\n') || '- 없음'}
${input.morning.overallNote ? `관찰: ${input.morning.overallNote}` : ''}`
    : '## 아침 분석\n없음(생성 실패 또는 미실행)';

  const prompt = `현재 시각: ${nowKstString()}

${morningBlock}

## 업종 등락률(09:00~현재)
${input.index?.kospi ? `코스피 ${input.index.kospi.value.toFixed(2)} (${fmtPct(input.index.kospi.changeRate)})` : '코스피: 데이터 없음'}
${input.index?.kosdaq ? `코스닥 ${input.index.kosdaq.value.toFixed(2)} (${fmtPct(input.index.kosdaq.changeRate)})` : '코스닥: 데이터 없음'}
상위:
${sortedInd.slice(0, 8).map(indLine).join('\n') || '- 없음'}
하위:
${sortedInd.slice(-5).reverse().map(indLine).join('\n') || '- 없음'}

## 섹터별 수급 강도 순위 (강도 = (외국인+기관 순매수) ÷ 집계 종목 거래대금, 억원, 종목당 대표 섹터 1개 귀속)
${byIntensity.slice(0, 15).map(aggLine).join('\n')}
하위:
${byIntensity.slice(-5).reverse().map(aggLine).join('\n')}

## 섹터별 상승률 순위 (거래대금 가중 등락률)
${byChange.slice(0, 12).map(aggLine).join('\n')}
하위:
${byChange.slice(-5).reverse().map(aggLine).join('\n')}

## 상위 섹터 대표종목(억원)
${byIntensity.slice(0, SUPPLEMENT_TOP_SECTORS).map((a) => `[${a.name}] ` + a.stocks.slice(0, REPRESENTATIVES_PER_SECTOR).map((s) => `${s.name} ${fmtPct(s.changeRate)} 외 ${fmtAuk(s.foreignAuk)}/기 ${fmtAuk(s.institutionAuk)}${s.source === 'estimate' ? '(추정)' : ''}`).join(', ')).join('\n')}

위 자료로 시스템 프롬프트의 JSON을 작성하세요.`;

  // 2026-09-04 드라이런에서 간헐적으로 폴백으로 떨어진 사례(원인 미포착: 타임아웃/일시 오류 추정)가 있어
  // 1회 재시도 — 첫 시도가 성공하면 비용 증가 없음.
  const ask = () => askClaudeJson<{ topSectors?: { name?: string; reason?: string }[]; morningComparison?: string; marketNote?: string }>(
    '섹터 종합', SYNTHESIS_SYSTEM, prompt, 6000, 90_000, SYNTHESIS_SCHEMA,
  );
  try {
    const parsed = await ask().catch((e) => { console.warn(`${LOG} AI 종합 1차 실패, 재시도:`, e instanceof Error ? e.message : e); return ask(); });
    const known = new Set(input.aggs.map((a) => a.name));
    const topSectors = (parsed.topSectors ?? [])
      .map((s) => ({ name: String(s?.name ?? '').trim(), reason: String(s?.reason ?? '').trim() }))
      .filter((s) => s.name && known.has(s.name))
      .slice(0, 3);
    if (!topSectors.length) throw new Error('topSectors 비어 있음/전부 미확인 섹터명');
    return {
      topSectors,
      morningComparison: String(parsed.morningComparison ?? '').trim(),
      marketNote: String(parsed.marketNote ?? '').trim(),
      usedFallback: false,
    };
  } catch (e) {
    console.error(`${LOG} AI 종합 실패:`, e instanceof Error ? e.message : e);
    return fallback();
  }
}

// ── 메일 HTML (공통 조각 — 10:05 리포트와 09:30 속보가 공유) ───────────────────────
export interface SectorMailReport {
  dateStr: string;
  generatedAtKst: string;
  morning: MorningAnalysis | null;
  index: SectorIndexSnapshot | null;
  aggs: SectorFlowAgg[];
  synthesis: SectorSynthesis;
  missing: string[];
  kisCalls: number;
  durationMs: number;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function colorFor(n: number): string { return n > 0 ? '#c62828' : n < 0 ? '#1565c0' : '#555'; }

// 모바일 Gmail 기준 단순 테이블/텍스트 구조(탭·아코디언 금지 — 과거 실패 전례).
const TD = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;';
const TH = 'padding:6px 8px;border-bottom:2px solid #d1d5db;font-size:12px;color:#6b7280;text-align:left;';
const H2 = 'margin:0 0 10px;font-size:15px;color:#111827;';
const card = (title: string, body: string) =>
  `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-top:14px"><h2 style="${H2}">${title}</h2>${body}</div>`;
const none = (label: string) => `<p style="margin:0;color:#9ca3af;font-size:13px">${label}: 데이터 없음</p>`;
const numTd = (n: number, suffix = '') => `<td style="${TD}text-align:right;color:${colorFor(n)};font-variant-numeric:tabular-nums">${n > 0 ? '+' : ''}${n.toLocaleString()}${suffix}</td>`;
const pctTd = (n: number) => `<td style="${TD}text-align:right;color:${colorFor(n)};font-variant-numeric:tabular-nums">${fmtPct(n)}</td>`;
const grayTd = (text: string) => `<td style="${TD}text-align:right;color:#6b7280;font-variant-numeric:tabular-nums">${text}</td>`;
const intensityTd = (n: number | null) => n == null ? `<td style="${TD}text-align:right;color:#9ca3af">-</td>` : `<td style="${TD}text-align:right;color:${colorFor(n)};font-weight:700;font-variant-numeric:tabular-nums">${n > 0 ? '+' : ''}${n.toFixed(1)}%</td>`;
const nameCell = (a: SectorFlowAgg, opts?: { withFlowNote?: boolean }) =>
  `<td style="${TD}">${esc(a.name)}<span style="color:#9ca3af;font-size:11px"> ${a.stocks.length}종목${a.supplementCount ? `(추정 ${a.supplementCount})` : ''}</span>${opts?.withFlowNote !== false && a.dominant ? `<br><span style="color:#b45309;font-size:11px">사실상 ${esc(a.dominant.name)} 단일 종목 (${a.dominant.sharePct.toFixed(0)}%)</span>` : ''}</td>`;

function renderShell(params: { title: string; subtitle: string; cards: string[]; footer: string }): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(params.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827">
<div style="max-width:600px;margin:0 auto;padding:16px 12px 32px">
  <div style="padding:8px 4px 0"><div style="font-size:18px;font-weight:800;color:#111827">${esc(params.title)}</div><div style="font-size:12px;color:#6b7280;margin-top:2px">${params.subtitle}</div></div>
  ${params.cards.join('\n  ')}
  ${params.footer}
</div></body></html>`;
}

function renderFooter(r: { generatedAtKst: string; kisCalls: number; durationMs: number; missing: string[] }): string {
  return `<p style="margin:16px 0 0;font-size:11px;color:#9ca3af;line-height:1.6">생성 ${esc(r.generatedAtKst)} · KIS 호출 ${r.kisCalls}건 · ${(r.durationMs / 1000).toFixed(1)}s${r.missing.length ? `<br>결손: ${esc(r.missing.join(', '))}` : ''}<br>본인 전용 메모 — 투자 판단의 근거가 아닙니다.</p>`;
}

// ② 업종 등락률(KRX 업종지수) — 두 메일 공통
function renderIndexBody(ix: SectorIndexSnapshot | null): string {
  const sortedInd = [...(ix?.industries ?? [])].sort((a, b) => b.changeRate - a.changeRate);
  const indRows = (rows: IndustryRow[]) => rows.map((x) => `<tr><td style="${TD}"><span style="color:#9ca3af;font-size:11px">${x.market === 'KOSPI' ? '코스피' : '코스닥'}</span> ${esc(x.name)}</td><td style="${TD}text-align:right">${x.value.toLocaleString()}</td>${pctTd(x.changeRate)}</tr>`).join('');
  if (!ix || !(ix.kospi || ix.kosdaq || sortedInd.length)) return none('업종 등락률');
  return `<p style="margin:0 0 8px;font-size:13px">${ix.kospi ? `코스피 <b style="color:${colorFor(ix.kospi.changeRate)}">${fmtPct(ix.kospi.changeRate)}</b>` : '코스피 데이터 없음'} · ${ix.kosdaq ? `코스닥 <b style="color:${colorFor(ix.kosdaq.changeRate)}">${fmtPct(ix.kosdaq.changeRate)}</b>` : '코스닥 데이터 없음'}</p>
       <table style="width:100%;border-collapse:collapse"><thead><tr><th style="${TH}">상위 업종</th><th style="${TH}text-align:right">지수</th><th style="${TH}text-align:right">등락률</th></tr></thead><tbody>${indRows(sortedInd.slice(0, 7))}</tbody></table>
       <table style="width:100%;border-collapse:collapse;margin-top:8px"><thead><tr><th style="${TH}">하위 업종</th><th style="${TH}text-align:right">지수</th><th style="${TH}text-align:right">등락률</th></tr></thead><tbody>${indRows(sortedInd.slice(-5).reverse())}</tbody></table>
       ${ix.failed.length ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af">조회 실패: ${esc(ix.failed.join(', '))}</p>` : ''}`;
}

// 섹터그룹 상승률(거래대금 가중) 표 — 10:05 메일 ③의 두 번째 표와 09:30 속보 ②가 공유.
function renderChangeRankingTable(byChange: SectorFlowAgg[], opts: { top: number; bottom?: number; showIntensity: boolean; showStocks?: boolean }): string {
  const row = (a: SectorFlowAgg) => `<tr>${nameCell(a, { withFlowNote: opts.showIntensity })}${pctTd(a.weightedChangeRate)}${opts.showIntensity ? intensityTd(a.intensityPct) : ''}${grayTd(a.tradingValueAuk.toLocaleString())}</tr>${opts.showStocks ? `<tr><td colspan="3" style="padding:0 8px 6px;border-bottom:1px solid #e5e7eb;font-size:11.5px;color:#6b7280">${a.stocks.slice(0, 4).map((s) => `${esc(s.name)} <span style="color:${colorFor(s.changeRate)}">${fmtPct(s.changeRate)}</span>`).join(' · ')}</td></tr>` : ''}`;
  const head = `<thead><tr><th style="${TH}">섹터 (상승률순)</th><th style="${TH}text-align:right">가중등락률</th>${opts.showIntensity ? `<th style="${TH}text-align:right">강도</th>` : ''}<th style="${TH}text-align:right">거래대금</th></tr></thead>`;
  const bottom = opts.bottom ? byChange.slice(-opts.bottom).reverse().filter((a) => !byChange.slice(0, opts.top).includes(a)) : [];
  return `<table style="width:100%;border-collapse:collapse">${head}<tbody>${byChange.slice(0, opts.top).map(row).join('')}</tbody></table>
    ${bottom.length ? `<p style="margin:10px 0 4px;font-size:12px;color:#6b7280">하위</p><table style="width:100%;border-collapse:collapse">${head}<tbody>${bottom.map(row).join('')}</tbody></table>` : ''}`;
}

export function buildSectorMailHtml(r: SectorMailReport): string {
  // ① 아침 분석
  const m = r.morning;
  const idxRow = (label: string, d: MarketIndexData | null) => d
    ? `<tr><td style="${TD}">${label}</td><td style="${TD}text-align:right">${d.value.toLocaleString()}</td>${pctTd(d.changeRate)}</tr>`
    : `<tr><td style="${TD}">${label}</td><td colspan="2" style="${TD}text-align:right;color:#9ca3af">조회 실패</td></tr>`;
  const morningBody = m
    ? `<table style="width:100%;border-collapse:collapse;margin-bottom:10px"><tbody>${idxRow('나스닥', m.usIndices.nasdaq)}${idxRow('S&P500', m.usIndices.sp500)}${idxRow('다우존스', m.usIndices.dow)}</tbody></table>
       ${m.usSummary ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.7;color:#374151">${esc(m.usSummary)}</p>` : ''}
       <p style="margin:0 0 4px;font-size:12px;color:#6b7280">밤사이 뉴스</p>
       <ul style="margin:0 0 10px;padding-left:18px;font-size:13px;line-height:1.7">${m.macroNews.slice(0, 5).map((n) => `<li>${n.url ? `<a href="${esc(n.url)}" style="color:#1d4ed8;text-decoration:none">${esc(n.title)}</a>` : esc(n.title)}</li>`).join('') || '<li style="color:#9ca3af">없음</li>'}</ul>
       <p style="margin:0 0 4px;font-size:12px;color:#6b7280">오늘 주목 예상 섹터</p>
       <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">${m.expectedSectors.map((s) => `<li><b>${esc(s.name)}</b> — ${esc(s.reason)}</li>`).join('') || '<li style="color:#9ca3af">없음</li>'}</ol>
       ${m.overallNote ? `<p style="margin:10px 0 0;font-size:12.5px;color:#6b7280">${esc(m.overallNote)}</p>` : ''}`
    : `<p style="margin:0;color:#9ca3af;font-size:13px">아침 분석 생략 — 08:30 분석이 생성되지 않았거나 만료됨</p>`;

  // ③ 섹터별 수급 강도 + 상승률 (표 2개)
  const byIntensity = rankByIntensity(r.aggs);
  const byChange = rankByChange(r.aggs);
  const intensityRows = byIntensity.slice(0, 20).map((a) => `<tr>${nameCell(a)}${intensityTd(a.intensityPct)}${numTd(a.totalAuk)}${grayTd(a.tradingValueAuk.toLocaleString())}</tr>`).join('');
  const repBlocks = byIntensity.slice(0, SUPPLEMENT_TOP_SECTORS).map((a) =>
    `<p style="margin:10px 0 4px;font-size:12.5px;font-weight:600;color:#374151">${esc(a.name)}</p>
     <table style="width:100%;border-collapse:collapse"><tbody>${a.stocks.slice(0, REPRESENTATIVES_PER_SECTOR).map((s) =>
       `<tr><td style="${TD}">${esc(s.name)}${s.source === 'estimate' ? '<span style="color:#9ca3af;font-size:11px"> 추정</span>' : ''}</td>${pctTd(s.changeRate)}${numTd(s.foreignAuk)}${numTd(s.institutionAuk)}</tr>`).join('')}</tbody></table>`).join('');
  const flowBody = r.aggs.length
    ? `<p style="margin:0 0 6px;font-size:12px;color:#6b7280">강도 = (외국인+기관 순매수) ÷ 집계 종목 거래대금 · 단위 억원 · 매매종목가집계 4목록(각 30행) + 대표종목 추정 보충 기반 · 종목당 대표 섹터 1개 귀속 · 거래대금은 섹터 전체가 아니라 집계된 종목의 합 · 거래대금 ${INTENSITY_MIN_TRADING_VALUE_AUK}억 미만은 강도 미산출</p>
       <table style="width:100%;border-collapse:collapse"><thead><tr><th style="${TH}">섹터 (수급 강도순)</th><th style="${TH}text-align:right">강도</th><th style="${TH}text-align:right">순매수(참고)</th><th style="${TH}text-align:right">거래대금</th></tr></thead><tbody>${intensityRows}</tbody></table>
       <p style="margin:12px 0 0;font-size:12px;color:#6b7280">상승률 순위 (거래대금 가중 등락률)</p>
       ${renderChangeRankingTable(byChange, { top: 12, showIntensity: true })}
       <p style="margin:12px 0 0;font-size:12px;color:#6b7280">강도 상위 섹터 대표종목 (등락률 / 외국인 / 기관)</p>${repBlocks}`
    : none('섹터별 수급');

  // ④ 최종
  const sy = r.synthesis;
  const finalBody = `<ol style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.7">${sy.topSectors.map((s) => `<li><b>${esc(s.name)}</b> — ${esc(s.reason)}</li>`).join('') || '<li style="color:#9ca3af">선정 실패</li>'}</ol>
    ${sy.morningComparison ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.7;color:#374151"><b>아침 예상 vs 장초반 실측:</b> ${esc(sy.morningComparison)}</p>` : ''}
    ${sy.marketNote ? `<p style="margin:8px 0 0;font-size:12.5px;color:#6b7280">${esc(sy.marketNote)}</p>` : ''}
    ${sy.usedFallback ? `<p style="margin:8px 0 0;font-size:12px;color:#b45309">AI 종합 실패 — 수급 강도순 자동 선정</p>` : ''}`;

  return renderShell({
    title: '장초반 섹터 리포트',
    subtitle: `${esc(r.dateStr)} · 10:05 KST 기준 (외국인 09:30 / 기관 10:00 입력분)`,
    cards: [
      card('④ 최종: 상승 + 수급 강도 동반 섹터 TOP 3', finalBody),
      card('① 아침 분석 (08:30)', morningBody),
      card('② 업종 등락률 (09:00~10:00)', renderIndexBody(r.index)),
      card('③ 섹터별 수급 강도 · 상승률', flowBody),
    ],
    footer: renderFooter(r),
  });
}

// ── 09:30 속보 메일 ────────────────────────────────────────────────────────────
// 09:00~09:30 섹터 상승률만. 수급은 외국인 09:30/기관 10:00 입력 전이라 조회 자체를 하지 않는다.
// 섹터그룹 등락률의 유니버스는 거래대금 상위 30×2시장(FHPST01710000 2건)뿐 — 수급 목록이 없으므로
// 종목 수가 10:05 메일보다 적다(실측 60종목 → 섹터 20개 안팎).
// Claude는 쓰지 않는다(판단 근거: 30분 등락률 표는 그 자체로 읽히고, 요약 2~3문장의 정보량 대비
// 10~20초 지연과 외부 API 실패 지점이 하나 늘어나는 비용이 크다. 종합은 10:05 메일이 담당).
export interface SectorFlashReport {
  dateStr: string;
  generatedAtKst: string;
  index: SectorIndexSnapshot | null;
  aggs: SectorFlowAgg[]; // 수급 필드는 전부 0 — 등락률/거래대금만 의미 있음
  missing: string[];
  kisCalls: number;
  durationMs: number;
}

// 거래대금 상위 풀 → 수급 0인 FlowStock 유니버스(aggregateSectorFlows/rankByChange 재사용용).
export function poolToFlowUniverse(pool: PoolStock[]): FlowStock[] {
  return pool.map((p) => ({ ticker: p.ticker, name: p.name, price: p.price, changeRate: p.changeRate, foreignAuk: 0, institutionAuk: 0, tradingValueAuk: p.tradingValueAuk, source: 'ranking' as const }));
}

export function buildSectorFlashHtml(r: SectorFlashReport): string {
  const byChange = rankByChange(r.aggs);
  const sectorBody = r.aggs.length
    ? `<p style="margin:0 0 6px;font-size:12px;color:#6b7280">거래대금 가중 등락률 · 유니버스 = 코스피/코스닥 거래대금 상위 30종목씩 · 종목당 대표 섹터 1개 귀속 · 수급 데이터 없음(외국인 09:30·기관 10:00 입력 전)</p>
       ${renderChangeRankingTable(byChange, { top: 10, bottom: 5, showIntensity: false, showStocks: true })}`
    : none('섹터그룹 등락률');
  return renderShell({
    title: '[09:30 속보] 장초반 섹터 상승률',
    subtitle: `${esc(r.dateStr)} · 09:30 KST 기준 · 수급 없이 등락률만 (수급·종합은 10:05 리포트)`,
    cards: [
      card('① 업종 등락률 (09:00~09:30)', renderIndexBody(r.index)),
      card('② 섹터그룹 상승률 랭킹', sectorBody),
    ],
    footer: renderFooter(r),
  });
}

// ── 발송(공통) ────────────────────────────────────────────────────────────────
// 단일 수신자 — recipient는 반드시 resolveSectorMailRecipient()를 거친 값.
async function sendSectorMailTo(recipient: string, subject: string, html: string): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const { error } = await resend.emails.send({ from: 'Finance Park <noreply@fpark.com>', to: [recipient], subject, html });
  if (error) throw new Error(`섹터 메일 발송 실패: ${JSON.stringify(error)}`);
}

// ── 오케스트레이션 ────────────────────────────────────────────────────────────
export interface SectorMailRunResult {
  sent: boolean;
  recipient: string;
  kisCalls: number;
  durationMs: number;
  missing: string[];
  synthesisFallback: boolean;
  topSectors: { name: string; reason: string }[];
  supplementCalls: number;
  html: string;
}

export async function runSectorMail(opts?: { send?: boolean; extraKisCalls?: number }): Promise<SectorMailRunResult> {
  const t0 = Date.now();
  const recipient = resolveSectorMailRecipient(); // 발송 여부와 무관하게 먼저 검증 — 잘못된 설정이면 즉시 실패
  let kisCalls = opts?.extraKisCalls ?? 0;
  const missing: string[] = [];

  // KIS를 안 타는 수집(테마 마스터 HTTP, 아침 분석 DB)은 동시에, KIS 묶음은 페이서로 순차:
  // [업종 8건] → ≥1s → [수급 4 + 거래대금 2] → ≥1s → [보충 ≤8건씩]. 초당 피크 ≤ 8(+앵커 1).
  const pace = createChunkPacer();
  const nonKis = Promise.all([
    fetchThemeMasterCached().then((r) => r.master).catch((e) => { console.error(`${LOG} 테마 마스터 실패:`, e); return null; }),
    loadMorningAnalysis(),
  ]);
  await pace();
  const indexRes = await fetchSectorIndexSnapshot().catch((e) => { console.error(`${LOG} 업종 스냅샷 실패:`, e); return null; });
  await pace();
  const [flowRes, poolRes] = await Promise.all([
    fetchFlowStocks().catch((e) => { console.error(`${LOG} 수급 조회 실패:`, e); return null; }),
    fetchTradingValuePool().catch((e) => { console.error(`${LOG} 거래대금 풀 실패:`, e); return null; }),
  ]);
  const [themeRes, morning] = await nonKis;
  kisCalls += (indexRes?.kisCalls ?? 8) + (flowRes?.kisCalls ?? 4) + (poolRes?.kisCalls ?? 2);
  if (!morning) missing.push('아침 분석');
  if (!themeRes) missing.push('테마 마스터');
  if (!indexRes) missing.push('업종 등락률'); else missing.push(...indexRes.snapshot.failed);
  if (!flowRes) missing.push('외국인/기관 수급'); else missing.push(...flowRes.failed);
  if (!poolRes) missing.push('거래대금 상위'); else missing.push(...poolRes.failed);

  let aggs: SectorFlowAgg[] = [];
  let supplementCalls = 0;
  if (themeRes && flowRes) {
    const missingCodes = findMissingThemeCodes(themeRes);
    if (missingCodes.length) console.warn(`${LOG} 마스터에 없는 테마코드(그룹 정의 점검 필요):`, missingCodes);
    const tickerIndex = buildTickerPrimarySectorIndex(themeRes); // 종목당 대표 섹터 1개(중복 집계 방지)
    const stocks = [...flowRes.stocks];
    aggs = aggregateSectorFlows(stocks, tickerIndex);
    console.log(`${LOG} 수급 종목 ${stocks.length}개 → 섹터 ${aggs.length}개 집계, 강도 상위:`, aggs.slice(0, 5).map((a) => `${a.name} ${fmtIntensity(a.intensityPct)}`));

    if (poolRes && aggs.length) {
      const covered = new Set(stocks.map((s) => s.ticker));
      const targets = pickSupplementTargets(aggs, poolRes.pool, tickerIndex, covered);
      if (targets.length) {
        const sup = await supplementWithEstimates(targets, pace);
        supplementCalls = sup.kisCalls;
        kisCalls += sup.kisCalls;
        console.log(`${LOG} 대표종목 보충 ${targets.length}건 호출 → 반영 ${sup.added.length}, 실패 ${sup.failed}`);
        if (sup.added.length) aggs = aggregateSectorFlows([...stocks, ...sup.added], tickerIndex);
      }
    }
  }

  const synthesis = await synthesizeSectors({ morning, index: indexRes?.snapshot ?? null, aggs });
  const { dateStr, mm, dd } = getKstInfo();
  const durationMs = Date.now() - t0;
  const html = buildSectorMailHtml({
    dateStr, generatedAtKst: nowKstString(), morning, index: indexRes?.snapshot ?? null, aggs, synthesis, missing, kisCalls, durationMs,
  });

  let sent = false;
  if (opts?.send ?? true) {
    await sendSectorMailTo(recipient, `[Finance Park] ${mm}월 ${dd}일 장초반 섹터 리포트 (10:05)`, html);
    sent = true;
    console.log(`${LOG} ✓ 발송: ${recipient} (KIS ${kisCalls}건, ${durationMs}ms, 결손 ${missing.length})`);
  }

  return { sent, recipient, kisCalls, durationMs: Date.now() - t0, missing, synthesisFallback: synthesis.usedFallback, topSectors: synthesis.topSectors, supplementCalls, html };
}

export interface SectorFlashRunResult {
  sent: boolean;
  recipient: string;
  kisCalls: number;
  durationMs: number;
  missing: string[];
  topSectors: { name: string; weightedChangeRate: number; stocks: number }[];
  html: string;
}

// 09:30 속보 — 10:05 runSectorMail과 완전 독립(공유하는 건 순수 함수/수집 함수뿐, 상태·캐시 의존 없음).
export async function runSectorFlash(opts?: { send?: boolean; extraKisCalls?: number }): Promise<SectorFlashRunResult> {
  const t0 = Date.now();
  const recipient = resolveSectorMailRecipient();
  let kisCalls = opts?.extraKisCalls ?? 0;
  const missing: string[] = [];

  const pace = createChunkPacer();
  const themePromise = fetchThemeMasterCached().then((r) => r.master).catch((e) => { console.error(`${LOG} 테마 마스터 실패:`, e); return null; });
  await pace();
  const indexRes = await fetchSectorIndexSnapshot().catch((e) => { console.error(`${LOG} 업종 스냅샷 실패:`, e); return null; });
  await pace();
  const poolRes = await fetchTradingValuePool().catch((e) => { console.error(`${LOG} 거래대금 풀 실패:`, e); return null; });
  const themeRes = await themePromise;
  kisCalls += (indexRes?.kisCalls ?? 8) + (poolRes?.kisCalls ?? 2);
  if (!themeRes) missing.push('테마 마스터');
  if (!indexRes) missing.push('업종 등락률'); else missing.push(...indexRes.snapshot.failed);
  if (!poolRes) missing.push('거래대금 상위'); else missing.push(...poolRes.failed);

  let aggs: SectorFlowAgg[] = [];
  if (themeRes && poolRes) {
    aggs = rankByChange(aggregateSectorFlows(poolToFlowUniverse(poolRes.pool), buildTickerPrimarySectorIndex(themeRes)));
    console.log(`${LOG}[속보] 거래대금 상위 ${poolRes.pool.length}종목 → 섹터 ${aggs.length}개, 상승률 상위:`, aggs.slice(0, 5).map((a) => `${a.name} ${fmtPct(a.weightedChangeRate)}`));
  }

  const { dateStr, mm, dd } = getKstInfo();
  const durationMs = Date.now() - t0;
  const html = buildSectorFlashHtml({ dateStr, generatedAtKst: nowKstString(), index: indexRes?.snapshot ?? null, aggs, missing, kisCalls, durationMs });

  let sent = false;
  if (opts?.send ?? true) {
    await sendSectorMailTo(recipient, `[Finance Park] [09:30 속보] ${mm}월 ${dd}일 장초반 섹터 상승률`, html);
    sent = true;
    console.log(`${LOG}[속보] ✓ 발송: ${recipient} (KIS ${kisCalls}건, ${durationMs}ms, 결손 ${missing.length})`);
  }
  return { sent, recipient, kisCalls, durationMs: Date.now() - t0, missing, topSectors: aggs.slice(0, 3).map((a) => ({ name: a.name, weightedChangeRate: a.weightedChangeRate, stocks: a.stocks.length })), html };
}
