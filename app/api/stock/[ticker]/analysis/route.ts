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
  const w52pos = info.week52High > 0
    ? Math.round(((price.price - info.week52Low) / (info.week52High - info.week52Low)) * 100)
    : null;

  const prompt = `당신은 15년 경력의 국내 주식 전문 애널리스트입니다. 아래 종목 데이터를 분석하고 반드시 JSON만 출력하세요. JSON 외 텍스트는 절대 포함하지 마세요.

## 종목 데이터
- 종목명: ${price.name} (${ticker})
- 현재가: ${price.price.toLocaleString()}원 (등락률 ${price.changeRate > 0 ? '+' : ''}${price.changeRate}%)
- 거래대금: ${price.tradingValue}
- 52주 고가: ${info.week52High.toLocaleString()}원 / 저가: ${info.week52Low.toLocaleString()}원${w52pos !== null ? ` (현재가 52주 레인지의 ${w52pos}% 위치)` : ''}
- 시가총액: ${info.marketCap} / PER: ${info.per || 'N/A'} / PBR: ${info.pbr || 'N/A'}

## 최근 뉴스
${newsBlock}

## 출력 형식 (JSON만)
{
  "opinion": "매수" | "관망" | "매도",
  "target_price": 정수 (52주 고/저가·PER·차트 저항선 근거로 산출, 현재가 대비 +5~+20% 범위),
  "stop_loss": 정수 (주요 지지선 하단, 현재가 대비 -5~-10% 범위),
  "summary": "투자 판단이 담긴 한줄 (예: '수급 유입 확인, 눌림목 분할매수 유효') — 종목명 제외, 35자 이내",
  "sections": [
    {
      "title": "📊 현재 시황",
      "points": [
        "주가 흐름과 맥락을 담은 문장 (예: '거래대금 X억원 유입되며 기관·외인 동반 매수세 확인') — 50자 이내",
        "52주 위치와 기술적 의미 (예: '52주 고점 X원 대비 Y% 하단으로, 전 고점 돌파 시 추가 상승 여력') — 50자 이내",
        "뉴스·이슈 반영 한줄 또는 생략 가능"
      ]
    },
    {
      "title": "🎯 투자 포인트",
      "points": [
        "근거 → 기대효과 구조 (예: 'HBM 수요 급증으로 ASP 상승 → 2분기 영업이익 컨센 상향 가능성') — 55자 이내",
        "밸류에이션 또는 수급 근거 (예: 'PBR 1.1배로 역사적 저점 구간, 추가 하락 리스크 제한적') — 55자 이내",
        "추가 촉매 또는 뉴스 기반 근거 — 55자 이내"
      ]
    },
    {
      "title": "⚠️ 리스크 요인",
      "points": [
        "리스크와 실제 영향까지 설명 (예: 'PER X배는 업종 평균 대비 Y배 수준, 실적 쇼크 시 밸류에이션 조정 불가피') — 60자 이내",
        "매크로·업황 리스크 (예: '환율 상승 지속 시 수입 원가 압력 증가 → 마진 훼손 우려') — 60자 이내"
      ]
    },
    {
      "title": "📈 대응 전략",
      "points": [
        "목표가 근거 포함 (예: '목표가 X원은 52주 고점 Y원 하단 저항선으로, 돌파 시 Z원까지 추가 상승 가능') — 60자 이내",
        "손절가 근거 포함 (예: '손절가 X원은 5일선·20일선 교차 지점으로, 이탈 시 단기 추세 전환 신호') — 60자 이내",
        "진입 전략 (예: '현 구간 분할 매수 후 X원 돌파 확인 시 비중 확대 권고') — 50자 이내"
      ]
    }
  ],
  "tags": ["3~4개 핵심 키워드 (업종·테마·이슈 위주)"]
}

규칙:
- target_price, stop_loss는 정수 (문자열 X)
- 각 point는 실제 데이터(주가·PER·52주가·거래대금 등)를 인용해 구체적으로 작성
- opinion은 전체 분석과 일관성 있게 선택
- JSON 키 순서 및 구조 변경 금지`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
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
