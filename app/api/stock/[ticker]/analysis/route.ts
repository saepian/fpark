import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { fetchStockPrice, fetchStockInfo } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface AnalysisResult {
  opinion: '매수' | '관망' | '매도';
  target_price: number;
  stop_loss: number;
  summary: string;
  sections: { title: string; points: string[] }[];
  tags: string[];
  current_price: number;
  disclaimer: string;
  isCached: boolean;
  createdAt: string;
}

function opinionToSentiment(op: string) {
  if (op === '매수') return 'bullish';
  if (op === '매도') return 'bearish';
  return 'neutral';
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

  // 1. 당일 캐시 확인 — details 컬럼에 새 포맷 JSON 저장
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data: cached } = await supabase
      .from('stock_analysis')
      .select('summary, details, sentiment, created_at')
      .eq('ticker', ticker)
      .gte('created_at', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.details) {
      try {
        const parsed = JSON.parse(cached.details as string);
        if (parsed?.sections) {
          return NextResponse.json({ ...parsed, isCached: true, createdAt: cached.created_at });
        }
      } catch {
        // 구포맷 캐시 → 재생성
      }
    }
  } catch {
    // 테이블 없으면 건너뜀
  }

  // 2. 종목 정보 조회
  let priceInfo: [
    Awaited<ReturnType<typeof fetchStockPrice>>,
    Awaited<ReturnType<typeof fetchStockInfo>>,
  ] | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      priceInfo = await Promise.all([fetchStockPrice(ticker), fetchStockInfo(ticker)]);
      break;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!priceInfo) {
    return NextResponse.json({ error: '종목 정보 조회 실패' }, { status: 502 });
  }
  const [price, info] = priceInfo;

  // 3. 관련 뉴스 (최대 5건)
  const { data: news } = await supabase
    .from('articles')
    .select('title, summary')
    .ilike('title', `%${price.name}%`)
    .not('summary', 'is', null)
    .order('published_at', { ascending: false })
    .limit(5);

  const newsBlock = news?.length
    ? news.map((n, i) => `${i + 1}. ${n.title}`).join('\n')
    : '관련 뉴스 없음';

  // 4. Claude 분석
  const prompt = `당신은 국내 주식 전문 애널리스트입니다. 아래 종목 정보와 뉴스를 바탕으로 분석하고, 반드시 아래 JSON 형식으로만 응답하세요. JSON 외 텍스트는 절대 출력하지 마세요.

## 종목 정보
- 종목명: ${price.name} (${ticker})
- 현재가: ${price.price.toLocaleString()}원
- 등락률: ${price.changeRate > 0 ? '+' : ''}${price.changeRate}%
- 거래대금: ${price.tradingValue}
- 52주 최고가: ${info.week52High.toLocaleString()}원 / 최저가: ${info.week52Low.toLocaleString()}원
- 시가총액: ${info.marketCap}
- PER: ${info.per || 'N/A'} / PBR: ${info.pbr || 'N/A'}

## 최근 뉴스
${newsBlock}

## 응답 형식 (JSON만)
{
  "opinion": "매수" | "관망" | "매도",
  "target_price": 숫자 (기술적 분석 기반 목표주가, 원 단위 정수),
  "stop_loss": 숫자 (현재가 대비 -5~-10% 손절가, 원 단위 정수),
  "summary": "한줄 핵심 요약 (30자 이내, 종목명 제외)",
  "sections": [
    {
      "title": "📊 현재 시황",
      "points": ["현재 주가 및 시장 상황 (30자 이내)", "수급·거래량 특이사항 (30자 이내)", "52주 위치 및 기술적 레벨 (30자 이내)"]
    },
    {
      "title": "🎯 투자 포인트",
      "points": ["매수/매도/중립 근거 첫 번째 (30자 이내)", "근거 두 번째 (30자 이내)", "근거 세 번째 (30자 이내)"]
    },
    {
      "title": "⚠️ 리스크 요인",
      "points": ["리스크 첫 번째 (30자 이내)", "리스크 두 번째 (30자 이내)"]
    },
    {
      "title": "📈 대응 전략",
      "points": [
        "목표가: {target_price}원 (현재가 대비 +X%)",
        "손절가: {stop_loss}원 (현재가 대비 -X%)",
        "추천 전략 한 줄 (30자 이내)"
      ]
    }
  ],
  "tags": ["키워드1", "키워드2", "키워드3"]
}

주의사항:
- target_price와 stop_loss는 실제 계산된 숫자 (문자열 X)
- 📈 대응 전략의 points[0]과 points[1]은 위 형식 그대로, {target_price}·{stop_loss}는 실제 숫자로 치환
- 각 point는 최대 40자, 간결하고 구체적으로
- opinion은 반드시 근거에 기반해 선택`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + text.slice(0, 100));

    const analysis = JSON.parse(jsonMatch[0]) as Omit<
      AnalysisResult,
      'current_price' | 'disclaimer' | 'isCached' | 'createdAt'
    >;

    const result: Omit<AnalysisResult, 'isCached'> = {
      ...analysis,
      current_price: price.price,
      disclaimer: '본 분석은 AI가 공개 정보를 바탕으로 생성한 참고 자료입니다. 투자 판단의 책임은 본인에게 있습니다.',
      createdAt: new Date().toISOString(),
    };

    // 5. 캐시 저장
    supabase
      .from('stock_analysis')
      .upsert({
        ticker,
        summary: result.summary,
        details: JSON.stringify(result),
        keywords: result.tags,
        sentiment: opinionToSentiment(result.opinion),
        created_at: result.createdAt,
      })
      .then(({ error }) => {
        if (error) console.error('[ANALYSIS] 캐시 저장 실패:', error.message);
      });

    return NextResponse.json({ ...result, isCached: false });
  } catch (e) {
    console.error('[ANALYSIS] Claude 오류:', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
