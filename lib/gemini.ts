import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export type SubCategory = 'stock' | 'macro' | 'company' | 'global' | 'crypto' | 'real_estate' | 'general';
export type StockRef = { name: string; code: string; reason: string };

export type SummarizeResult = {
  relevant: boolean;
  sub_category: SubCategory;
  summary: string;
  stocks: StockRef[];
};

const VALID_SUB: SubCategory[] = ['stock', 'macro', 'company', 'global', 'crypto', 'real_estate', 'general'];

const FINANCE_KEYWORDS = [
  '주식', '증시', '코스피', '코스닥', '나스닥', '주가', '배당', '공모주', '상장', 'ipo',
  '금리', '환율', '물가', 'gdp', '기준금리', '통화정책', '무역', '수출', '수입', '관세',
  '기업', '실적', '영업이익', '매출', '투자', '인수', '합병', 'm&a', '지분',
  '반도체', '배터리', '전기차', '에너지', '바이오', '제약', '건설', '부동산',
  '비트코인', '가상화폐', '암호화폐', '블록체인', 'crypto', 'bitcoin',
  '아파트', '청약', '전세', '분양', '재개발',
  '연준', '한국은행', '금통위', 'fomc', '채권', '펀드', 'etf', '국채',
  '달러', '원화', '위안화', '엔화', 'dollar', 'yuan', 'yen',
  '경제', '금융', '은행', '증권', '보험', '자산',
  'stock', 'market', 'nasdaq', 'dow', 's&p', 'fund', 'bond', 'yield',
  'rate', 'interest', 'inflation', 'economy', 'economic', 'trade', 'tariff',
  'earnings', 'revenue', 'profit', 'merger', 'acquisition',
  'oil', 'energy', 'semiconductor', 'battery', 'ev',
  'fed', 'central bank', 'monetary', 'fiscal', 'currency', 'forex',
  '삼성', 'sk', 'lg', '현대', '카카오', '네이버', '셀트리온', '포스코',
];

export function isFinanceRelated(title: string, description: string = ''): boolean {
  const text = (title + ' ' + description).toLowerCase();
  return FINANCE_KEYWORDS.some((kw) => text.includes(kw));
}

export type BatchArticle = { title: string; content: string };

// 여러 기사를 한 번의 Gemini 호출로 한국어 요약 → string[] 반환
export async function batchSummarize(articles: BatchArticle[]): Promise<string[]> {
  if (articles.length === 0) return [];

  const articleList = articles
    .map((a, i) => {
      const desc = a.content.trim().length > 20 ? a.content.slice(0, 300) : a.title;
      return `${i + 1}. 제목: ${a.title}\n   내용: ${desc}`;
    })
    .join('\n\n');

  const prompt = `아래 ${articles.length}개의 금융 뉴스 기사를 각각 한국어로 2문장씩 요약해줘.
반드시 JSON 배열 형식으로만 응답해. 다른 텍스트는 절대 포함하지 마.

형식: ["요약1", "요약2", "요약3"]

기사 목록:
${articleList}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: prompt,
      });
      const text = (response.text ?? '').trim();
      console.log('[GEMINI] 배치 응답:', text.slice(0, 300));

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('[GEMINI] JSON 배열 파싱 실패:', text.slice(0, 200));
        return articles.map(() => '');
      }

      const parsed: unknown[] = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return articles.map(() => '');

      return articles.map((_, i) => (typeof parsed[i] === 'string' ? (parsed[i] as string) : ''));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const delay = msg.match(/retry in ([\d.]+)s/)?.[1];
      if (delay && attempt < 2) {
        await new Promise((r) => setTimeout(r, (parseFloat(delay) + 2) * 1000));
        continue;
      }
      throw err;
    }
  }
  return articles.map(() => '');
}

export async function summarizeArticle(title: string, content: string): Promise<SummarizeResult> {
  const hasContent = content.trim().length > 20;
  const contentSection = hasContent
    ? `내용: ${content.slice(0, 3000)}`
    : `내용: (본문 없음 — 제목을 기반으로 분석)`;

  const prompt = `다음 뉴스 기사를 분석해줘.

제목: ${title}
${contentSection}

반드시 아래 규칙을 따를 것:
- 기사 언어(영어·한국어)와 관계없이 summary는 항상 한국어로 작성.
- 본문이 없거나 짧으면 제목과 소제목만으로 추론해서 작성.

아래 JSON 형식으로만 응답해줘 (markdown 코드블록, 설명 없이 JSON만):
{
  "relevant": true,
  "sub_category": "general",
  "summary": "3~5줄 한국어 요약",
  "stocks": [
    {
      "name": "종목명 (예: 삼성전자)",
      "code": "한국 6자리 종목코드 또는 해외 티커 (모르면 빈 문자열)",
      "reason": "이 기사와 관련된 이유 한 줄"
    }
  ]
}

relevant 규칙:
- 주식·증시·금융·기업·산업·경제정책·무역·환율·금리·부동산 투자 관련이면 true.
- 부고·별세·사망·스포츠·연예·날씨·사건사고·생활정보 등 경제 무관이면 false.
- false면 summary는 "", stocks는 [], sub_category는 "general"로 응답.

sub_category 규칙 (하나만 선택):
- stock: 주식·증시·코스피·코스닥·나스닥·S&P·주가·배당·공모주
- macro: 금리·환율·물가·GDP·기준금리·통화정책·무역수지·경상수지
- company: 기업실적·M&A·신사업·CEO·분기실적·영업이익·매출·투자
- global: 미국·중국·유럽·일본 등 해외 경제·정책·지정학 이슈
- crypto: 비트코인·이더리움·가상화폐·NFT·블록체인
- real_estate: 부동산·아파트·청약·전세·임대·건설·재개발
- general: 위에 해당 없는 기타 경제 뉴스

stocks 규칙:
- 기사에서 직접 언급된 기업의 상장 주식을 추출해.
- 본문이 없으면 제목에 언급된 기업명으로 추론해.
- 예) "삼성" → {"name":"삼성전자","code":"005930","reason":"..."}
- 관련 기업이 없으면 빈 배열 [].`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: prompt,
      });
      const text = (response.text ?? '').trim();

      const jsonMatch =
        text.match(/```json\s*([\s\S]*?)\s*```/) ||
        text.match(/```\s*([\s\S]*?)\s*```/) ||
        [null, text];
      const jsonText = jsonMatch[1] ?? text;

      const parsed = JSON.parse(jsonText);
      const sub = parsed.sub_category;
      return {
        relevant:     parsed.relevant !== false,
        sub_category: VALID_SUB.includes(sub) ? sub : 'general',
        summary:      (parsed.summary ?? '') as string,
        stocks:       Array.isArray(parsed.stocks) ? parsed.stocks : [],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const delay = msg.match(/retry in ([\d.]+)s/)?.[1];
      if (delay && attempt < 2) {
        await new Promise((r) => setTimeout(r, (parseFloat(delay) + 2) * 1000));
        continue;
      }
      throw err;
    }
  }
  return { relevant: true, sub_category: 'general', summary: '', stocks: [] };
}
