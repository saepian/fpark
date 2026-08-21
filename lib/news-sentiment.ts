import Anthropic from '@anthropic-ai/sdk';
import { adminClient } from '@/lib/supabase-admin';

// 종목별 뉴스 논조(긍정/부정/중립) 분류 — news-sentiment 크론 전용. selectRelevantNews(이미
// 관련성 검증된 뉴스 최대 5건)를 그대로 재사용하고, 그 결과에 대해서만 이 경량 Haiku 호출로
// 논조를 매긴다. lib/news-selection.ts의 SELECTION_SYSTEM_PROMPT(관련성 선별)는 손대지
// 않는다 — 5개 프로덕션 경로가 공유하는 모듈이라 회귀 위험을 만들지 않기 위함.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export type SentimentLabel = 'positive' | 'negative' | 'neutral';

export interface SentimentCounts {
  positive: number;
  negative: number;
  neutral: number;
}

// "논조"는 기사가 다루는 사실 자체의 성격(호재/악재/중립적 사실전달)이지 주가 방향 예측이
// 아니다 — 이 구분을 시스템 프롬프트에 명시해 다른 컴플라이언스 민감 프롬프트(diagnosis 등)와
// 같은 원칙을 유지한다. 이 결과는 현재 DB 적재만 하고 사용자에게 직접 노출되지 않는다.
const SENTIMENT_SYSTEM_PROMPT = `당신은 한국 주식 관련 뉴스 제목·요약 목록을 읽고 각 기사의 논조를 분류하는 분류기입니다.
"논조"는 그 기사가 다루는 사실 자체의 성격을 뜻합니다 — 실적 개선·신제품 흥행·대규모 수주·신용등급 상향 등은 positive, 실적 악화·소송·리콜·신용등급 하향·사고 등은 negative, 사실 전달 위주라 뚜렷한 호재·악재가 없으면 neutral입니다. 이 종목의 주가가 오를지 내릴지를 예측하는 것이 아니라 기사 내용 자체의 성격만 분류하세요.
각 기사는 정확히 하나의 논조만 가집니다. 반드시 JSON 배열만 출력하세요, 다른 텍스트 없이. 예) [{"i":0,"sentiment":"positive"},{"i":1,"sentiment":"neutral"}]`;

export async function classifyNewsSentiment(
  ticker: string,
  articles: { title: string; summary?: string }[],
): Promise<SentimentCounts> {
  const counts: SentimentCounts = { positive: 0, negative: 0, neutral: 0 };
  if (articles.length === 0) return counts;

  try {
    const list = articles
      .map((a, i) => `${i}: ${a.title}${a.summary ? ` — ${a.summary}` : ''}`)
      .join('\n');

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SENTIMENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `뉴스 목록:\n${list}` }],
    }, { timeout: 15_000, maxRetries: 0 });

    console.log('[TOKEN_USAGE]', {
      route: 'news-sentiment', ticker,
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    });

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON 배열 없음: ' + text.slice(0, 100));
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) throw new Error('배열 형식 아님');

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const sentiment = (item as Record<string, unknown>).sentiment;
      if (sentiment === 'positive') counts.positive++;
      else if (sentiment === 'negative') counts.negative++;
      else if (sentiment === 'neutral') counts.neutral++;
    }
  } catch (e) {
    console.warn(`[NEWS-SENTIMENT] ${ticker} 논조 분류 실패, 중립 폴백:`, e instanceof Error ? e.message : e);
    counts.neutral = articles.length;
  }

  return counts;
}

export function computeSentimentScore(counts: SentimentCounts): number | null {
  const total = counts.positive + counts.negative + counts.neutral;
  if (total === 0) return null;
  return parseFloat(((counts.positive - counts.negative) / total).toFixed(2));
}

// ── UI 노출용 조회(2단계, 2026-08-21) ────────────────────────────────────────
// news_sentiment_daily는 CURATED_TICKERS_MKT(대형주 100종목) 한정 크론이 채우므로,
// 그 밖의 종목/보유종목은 데이터가 아예 없는 게 정상이다 — 호출부에서 null/빈 배열이면
// 섹션 자체를 생략하는 것을 전제로 설계했다(업종 대비 카드의 "peer 없으면 생략" 패턴과 동일).
export type SentimentTrendLabel = '긍정 비중 우세' | '중립·혼조' | '부정 비중 우세';

// 실측(2026-08-21, 14거래일치 데이터): article_count=0인 날은 "군데군데 결측"이 아니라
// 뉴스 매칭이 애초에 안 되는 종목이 전체 기간 내내 0건인 이분법 구조였다 — 그래도 방어적으로
// 5거래일 미만이면 차트 대신 텍스트로 대체(신규 종목이 커브레이지에 막 추가된 경우도 커버).
export const MIN_SENTIMENT_DAYS = 5;
const SENTIMENT_LOOKBACK_CALENDAR_DAYS = 21; // 주말 포함 3주 — 거래일 14일 이상 확보

function sentimentLookbackSinceStr(): string {
  const since = new Date(Date.now() - SENTIMENT_LOOKBACK_CALENDAR_DAYS * 24 * 60 * 60 * 1000);
  return since.toISOString().slice(0, 10);
}

function labelFromAvgScore(avg: number): SentimentTrendLabel {
  if (avg > 0.15) return '긍정 비중 우세';
  if (avg < -0.15) return '부정 비중 우세';
  return '중립·혼조';
}

export interface NewsSentimentTrendPoint { date: string; score: number }

export interface NewsSentimentTrend {
  points: NewsSentimentTrendPoint[]; // sentiment_score가 null인 날짜는 제거된 상태 — 남은 점끼리만 이어 그림
  availableDays: number;
  label: SentimentTrendLabel;
}

// 기업분석 페이지 — 종목 하나의 최근 논조 추이. availableDays < MIN_SENTIMENT_DAYS면 null
// (호출부가 카드 자체를 생략).
export async function fetchNewsSentimentTrend(ticker: string): Promise<NewsSentimentTrend | null> {
  const { data, error } = await adminClient
    .from('news_sentiment_daily')
    .select('date, sentiment_score')
    .eq('ticker', ticker)
    .gte('date', sentimentLookbackSinceStr())
    .order('date', { ascending: true });

  if (error) {
    console.warn('[NEWS-SENTIMENT] 추이 조회 실패:', ticker, error.message);
    return null;
  }
  if (!data) return null;

  const points = data
    .filter((r): r is { date: string; sentiment_score: number } => r.sentiment_score !== null)
    .map((r) => ({ date: r.date, score: r.sentiment_score }))
    .slice(-14); // 최근 14거래일만

  if (points.length < MIN_SENTIMENT_DAYS) return null;

  const avg = points.reduce((s, p) => s + p.score, 0) / points.length;
  return { points, availableDays: points.length, label: labelFromAvgScore(avg) };
}

export interface SectorSentimentEntry {
  sector: string;
  label: SentimentTrendLabel;
  coveredCount: number; // 데이터가 있는(MIN_SENTIMENT_DAYS 이상 쌓인) 보유종목 수
  totalCount: number;   // 이 섹터에 속한 전체 보유종목 수
  positiveCount: number; // 최근 14거래일 커버리지 내 종목들의 호재성 기사 합계 — 라벨의 근거 수치
  negativeCount: number; // 동일 기간 악재성 기사 합계
}

// 포트폴리오진단 페이지 — 보유종목을 섹터별로 묶어 섹터당 평균 논조를 낸다. 100종목
// 커버리지 밖인 보유종목이 섞여있는 게 정상이므로, 커버리지가 0인 섹터는 결과에서 제외하고
// (coveredCount/totalCount)를 함께 반환해 프론트가 "N종목 중 M종목만 반영" 각주를 달 수 있게 한다.
export async function fetchSectorSentiment(
  holdingSectors: { ticker: string; sector: string }[],
): Promise<SectorSentimentEntry[]> {
  const validHoldings = holdingSectors.filter((h) => h.sector);
  const tickers = [...new Set(validHoldings.map((h) => h.ticker))];
  if (tickers.length === 0) return [];

  const { data, error } = await adminClient
    .from('news_sentiment_daily')
    .select('ticker, sentiment_score, positive_count, negative_count')
    .in('ticker', tickers)
    .gte('date', sentimentLookbackSinceStr());

  if (error) {
    console.warn('[NEWS-SENTIMENT] 섹터별 논조 조회 실패:', error.message);
    return [];
  }
  if (!data) return [];

  const scoresByTicker = new Map<string, number[]>();
  // 3단계 라벨의 근거 수치("호재성 O건 · 악재성 O건")로 화면에 그대로 노출 — 라벨만으로는
  // 구분이 안 된다는 실사용 피드백(2026-08-21)에 대응.
  const countsByTicker = new Map<string, { positive: number; negative: number }>();
  for (const row of data) {
    const counts = countsByTicker.get(row.ticker) ?? { positive: 0, negative: 0 };
    counts.positive += row.positive_count;
    counts.negative += row.negative_count;
    countsByTicker.set(row.ticker, counts);

    if (row.sentiment_score === null) continue;
    const arr = scoresByTicker.get(row.ticker) ?? [];
    arr.push(row.sentiment_score);
    scoresByTicker.set(row.ticker, arr);
  }

  const avgByTicker = new Map<string, number>();
  for (const [ticker, scores] of scoresByTicker) {
    if (scores.length < MIN_SENTIMENT_DAYS) continue; // 종목 자체가 데이터 부족하면 커버리지에서 제외
    avgByTicker.set(ticker, scores.reduce((s, v) => s + v, 0) / scores.length);
  }

  const bySector = new Map<string, { total: Set<string>; covered: string[] }>();
  for (const { ticker, sector } of validHoldings) {
    const entry = bySector.get(sector) ?? { total: new Set<string>(), covered: [] };
    entry.total.add(ticker);
    if (avgByTicker.has(ticker) && !entry.covered.includes(ticker)) entry.covered.push(ticker);
    bySector.set(sector, entry);
  }

  const result: SectorSentimentEntry[] = [];
  for (const [sector, { total, covered }] of bySector) {
    if (covered.length === 0) continue; // 데이터 있는 종목이 0개면 섹션에서 생략
    const avg = covered.reduce((s, t) => s + (avgByTicker.get(t) ?? 0), 0) / covered.length;
    const positiveCount = covered.reduce((s, t) => s + (countsByTicker.get(t)?.positive ?? 0), 0);
    const negativeCount = covered.reduce((s, t) => s + (countsByTicker.get(t)?.negative ?? 0), 0);
    result.push({ sector, label: labelFromAvgScore(avg), coveredCount: covered.length, totalCount: total.size, positiveCount, negativeCount });
  }
  return result.sort((a, b) => b.totalCount - a.totalCount);
}
