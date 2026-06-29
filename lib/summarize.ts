import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export type BatchArticle = { title: string; content: string };

export async function batchSummarize(articles: BatchArticle[]): Promise<string[]> {
  if (!articles.length) return [];

  const articleList = articles
    .map((a, i) => {
      const desc = a.content.trim().length > 20 ? a.content.slice(0, 300) : a.title;
      return `${i + 1}. 제목: ${a.title}\n   내용: ${desc}`;
    })
    .join('\n\n');

  const prompt = `아래 ${articles.length}개의 금융 뉴스 기사를 각각 한국어로 2문장씩 요약해줘.
반드시 JSON 배열 형식으로만 응답해. 다른 텍스트나 마크다운은 절대 포함하지 마.

형식: ["요약1", "요약2", "요약3"]

기사 목록:
${articleList}`;

  try {
    const message = await Promise.race([
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
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
