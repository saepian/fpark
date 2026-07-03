import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import YahooFinanceClass from 'yahoo-finance2';
import { COMPLIANCE_PRINCIPLE, INVESTMENT_DISCLAIMER, signalToSentiment, type Signal } from '@/lib/ai-compliance';

export const dynamic = 'force-dynamic';

export type { Signal };

export interface OverseasAnalysisResult {
  signal: Signal;
  summary: string;
  sections: { title: string; points: string[] }[];
  tags: string[];
  current_price: number;
  resistance: number; // 52주 고가 — 서버에서 직접 계산 (AI가 지어내지 않음)
  support: number;    // 52주 저가 — 서버에서 직접 계산
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
        // signal 필드가 없으면 구 스키마(opinion/target_price 등) 캐시 → 재생성
        if (parsed?.sections && parsed?.signal) {
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

  const prompt = `아래 종목 데이터를 관찰된 사실 위주로 정리하고 반드시 JSON만 출력하세요. JSON 외 텍스트는 절대 포함하지 마세요.

## 종목 데이터
- 종목명: ${quote.name} (${ticker})
- 시장: ${MARKET_NAMES[market] ?? market}
- 현재가: ${price.toLocaleString()} ${currency} (등락률 ${quote.changeRate >= 0 ? '+' : ''}${quote.changeRate.toFixed(2)}%)
- 시가총액: ${fmtAmount(quote.marketCap)} / PER: ${quote.pe ? quote.pe.toFixed(1) + 'x' : 'N/A'} / PBR: ${quote.pb ? quote.pb.toFixed(2) + 'x' : 'N/A'}
- 52주 고가: ${hi52.toLocaleString()} / 저가: ${lo52.toLocaleString()} ${currency}${w52pos !== null ? ` (현재가 52주 레인지의 ${w52pos}% 위치)` : ''}
- 매출액: ${fmtAmount(quote.revenue)} / 영업이익률: ${quote.opMargin ? (quote.opMargin * 100).toFixed(1) + '%' : 'N/A'} / ROE: ${quote.roe ? (quote.roe * 100).toFixed(1) + '%' : 'N/A'}

## 출력 형식 (JSON만)
{
  "signal": "순유입 우위" | "중립·관망" | "차익실현 관찰" | "순유출 우위",
  "summary": "관찰된 특징을 담은 한줄 (예: '데이터센터 수요 증가와 52주 저항선 부근 위치가 관찰됨') — 종목명 제외, 35자 이내, 지시형 표현 금지",
  "sections": [
    {
      "title": "📊 현재 시황",
      "points": [
        "주가 흐름과 맥락을 담은 문장 — 50자 이내",
        "52주 위치와 기술적 의미 — 50자 이내"
      ]
    },
    {
      "title": "🎯 관찰 포인트",
      "points": [
        "관찰된 사실 → 시장 해석 구조 (예: 'AI 인프라 수요 증가가 확인되며, 매출 성장 지속 가능성이 있다는 해석도 있음') — 55자 이내",
        "밸류에이션 또는 수급 관찰 — 55자 이내",
        "추가 촉매 또는 뉴스 기반 관찰 — 55자 이내"
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
      "title": "📈 참고 지표",
      "points": [
        "저항선 관찰 (예: '52주 고점 X 부근이 과거 저항선으로 작용해왔다는 특징이 있음') — 60자 이내",
        "지지선 관찰 (예: '52주 저점 X 부근이 과거 지지선으로 작용해왔다는 특징이 있음') — 60자 이내",
        "투자자 참고 지표 안내 — 50자 이내"
      ]
    }
  ],
  "tags": ["3~4개 핵심 키워드"]
}

규칙:
- ${COMPLIANCE_PRINCIPLE}
- signal은 매매 지시가 아니라 수급·가격 패턴에 대한 관찰 결과입니다 — 상승 모멘텀이 강하면 "순유입 우위", 하락 압력이 강하면 "순유출 우위", 단기 급등 후 차익실현 흐름이 관찰되면 "차익실현 관찰", 그 외에는 "중립·관망"을 선택하세요
- "참고 지표" 섹션은 목표가·손절가·진입전략·분할매수 같은 지시형 문구를 쓰지 말고, 52주 고/저점이 과거 저항·지지로 작용해온 사실 서술과 투자자들이 일반적으로 참고하는 지표 안내로만 구성하세요
- "정당화", "충분", "권고", "~하는 것이 좋습니다" 같은 결론형·권유형 단어를 쓰지 말고 "~라는 해석도 있습니다", "~라는 특징이 관찰됩니다" 형태를 사용하세요
- 각 point는 실제 데이터(주가·PER·52주가·매출·마진 등)를 인용해 구체적으로 작성하고, 제공되지 않은 수치를 지어내지 마세요
- signal은 전체 분석과 일관성 있게 선택
- JSON 키 순서 및 구조 변경 금지`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: COMPLIANCE_PRINCIPLE,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + text.slice(0, 80));

    const analysis = JSON.parse(jsonMatch[0]) as Omit<
      OverseasAnalysisResult,
      'current_price' | 'resistance' | 'support' | 'currency' | 'disclaimer' | 'isCached' | 'createdAt'
    >;

    const result: Omit<OverseasAnalysisResult, 'isCached'> = {
      ...analysis,
      current_price: price,
      resistance: hi52, // AI가 산출하지 않고 실제 52주 고가를 그대로 사용
      support: lo52,    // AI가 산출하지 않고 실제 52주 저가를 그대로 사용
      currency,
      disclaimer: INVESTMENT_DISCLAIMER,
      createdAt: new Date().toISOString(),
    };

    supabase
      .from('stock_analysis')
      .upsert({
        ticker: cacheKey,
        summary: result.summary,
        details: JSON.stringify(result),
        keywords: result.tags,
        sentiment: signalToSentiment(result.signal),
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
