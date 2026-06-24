import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { fetchStockPrice, fetchStockInfo } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  // 1. 당일 캐시 확인
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data: cached } = await supabase
      .from('stock_analysis')
      .select('summary, details, keywords, sentiment, disclaimer, created_at')
      .eq('ticker', ticker)
      .gte('created_at', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      return NextResponse.json({ ...cached, isCached: true });
    }
  } catch {
    // stock_analysis 테이블 없으면 캐시 건너뜀
  }

  // 2. 종목 정보 조회 (가격 + 지표) — 동시 KIS 요청 경쟁 대비 1회 재시도
  let priceInfo: [
    Awaited<ReturnType<typeof fetchStockPrice>>,
    Awaited<ReturnType<typeof fetchStockInfo>>
  ] | null = null;
  let fetchErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      priceInfo = await Promise.all([fetchStockPrice(ticker), fetchStockInfo(ticker)]);
      break;
    } catch (e) {
      fetchErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!priceInfo) {
    console.error('[ANALYSIS] 종목 정보 조회 실패:', fetchErr);
    return NextResponse.json({ error: '종목 정보 조회 실패' }, { status: 502 });
  }
  const [price, info] = priceInfo;

  // 3. 종목명으로 관련 뉴스 검색
  const { data: news } = await supabase
    .from('articles')
    .select('title, summary')
    .ilike('title', `%${price.name}%`)
    .not('summary', 'is', null)
    .order('published_at', { ascending: false })
    .limit(5);

  const newsBlock =
    news?.length
      ? news.map((n, i) => `${i + 1}. ${n.title}\n   ${n.summary ?? ''}`).join('\n')
      : '관련 뉴스 없음';

  // 4. Claude 분석 생성
  const prompt = `당신은 전문 주식 애널리스트입니다.
아래 정보를 바탕으로 ${price.name}(${ticker}) 종목을 분석해주세요.

## 종목 정보
- 현재가: ${price.price.toLocaleString()}원
- 등락률: ${price.changeRate > 0 ? '+' : ''}${price.changeRate}%
- 거래량: ${price.volume.toLocaleString()}
- 52주 최고가: ${info.week52High.toLocaleString()}원
- 52주 최저가: ${info.week52Low.toLocaleString()}원
- 시가총액: ${info.marketCap}
- PER: ${info.per || 'N/A'}
- PBR: ${info.pbr || 'N/A'}

## 관련 최신 뉴스
${newsBlock}

## 분석 요청
위 정보를 바탕으로 아래 형식의 JSON으로만 응답해주세요.
다른 텍스트나 마크다운은 절대 포함하지 마세요.

{
  "summary": "2-3문장의 핵심 분석 요약",
  "details": "3-4문장의 상세 분석 (현재 상황, 주요 이슈, 향후 전망)",
  "keywords": ["키워드1", "키워드2", "키워드3"],
  "sentiment": "bullish",
  "disclaimer": "본 분석은 AI가 공개된 정보를 바탕으로 생성한 것으로, 투자 판단의 책임은 본인에게 있습니다."
}

sentiment는 bullish, bearish, neutral 중 하나만 사용하세요.`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      message.content[0].type === 'text' ? message.content[0].text.trim() : '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + text.slice(0, 100));

    const analysis = JSON.parse(jsonMatch[0]) as {
      summary: string;
      details: string;
      keywords: string[];
      sentiment: 'bullish' | 'bearish' | 'neutral';
      disclaimer: string;
    };

    const createdAt = new Date().toISOString();

    // 5. 캐시 저장 (실패해도 무시)
    supabase
      .from('stock_analysis')
      .upsert({ ticker, ...analysis, created_at: createdAt })
      .then(({ error }) => {
        if (error) console.error('[ANALYSIS] 캐시 저장 실패:', error.message);
      });

    return NextResponse.json({ ...analysis, isCached: false, createdAt });
  } catch (e) {
    console.error('[ANALYSIS] Claude 오류:', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
