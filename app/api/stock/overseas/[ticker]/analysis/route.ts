import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import YahooFinanceClass from 'yahoo-finance2';

export const dynamic = 'force-dynamic';

export interface OverseasAnalysisResult {
  opinion: '매수' | '관망' | '매도';
  target_price: number;
  stop_loss: number;
  summary: string;
  sections: { title: string; points: string[] }[];
  tags: string[];
  current_price: number;
  currency: string;
  disclaimer: string;
  isCached: boolean;
  createdAt: string;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const yf = new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] });

const MARKET_NAMES: Record<string, string> = {
  us: '미국 NASDAQ/NYSE',
  jp: '일본 도쿄증권거래소(TSE)',
  hk: '홍콩 증권거래소(HKEX)',
  cn: '중국 상하이/심천 증권거래소',
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const market = req.nextUrl.searchParams.get('market') ?? 'us';

  const cacheKey = `overseas_${ticker}`;
  const today = new Date().toISOString().split('T')[0];

  try {
    const { data: cached } = await supabase
      .from('stock_analysis')
      .select('details, created_at')
      .eq('ticker', cacheKey)
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
      } catch { /* 구포맷 재생성 */ }
    }
  } catch { /* 테이블 없으면 건너뜀 */ }

  interface QuoteSnapshot {
    name: string;
    currency: string;
    price: number;
    changeRate: number;
    marketCap: number | null;
    pe: number | null;
    pb: number | null;
    week52High: number;
    week52Low: number;
    revenue: number | null;
    opMargin: number | null;
    roe: number | null;
  }

  let quote: QuoteSnapshot | null = null;
  try {
    const result = await yf.quoteSummary(ticker, {
      modules: ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics'] as const,
    });

    const p  = result.price;
    const sd = result.summaryDetail;
    const fd = result.financialData;
    const ks = result.defaultKeyStatistics;

    quote = {
      name:       p?.shortName ?? p?.longName ?? ticker,
      currency:   p?.currency ?? 'USD',
      price:      p?.regularMarketPrice ?? 0,
      changeRate: (p?.regularMarketChangePercent ?? 0) * 100,
      marketCap:  p?.marketCap ?? null,
      pe:         sd?.trailingPE ?? null,
      pb:         (ks?.priceToBook ?? sd?.priceToBook ?? null) as number | null,
      week52High: sd?.fiftyTwoWeekHigh ?? 0,
      week52Low:  sd?.fiftyTwoWeekLow  ?? 0,
      revenue:    fd?.totalRevenue     ?? null,
      opMargin:   fd?.operatingMargins ?? null,
      roe:        fd?.returnOnEquity   ?? null,
    };
  } catch { /* pass */ }

  if (!quote) {
    return NextResponse.json({ error: '종목 정보 조회 실패' }, { status: 502 });
  }

  const { price, currency, week52High: hi52, week52Low: lo52 } = quote;
  const w52pos = hi52 > lo52 ? Math.round(((price - lo52) / (hi52 - lo52)) * 100) : null;

  const fmtAmount = (n: number | null): string => {
    if (n == null) return 'N/A';
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T ${currency}`;
    if (Math.abs(n) >= 1e9)  return `${(n / 1e9).toFixed(2)}B ${currency}`;
    return `${(n / 1e6).toFixed(2)}M ${currency}`;
  };

  const prompt = `당신은 15년 경력의 글로벌 주식 전문 애널리스트입니다. 아래 종목 데이터를 분석하고 반드시 JSON만 출력하세요. JSON 외 텍스트는 절대 포함하지 마세요.

## 종목 데이터
- 종목명: ${quote.name} (${ticker})
- 시장: ${MARKET_NAMES[market] ?? market}
- 현재가: ${price.toLocaleString()} ${currency} (등락률 ${quote.changeRate >= 0 ? '+' : ''}${quote.changeRate.toFixed(2)}%)
- 시가총액: ${fmtAmount(quote.marketCap)} / PER: ${quote.pe ? quote.pe.toFixed(1) + 'x' : 'N/A'} / PBR: ${quote.pb ? quote.pb.toFixed(2) + 'x' : 'N/A'}
- 52주 고가: ${hi52.toLocaleString()} / 저가: ${lo52.toLocaleString()} ${currency}${w52pos !== null ? ` (현재가 52주 레인지의 ${w52pos}% 위치)` : ''}
- 매출액: ${fmtAmount(quote.revenue)} / 영업이익률: ${quote.opMargin ? (quote.opMargin * 100).toFixed(1) + '%' : 'N/A'} / ROE: ${quote.roe ? (quote.roe * 100).toFixed(1) + '%' : 'N/A'}

## 출력 형식 (JSON만)
{
  "opinion": "매수" | "관망" | "매도",
  "target_price": 숫자 (${currency} 단위, 소수점 2자리 이하),
  "stop_loss": 숫자 (${currency} 단위, 소수점 2자리 이하),
  "summary": "투자 판단이 담긴 한줄 — 종목명 제외, 35자 이내",
  "sections": [
    {
      "title": "📊 현재 시황",
      "points": [
        "주가 흐름과 맥락 — 50자 이내",
        "52주 위치와 기술적 의미 — 50자 이내"
      ]
    },
    {
      "title": "🎯 투자 포인트",
      "points": [
        "근거 → 기대효과 구조 — 55자 이내",
        "밸류에이션 또는 수급 근거 — 55자 이내",
        "추가 촉매 — 55자 이내"
      ]
    },
    {
      "title": "⚠️ 리스크 요인",
      "points": [
        "밸류에이션·실적 리스크 — 60자 이내",
        "매크로·업황 리스크 — 60자 이내"
      ]
    },
    {
      "title": "📈 대응 전략",
      "points": [
        "목표가 근거 포함 — 60자 이내",
        "손절가 근거 포함 — 60자 이내",
        "진입 전략 — 50자 이내"
      ]
    }
  ],
  "tags": ["3~4개 핵심 키워드"]
}

규칙:
- target_price, stop_loss는 숫자 (문자열 X), ${currency} 단위
- 각 point는 실제 데이터를 인용해 구체적으로 작성
- opinion은 전체 분석과 일관성 있게 선택`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + text.slice(0, 80));

    const analysis = JSON.parse(jsonMatch[0]);
    const result: Omit<OverseasAnalysisResult, 'isCached'> = {
      ...analysis,
      current_price: price,
      currency,
      disclaimer:
        '본 분석은 AI가 공개 정보를 바탕으로 생성한 참고 자료입니다. 투자 판단의 책임은 본인에게 있습니다.',
      createdAt: new Date().toISOString(),
    };

    supabase
      .from('stock_analysis')
      .upsert({
        ticker: cacheKey,
        summary: result.summary,
        details: JSON.stringify(result),
        keywords: result.tags,
        sentiment:
          result.opinion === '매수' ? 'bullish'
          : result.opinion === '매도' ? 'bearish'
          : 'neutral',
        created_at: result.createdAt,
      })
      .then(({ error }) => {
        if (error) console.error('[OVERSEAS ANALYSIS] 캐시 저장 실패:', error.message);
      });

    return NextResponse.json({ ...result, isCached: false });
  } catch (e) {
    console.error('[OVERSEAS ANALYSIS]', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
