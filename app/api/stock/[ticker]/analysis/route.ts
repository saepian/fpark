import { NextRequest, NextResponse, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { fetchStockPrice, fetchStockInfo, fetchDailyChart } from '@/lib/kis-api';
import {
  computeSurgeHistory,
  computeTradingValueMultiple,
  buildSurgeHistoryBlock,
  buildTradingValueBlock,
  pickRelevantNews,
  buildNewsBlock,
} from '@/lib/stock-analysis-data';
import { COMPLIANCE_PRINCIPLE, INVESTMENT_DISCLAIMER, signalToSentiment, clampSignal, type Signal } from '@/lib/ai-compliance';
import { fetchNaverNews } from '@/lib/naver-news';
import { nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, withTemporalRetry } from '@/lib/ai-grounding';

export const dynamic = 'force-dynamic';
// 캐시 없이 매 요청마다 KIS + Claude를 호출 — 관측된 응답 시간이 16~21초로
// Vercel 기본 함수 타임아웃을 넘길 수 있어 명시적으로 늘림 (diagnosis, portfolio-diagnosis와 동일)
export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// 매 요청마다 동일한 고정 지침 — 프롬프트 캐싱 대상 (system 블록, cache_control 적용)
const STOCK_ANALYSIS_OUTPUT_INSTRUCTIONS = `## 출력 형식 (JSON만)
{
  "signal": "순유입 우위" | "중립·관망" | "차익실현 관찰" | "순유출 우위",
  "summary": "관찰된 특징을 담은 한줄 (예: '외국인 자금 유입에 52주 고점 근접 위치까지 겹쳐 부담으로 풀이됨') — 종목명 제외, 35자 이내, 지시형 표현 금지",
  "sections": [
    {
      "title": "📊 현재 시황",
      "points": [
        "주가 흐름과 맥락을 담은 문장 (예: '거래대금 X억원과 함께 기관·외인의 동반 자금 유입이 나타난 것으로 보임') — 50자 이내",
        "52주 위치의 사실 서술 (예: '52주 고점 X원 대비 Y% 낮은 수준에 위치, 과거 이 구간에서 상승 흐름이 둔화된 이력이 있음') — 50자 이내",
        "뉴스·이슈 반영 한줄 또는 생략 가능"
      ]
    },
    {
      "title": "🎯 관찰 포인트",
      "points": [
        "과거 급등/급락 이력 + 오늘 거래대금 배수를 함께 놓고, 이 둘이 같은 흐름의 연장인지 서로 모순되는 신호인지 판단해서 그 이유와 함께 제시 (예: 'X월 X일 +22% 급등 후 5일간 -8% 반납된 이력이 있는데, 오늘은 거래대금이 평균의 0.3배로 낮아 이번엔 그때와 달리 자금 유입이 약하다는 해석이 가능함') — 70자 이내, 이력 없으면 오늘 거래대금 배수만으로 판단",
        "위 판단과 뉴스·밸류에이션 중 하나를 더 연결해 종합 (예: 관련 뉴스 부재가 그 판단에 어떤 의미를 더하는지) — 65자 이내, 연결할 추가 데이터 없으면 생략"
      ]
    },
    {
      "title": "⚠️ 리스크 요인",
      "points": [
        "리스크와 실제 영향까지 설명 (예: 'PER X배는 업종 평균 대비 Y배 수준으로, 실적 부진 시 밸류에이션 조정 압력으로 이어질 수 있음') — 60자 이내",
        "매크로·업황 리스크 (예: '환율 상승이 지속될 경우 수입 원가 부담이 커질 수 있다는 점이 눈에 띔') — 60자 이내"
      ]
    },
    {
      "title": "📈 참고 지표",
      "points": [
        "52주 고가와 현재가의 위치 관계를 사실로 서술 (예: '52주 고점 X원은 현재가 대비 Y% 높은 수준으로, 과거 이 부근에서 상승세가 둔화된 이력이 있음') — 65자 이내, 저항선·매물대 같은 기술적 분석 용어 금지",
        "52주 저가와 현재가의 위치 관계를 사실로 서술 (예: '52주 저점 X원은 현재가 대비 Y% 낮은 수준으로, 최근 가격 흐름은 이 구간과 거리를 두고 있음') — 65자 이내, 지지선·지지 시험 같은 기술적 분석 용어 금지"
      ]
    }
  ],
  "tags": ["3~4개 핵심 키워드 (업종·테마·이슈 위주)"]
}

규칙:
- signal은 매매 지시가 아니라 수급·가격 패턴에 대한 관찰 결과입니다 — 외국인·기관의 순매수 자금 유입이 우위면 "순유입 우위", 순매도로 자금이 빠져나가는 흐름이 우위면 "순유출 우위", 단기 급등 후 차익실현 흐름이 관찰되면 "차익실현 관찰", 그 외에는 "중립·관망"을 선택하세요
- "참고 지표" 섹션은 목표가·손절가·진입전략·저항선·지지선·매물대 같은 기술적 분석/지시형 문구를 쓰지 말고, 52주 고/저점 대비 현재가의 위치 관계를 사실로 서술하고 그 의미에 대한 판단으로 구성하세요
- "정당화", "권고", "~하는 것이 좋습니다" 같은 결론형·권유형 단어를 쓰지 말고 관찰·해석형 문장을 사용하세요
- "~관찰됨", "~특징이 있음", "~것으로 나타남" 같은 동일한 종결 표현을 이 리포트 안에서 2회 이상 쓰지 말고, 문장마다 종결을 다양하게 바꾸세요 ("~로 보임", "~때문임", "~로 풀이됨", "~라는 점이 눈에 띔", 서술형 종결 등)
- 각 point는 실제 데이터(주가·PER·52주가·거래대금·과거 급등 이력 등)를 근거로 짧게 인용한 뒤, 반드시 그 다음 절에서 "그래서 무엇을 의미하는지" 판단을 이어가세요 — 근거만 있고 판단이 없는 문장은 출력하지 마세요
- 특히 "🎯 관찰 포인트" 섹션은 과거 급등 이력과 오늘 거래대금 배수처럼 제공된 데이터 포인트를 최소 2개 이상 서로 연결해 하나의 해석으로 종합하고, 두 신호가 같은 방향인지 상충하는지 명시하세요
- 데이터가 서로 다른 방향을 가리키면(예: 과거엔 반등했지만 오늘 거래대금은 낮음) 어느 신호에 더 비중을 두는지와 그 이유를 밝히세요
- 위에 제공된 수치 외의 "관찰됨", "일반적으로 참고하는 지표" 같은 모호한 일반론 문장은 절대 생성하지 말 것
- 제공되지 않은 데이터(섹터 비교, 동종업계 순위 등)에 대해서는 언급하지 말 것
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- 본문에서 현재가·52주 고가·52주 저가를 언급할 때는 위 "종목 데이터"에 제시된 숫자를 한 글자도 다르지 않게 그대로 쓰세요 — 익숙한 가격대와 다르다는 이유로 자릿수를 줄이거나 늘리지 말 것
- signal은 전체 분석과 일관성 있게 선택
- tags에는 "매수"/"매도"/"순매수"/"순매도" 같은 단어를 넣지 말 것
- JSON 키 순서 및 구조 변경 금지`;

export type { Signal };

export interface AnalysisResult {
  signal: Signal; // 내부 로그/집계용 — 화면에는 방향성 배지로 노출하지 않음(Paddle 심사 대응)
  summary: string;
  sections: { title: string; points: string[] }[];
  tags: string[];
  current_price: number;
  resistance: number; // 52주 고가 — 서버에서 직접 계산 (AI가 지어내지 않음)
  support: number;     // 52주 저가 — 서버에서 직접 계산
  tradingValueMultiple: number | null; // 오늘 거래대금 / 최근 20거래일 평균 — 순수 데이터 지표
  hasRelevantNews: boolean; // false면 UI에서 "최근 관련 뉴스 반영: 없음" 배지 표시
  disclaimer: string;
  createdAt: string;
}

// AI가 본문 서술에서 현재가·52주 고저가를 자기 기억 속 "익숙한" 가격대로 임의 보정해 쓰는 현상 방지.
// 구조화된 필드(current_price/resistance/support)는 서버가 직접 넣으므로 항상 정확하지만,
// 자유 텍스트(summary/points)는 AI 재량이라 유명 대형주에서 실측값과 다른 숫자를 쓰는 경우가 확인됨
// (예: SK하이닉스 — 실제 2,987,000원을 "298,700원"으로 서술).
function correctPriceMentions(
  result: AnalysisResult,
  ticker: string,
): AnalysisResult {
  const checks: { re: RegExp; truth: number; label: string }[] = [
    { re: /현재가\s*([\d,]+)\s*원/g, truth: result.current_price, label: '현재가' },
    { re: /52주\s*고[가점]\s*([\d,]+)\s*원/g, truth: result.resistance, label: '52주 고가' },
    { re: /52주\s*저[가점]\s*([\d,]+)\s*원/g, truth: result.support, label: '52주 저가' },
  ];

  const fixText = (text: string): string => {
    let fixed = text;
    for (const { re, truth, label } of checks) {
      if (!(truth > 0)) continue;
      fixed = fixed.replace(re, (match, numStr: string) => {
        const extracted = parseInt(numStr.replace(/,/g, ''), 10);
        if (!extracted || Math.abs(extracted - truth) / truth <= 0.05) return match;
        console.warn(
          `[ANALYSIS] ${ticker} ${label} 불일치 교정: "${extracted.toLocaleString()}원" → "${truth.toLocaleString()}원"`,
        );
        return match.replace(numStr, truth.toLocaleString());
      });
    }
    return fixed;
  };

  return {
    ...result,
    summary: fixText(result.summary),
    sections: result.sections.map((sec) => ({
      ...sec,
      points: sec.points.map(fixText),
    })),
  };
}


export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

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

  // 3. 관련 뉴스 — DB 캐시(articles) 조회는 유지하되, 중소형주는 DB에 거의 안 걸리므로
  // Naver 실시간 검색 결과를 보완적으로 병행하고 관련도 스코어링으로 상위 3건만 선별.
  // 종목명 단독 검색만으로는 실적 발표처럼 특정 이슈를 짚어야 하는 날에 다른 기사에
  // 밀려 못 잡는 경우가 있어(app/api/news/stock/[ticker]/route.ts와 동일한 원인으로
  // 2026-07-08 삼성전자 2분기 잠정실적 오서술 문제 조사 중 확인), 실적 관련 보조
  // 검색을 병행한다.
  const [{ data: dbNews }, ...naverResults] = await Promise.all([
    supabase
      .from('articles')
      .select('title, summary, published_at')
      .ilike('title', `%${price.name}%`)
      .not('summary', 'is', null)
      .order('published_at', { ascending: false })
      .limit(5),
    fetchNaverNews(price.name, { sort: 'date' }),
    fetchNaverNews(`${price.name} 잠정실적`, { sort: 'date' }),
    fetchNaverNews(`${price.name} 실적발표`, { sort: 'date' }),
  ]);

  const seenNaverTitle = new Set<string>();
  const naverItems = naverResults.flatMap((r) => r.items).filter((item) => {
    if (seenNaverTitle.has(item.title)) return false;
    seenNaverTitle.add(item.title);
    return true;
  });

  const newsCandidates = [
    ...(dbNews ?? []).map((n) => ({
      title:   n.title,
      summary: n.summary ?? undefined,
      date:    n.published_at ? new Date(n.published_at).toLocaleDateString('ko-KR') : undefined,
    })),
    ...naverItems.map((n) => ({ title: n.title, summary: n.description })),
  ];
  const relevantNews = pickRelevantNews(newsCandidates, price.name, price.sector, 3);
  const newsBlock = buildNewsBlock(relevantNews);

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

## 기준 시각
현재 시각: ${nowKstString()}

## 종목 데이터
※ 현재가·52주 고저가는 서버가 직접 실측한 값입니다. 본인이 알고 있는 시세감이나 관례적인 가격대와 다르더라도
임의로 보정하거나 축소·확대해서 쓰지 말고, 아래 숫자를 본문에서도 그대로 인용하세요.
- 종목명: ${price.name} (${ticker})
- 현재가: ${price.price.toLocaleString()}원 (등락률 ${price.changeRate > 0 ? '+' : ''}${price.changeRate}%)
- 거래대금: ${price.tradingValue}
- 52주 고가: ${info.week52High.toLocaleString()}원 / 저가: ${info.week52Low.toLocaleString()}원${w52pos !== null ? ` (현재가 52주 레인지의 ${w52pos}% 위치)` : ''}
- 시가총액: ${info.marketCap} / PER: ${info.per || 'N/A'} / PBR: ${info.pbr || 'N/A'}

## 최근 뉴스 (${buildNewsFreshnessLine(relevantNews)})
${newsBlock}

## 과거 유사 급등/급락 이력 (최근 약 5개월, 서버 계산값)
${surgeHistoryBlock}

## 거래대금 (서버 계산값)
${tradingValueBlock}

위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 형식과 규칙에 따라 정리하세요.`;

  const newsText = relevantNews.map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');

  try {
    type ParsedAnalysis = Omit<
      AnalysisResult,
      'current_price' | 'resistance' | 'support' | 'tradingValueMultiple' | 'disclaimer' | 'createdAt'
    >;

    const analysis = await withTemporalRetry<ParsedAnalysis>(
      async () => {
        const message = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: [
            { type: 'text', text: COMPLIANCE_PRINCIPLE },
            { type: 'text', text: STOCK_ANALYSIS_OUTPUT_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: prompt }],
        });
        const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + text.slice(0, 100));
        const parsed = JSON.parse(jsonMatch[0]) as ParsedAnalysis;
        const reportText = [parsed.summary, ...parsed.sections.flatMap((s) => s.points)].join(' ');
        return { parsed, reportText };
      },
      newsText,
      '[ANALYSIS]',
    );

    let result: AnalysisResult = {
      ...analysis,
      signal: clampSignal(analysis.signal), // AI가 지시된 4개 값을 벗어날 경우 대비
      current_price: price.price,
      resistance: info.week52High, // AI가 산출하지 않고 실제 52주 고가를 그대로 사용
      support: info.week52Low,     // AI가 산출하지 않고 실제 52주 저가를 그대로 사용
      tradingValueMultiple: tradingValueMultiple?.valid ? tradingValueMultiple.multiple : null,
      hasRelevantNews: relevantNews.length > 0,
      disclaimer: INVESTMENT_DISCLAIMER,
      createdAt: new Date().toISOString(),
    };

    // 4-1. 본문 서술 중 현재가/52주 고저가 불일치 교정 (저장 전에 적용)
    result = correctPriceMentions(result, ticker);

    // 5. 히스토리/로그 목적으로 저장 (캐시로 재사용하지 않음 — 응답을 기다리지 않는 비동기 저장).
    // 예전엔 await 없이 던져놓기만 해서, 응답이 나간 직후 서버리스 실행 컨텍스트가 얼어붙으며
    // 이 fetch가 중간에 끊겨 "TypeError: fetch failed"가 간헐적으로 발생했다(Vercel 로그에서
    // 다른 동시 요청의 로그 블록에 섞여 나타나 stock-alerts 크론 문제로 오인되기도 했음).
    // after()로 등록하면 응답은 그대로 즉시 나가면서도, 런타임이 이 작업이 끝날 때까지
    // 실행 컨텍스트를 유지해준다.
    after(async () => {
      const { error } = await supabase
        .from('stock_analysis')
        .upsert({
          ticker,
          summary: result.summary,
          details: JSON.stringify(result),
          keywords: result.tags,
          sentiment: signalToSentiment(result.signal),
          created_at: result.createdAt,
        });
      if (error) console.error('[ANALYSIS] 결과 저장 실패:', error.message);
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error('[ANALYSIS] Claude 오류:', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
