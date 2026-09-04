import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SUMMARIZE_SYSTEM_INSTRUCTIONS = `아래 금융 뉴스 기사들을 각각 한국어로 2문장씩 요약해줘.
반드시 JSON 배열 형식으로만 응답해. 다른 텍스트나 마크다운은 절대 포함하지 마.

형식: ["요약1", "요약2", "요약3"]`;

export type BatchArticle = { title: string; content: string };

export async function batchSummarize(articles: BatchArticle[]): Promise<string[]> {
  if (!articles.length) return [];

  const articleList = articles
    .map((a, i) => {
      const desc = a.content.trim().length > 20 ? a.content.slice(0, 300) : a.title;
      return `${i + 1}. 제목: ${a.title}\n   내용: ${desc}`;
    })
    .join('\n\n');

  const prompt = `기사 목록:
${articleList}`;

  try {
    const message = await Promise.race([
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: [{ type: 'text', text: SUMMARIZE_SYSTEM_INSTRUCTIONS, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Claude timeout')), 10000)
      ),
    ]);

    const text =
      message.content[0].type === 'text' ? message.content[0].text.trim() : '';

    console.log('[CLAUDE] 배치 요약 응답:', text.slice(0, 300));

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[CLAUDE] JSON 파싱 실패:', text.slice(0, 200));
      return articles.map(() => '');
    }

    const parsed: unknown[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return articles.map(() => '');

    return articles.map((_, i) => (typeof parsed[i] === 'string' ? (parsed[i] as string) : ''));
  } catch (e) {
    console.error('[CLAUDE] 배치 요약 실패:', e instanceof Error ? e.message.slice(0, 150) : e);
    return articles.map(() => '');
  }
}

// ── 2026-09-04 메인 뉴스 품질 개선 B-1: 요약 + 관련성 스코어링을 한 번의 Haiku 호출로 ──────
// fetch-news 크론은 예전부터 batchSummarize(Haiku 1회)를 쓰고 있었다. 홍보성/지역행사/이벤트성
// 기사를 걸러내는 관련성 판정을 별도 호출로 붙이면 크론 1회당 Haiku 2회가 되므로, 같은 호출에서
// 요약과 점수를 함께 받는다(크론 1회당 Haiku 1회 유지). 구조화 출력(json_schema)으로 파싱 실패를
// 없애고, 응답 usage를 반환해 비용을 실측할 수 있게 한다.
export interface ScoredSummary {
  summary: string;
  relevance: number;     // 0~10 — 투자/시장 관련성
  promotional: boolean;  // 보도자료·홍보·지역행사·이벤트·인사·MOU·[게시판]/[포토] 등
  reason: string;        // 판정 근거 한 줄(로그/검증용)
}
export interface ScoredSummaryResult {
  items: ScoredSummary[];
  usage: { inputTokens: number; outputTokens: number } | null;
}

// 메인 노출 제외 규칙 — 홍보성이거나 관련성이 이 값 미만이면 플래그.
export const NEWS_RELEVANCE_MIN = 4;
export function isNewsFlagged(s: Pick<ScoredSummary, 'relevance' | 'promotional'>): boolean {
  return s.promotional || s.relevance < NEWS_RELEVANCE_MIN;
}

const SCORE_SYSTEM = `당신은 주식 투자 정보 서비스의 뉴스 편집자입니다. 아래 기사 목록 각각에 대해 (1) 한국어 2문장 요약, (2) 투자/시장 관련성 점수 0~10, (3) 홍보성 여부, (4) 판정 근거 한 줄을 JSON 배열로 돌려주세요. 배열 길이와 순서는 입력 기사와 정확히 같아야 합니다.

관련성 점수 기준:
- 8~10: 지수·금리·환율·원자재·실적·수급·규제 등 시장 전반이나 상장기업 주가에 직접 영향
- 5~7: 산업 동향·기업 전략·거시 지표 등 간접 영향
- 0~4: 투자 판단과 무관(연예·스포츠·지역 행사·인사·미담·일반 사회/정치 기사)

홍보성(promotional=true) 기준 — 아래 중 하나라도 해당하면 true:
- 상품 출시·금리우대·경품·이벤트·프로모션 안내(보도자료 톤)
- 지역 행사·설명회·캠페인·기부·후원·위문·봉사·MOU/업무협약 단순 체결·수상·인사 발령
- [게시판], [포토], [인사], [부고], [동정] 같은 태그가 붙은 단신
- 골프대회·스포츠 행사·문화 행사 후원 소식
단, 상장기업의 대규모 투자·인수합병·유상증자·실적 발표·규제 이슈는 홍보성이 아닙니다.`;

const SCORE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      relevance: { type: 'integer' }, // min/max는 구조화 출력 스키마에서 미지원(400) — 코드에서 0~10 클램프
      promotional: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['summary', 'relevance', 'promotional', 'reason'],
    additionalProperties: false,
  },
} as const;

export async function batchSummarizeAndScore(articles: BatchArticle[]): Promise<ScoredSummaryResult> {
  if (!articles.length) return { items: [], usage: null };
  const articleList = articles
    .map((a, i) => {
      const desc = a.content.trim().length > 20 ? a.content.slice(0, 300) : a.title;
      return `${i + 1}. 제목: ${a.title}\n   내용: ${desc}`;
    })
    .join('\n\n');

  const message = await Promise.race([
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: [{ type: 'text', text: SCORE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      // 최상위가 배열인 스키마는 허용되지 않을 수 있어 객체로 감싼다.
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { items: SCORE_SCHEMA }, required: ['items'], additionalProperties: false } } },
      messages: [{ role: 'user', content: `기사 목록(${articles.length}건):\n${articleList}` }],
    }),
    // 기사당 요약 2문장+근거 1줄이라 출력이 건수에 비례한다(실측: 30건 25s 초과) — 건수 비례 타임아웃.
    // 크론은 한 번에 최대 10건(fetch-news MAX_PER_CATEGORY×2)이라 35s, maxDuration 60s 안.
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Claude timeout')), Math.min(55_000, 15_000 + 2_000 * articles.length))),
  ]);
  if (message.stop_reason === 'max_tokens') throw new Error('batchSummarizeAndScore max_tokens 초과');
  const text = message.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  const parsed = JSON.parse(text) as { items: ScoredSummary[] };
  const items = (parsed.items ?? []).slice(0, articles.length);
  while (items.length < articles.length) items.push({ summary: '', relevance: 5, promotional: false, reason: '응답 누락 — 보수적으로 노출' });
  return {
    items: items.map((it) => ({
      summary: String(it.summary ?? '').trim(),
      relevance: Math.max(0, Math.min(10, Math.round(Number(it.relevance) || 0))),
      promotional: Boolean(it.promotional),
      reason: String(it.reason ?? '').trim(),
    })),
    usage: message.usage ? { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } : null,
  };
}
