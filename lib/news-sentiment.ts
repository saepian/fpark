import Anthropic from '@anthropic-ai/sdk';

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
