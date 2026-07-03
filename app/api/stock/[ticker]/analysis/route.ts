import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { fetchStockPrice, fetchStockInfo, fetchDailyChart } from '@/lib/kis-api';
import {
  computeSurgeHistory,
  computeTradingValueMultiple,
  buildSurgeHistoryBlock,
  buildTradingValueBlock,
} from '@/lib/stock-analysis-data';
import { COMPLIANCE_PRINCIPLE, INVESTMENT_DISCLAIMER, signalToSentiment, type Signal } from '@/lib/ai-compliance';

export const dynamic = 'force-dynamic';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export type { Signal };

export interface AnalysisResult {
  signal: Signal;
  summary: string;
  sections: { title: string; points: string[] }[];
  tags: string[];
  current_price: number;
  resistance: number; // 52주 고가 — 서버에서 직접 계산 (AI가 지어내지 않음)
  support: number;     // 52주 저가 — 서버에서 직접 계산
  disclaimer: string;
  isCached: boolean;
  createdAt: string;
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
        // signal 필드가 없으면 구 스키마(opinion/target_price 등) 캐시 → 재생성
        if (parsed?.sections && parsed?.signal) {
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

  // 3-1. 일별 차트 (최근 최대 100거래일) — 과거 유사 급등 이력 + 거래대금 배수 계산용
  // 실패해도 분석 자체는 진행하고 해당 데이터 블록만 생략
  let chart: Awaited<ReturnType<typeof fetchDailyChart>> = [];
  try {
    chart = await fetchDailyChart(ticker, '1Y');
  } catch (e) {
    console.warn('[ANALYSIS] 차트 조회 실패, 급등이력/거래대금배수 생략:', e instanceof Error ? e.message : e);
  }

  const surgeHistory          = chart.length ? computeSurgeHistory(chart) : null;
  const tradingValueMultiple  = chart.length ? computeTradingValueMultiple(chart) : null;
  const surgeHistoryBlock     = buildSurgeHistoryBlock(surgeHistory);
  const tradingValueBlock     = buildTradingValueBlock(tradingValueMultiple);

  // 4. Claude 분석
  const w52pos = info.week52High > 0
    ? Math.round(((price.price - info.week52Low) / (info.week52High - info.week52Low)) * 100)
    : null;

  const prompt = `아래 종목 데이터를 관찰된 사실 위주로 정리하고 반드시 JSON만 출력하세요. JSON 외 텍스트는 절대 포함하지 마세요.

## 종목 데이터
- 종목명: ${price.name} (${ticker})
- 현재가: ${price.price.toLocaleString()}원 (등락률 ${price.changeRate > 0 ? '+' : ''}${price.changeRate}%)
- 거래대금: ${price.tradingValue}
- 52주 고가: ${info.week52High.toLocaleString()}원 / 저가: ${info.week52Low.toLocaleString()}원${w52pos !== null ? ` (현재가 52주 레인지의 ${w52pos}% 위치)` : ''}
- 시가총액: ${info.marketCap} / PER: ${info.per || 'N/A'} / PBR: ${info.pbr || 'N/A'}

## 최근 뉴스
${newsBlock}

## 과거 유사 급등/급락 이력 (최근 약 5개월, 서버 계산값)
${surgeHistoryBlock}

## 거래대금 (서버 계산값)
${tradingValueBlock}

## 출력 형식 (JSON만)
{
  "signal": "매수세 우위" | "중립·관망" | "차익실현 관찰" | "매도세 우위",
  "summary": "관찰된 특징을 담은 한줄 (예: '외국인 수급 유입과 52주 저항선 부근 위치가 관찰됨') — 종목명 제외, 35자 이내, 지시형 표현 금지",
  "sections": [
    {
      "title": "📊 현재 시황",
      "points": [
        "주가 흐름과 맥락을 담은 문장 (예: '거래대금 X억원과 함께 기관·외인 동반 매수세가 관찰됨') — 50자 이내",
        "52주 위치와 기술적 의미 (예: '52주 고점 X원 대비 Y% 하단에 위치, 해당 구간은 과거 저항으로 작용해온 지점') — 50자 이내",
        "뉴스·이슈 반영 한줄 또는 생략 가능"
      ]
    },
    {
      "title": "🎯 관찰 포인트",
      "points": [
        "과거 유사 급등/급락 이력과 그 이후 가격 흐름 (예: 'X월 X일 +22% 급등 이후 5일간 -8% 반납' 또는 이력 없음을 명시) — 55자 이내",
        "거래대금 배수 관찰 (예: '오늘 거래대금은 최근 20일 평균 대비 X배' — 데이터 없으면 이 항목 생략) — 55자 이내",
        "추가 촉매 또는 뉴스 기반 관찰 — 55자 이내"
      ]
    },
    {
      "title": "⚠️ 리스크 요인",
      "points": [
        "리스크와 실제 영향까지 설명 (예: 'PER X배는 업종 평균 대비 Y배 수준으로, 실적 부진 시 밸류에이션 조정 가능성이 있다는 점이 관찰됨') — 60자 이내",
        "매크로·업황 리스크 (예: '환율 상승이 지속될 경우 수입 원가 부담이 커질 수 있다는 특징이 있음') — 60자 이내"
      ]
    },
    {
      "title": "📈 참고 지표",
      "points": [
        "저항선 관찰 (예: '52주 고점 X원 부근이 과거 저항선으로 작용해왔다는 특징이 있음') — 60자 이내",
        "지지선 관찰 (예: '52주 저점 X원 부근이 과거 지지선으로 작용해왔다는 특징이 있음') — 60자 이내",
        "과거 유사 급등 이력의 구체적 수치 재요약 또는 거래대금 배수 재요약 중 위 관찰 포인트에서 다루지 않은 쪽 — 50자 이내, 데이터 없으면 생략"
      ]
    }
  ],
  "tags": ["3~4개 핵심 키워드 (업종·테마·이슈 위주)"]
}

규칙:
- ${COMPLIANCE_PRINCIPLE}
- signal은 매수/매도 지시가 아니라 수급·가격 패턴에 대한 관찰 결과입니다 — 외국인·기관 매수세가 우위면 "매수세 우위", 매도세가 우위면 "매도세 우위", 단기 급등 후 차익실현 흐름이 관찰되면 "차익실현 관찰", 그 외에는 "중립·관망"을 선택하세요
- "참고 지표" 섹션은 목표가·손절가·진입전략 같은 지시형 문구를 쓰지 말고, 52주 고/저점이 과거 저항·지지로 작용해온 사실 서술과 위에서 제공된 과거 급등 이력·거래대금 배수 수치로만 구성하세요
- "정당화", "권고", "~하는 것이 좋습니다" 같은 결론형·권유형 단어를 쓰지 말고 "~라는 해석도 있습니다", "~라는 특징이 관찰됩니다" 형태를 사용하세요
- 각 point는 실제 데이터(주가·PER·52주가·거래대금·과거 급등 이력 등)를 인용해 구체적으로 작성
- 위에 제공된 수치 외의 "관찰됨", "일반적으로 참고하는 지표" 같은 모호한 일반론 문장은 절대 생성하지 말 것
- 제공되지 않은 데이터(섹터 비교, 동종업계 순위 등)에 대해서는 언급하지 말 것
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
    if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + text.slice(0, 100));

    const analysis = JSON.parse(jsonMatch[0]) as Omit<
      AnalysisResult,
      'current_price' | 'resistance' | 'support' | 'disclaimer' | 'isCached' | 'createdAt'
    >;

    const result: Omit<AnalysisResult, 'isCached'> = {
      ...analysis,
      current_price: price.price,
      resistance: info.week52High, // AI가 산출하지 않고 실제 52주 고가를 그대로 사용
      support: info.week52Low,     // AI가 산출하지 않고 실제 52주 저가를 그대로 사용
      disclaimer: INVESTMENT_DISCLAIMER,
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
        sentiment: signalToSentiment(result.signal),
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
