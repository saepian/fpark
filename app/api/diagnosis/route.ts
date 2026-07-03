import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchStockPrice, fetchIndexRangeChange, fetchDailyChart } from '@/lib/kis-api';
import {
  collectStockAnalysisData,
  buildTechnicalBlock,
  buildInvestorBlock,
  buildNewsBlock,
  pickRelevantNews,
} from '@/lib/stock-analysis-data';
import { COMPLIANCE_PRINCIPLE } from '@/lib/ai-compliance';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60;

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.then(s => s.getAll()),
        setAll: (pairs) => cookieStore.then(s => {
          pairs.forEach(({ name, value, options }) => s.set(name, value, options));
        }),
      },
    },
  );
}

async function fetchNaverNews(stockName: string) {
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(stockName)}&display=5`,
      {
        headers: {
          'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID ?? '',
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET ?? '',
        },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.items ?? []).map((item: any) => ({
      title:       String(item.title ?? '').replace(/<[^>]*>/g, ''),
      description: String(item.description ?? '').replace(/<[^>]*>/g, ''),
      url:         String(item.originallink || item.link || ''),
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { count } = await supabase
    .from('stock_diagnosis')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', `${todayKst}T00:00:00+09:00`);

  const isAdmin = user.email === process.env.ADMIN_EMAIL;
  return NextResponse.json({ count: count ?? 0, remaining: isAdmin ? 999 : Math.max(0, 1 - (count ?? 0)) });
}

export async function POST(request: NextRequest) {
  // 최상위 try-catch: 어느 단계에서든 예외 발생 시 반드시 JSON 반환
  try {
    const supabase = makeSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { count } = await supabase
      .from('stock_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', `${todayKst}T00:00:00+09:00`);

    const isAdmin = user.email === process.env.ADMIN_EMAIL;
    if (!isAdmin && (count ?? 0) >= 1) {
      return NextResponse.json({ error: '오늘 무료 진단을 이미 사용했습니다.' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { ticker, name, avgPrice, quantity, buyDate } = body as {
      ticker?: string; name?: string; avgPrice?: number; quantity?: number; buyDate?: string;
    };

    if (!ticker || !name || !avgPrice || !quantity) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    // ── 1단계: 데이터 병렬 수집 ─────────────────────────────────────────────
    console.log('[DIAGNOSIS] 1. 데이터 수집 시작', { ticker, name });

    const [priceResult, analysisResult, naverNewsResult, chartResult] = await Promise.allSettled([
      fetchStockPrice(ticker),
      collectStockAnalysisData(ticker, name),
      fetchNaverNews(name),
      fetchDailyChart(ticker, '1M'),
    ]);

    console.log('[DIAGNOSIS] 2. 데이터 수집 완료', {
      price:    priceResult.status,
      analysis: analysisResult.status,
      news:     naverNewsResult.status,
      chart:    chartResult.status,
      priceErr:    priceResult.status    === 'rejected' ? String(priceResult.reason)    : null,
      analysisErr: analysisResult.status === 'rejected' ? String(analysisResult.reason) : null,
      newsErr:     naverNewsResult.status === 'rejected' ? String(naverNewsResult.reason): null,
      chartErr:    chartResult.status    === 'rejected' ? String(chartResult.reason)    : null,
    });

    // ── 2단계: 결과 추출 ──────────────────────────────────────────────────────
    const priceData    = priceResult.status    === 'fulfilled' ? priceResult.value    : null;
    const analysisData = analysisResult.status === 'fulfilled' ? analysisResult.value : null;
    const naverNewsRaw = naverNewsResult.status === 'fulfilled' ? naverNewsResult.value : [];
    const chartData    = chartResult.status    === 'fulfilled' ? chartResult.value    : [];

    const currentPrice = (priceData?.price && priceData.price > 0)
      ? priceData.price
      : (analysisData?.currentPrice && analysisData.currentPrice > 0)
        ? analysisData.currentPrice
        : Number(avgPrice);

    const stockName = (priceData?.name && priceData.name !== ticker)
      ? priceData.name
      : (analysisData?.stockName || String(name));

    console.log('[DIAGNOSIS] 3. 가격·종목명', { currentPrice, stockName });

    // ── 3단계: 프롬프트 블록 조립 ─────────────────────────────────────────────
    let technicalBlock = '데이터 없음';
    let investorBlock  = '데이터 없음';
    let newsBlockStr   = '관련 뉴스 없음';

    try {
      if (analysisData) technicalBlock = buildTechnicalBlock(analysisData);
    } catch (e) { console.error('[DIAGNOSIS] buildTechnicalBlock 실패:', e); }

    try {
      if (analysisData) investorBlock = buildInvestorBlock(analysisData);
    } catch (e) { console.error('[DIAGNOSIS] buildInvestorBlock 실패:', e); }

    // DB 뉴스 + Naver 뉴스를 한 풀로 모은 뒤, 종목명·업종 키워드로 관련도 상위 2~3개만 선별
    const newsCandidates = [
      ...(analysisData?.news ?? []).map(n => ({ title: n.title, summary: n.summary, date: n.date, url: n.url })),
      ...(Array.isArray(naverNewsRaw) ? naverNewsRaw : []).map((n: { title?: string; description?: string; url?: string }) => ({
        title:   String(n.title ?? ''),
        summary: String(n.description ?? ''),
        url:     String(n.url ?? ''),
      })),
    ];
    const relevantNews = pickRelevantNews(newsCandidates, stockName, analysisData?.sector, 3);
    const hasRelevantNews = relevantNews.length > 0;

    try {
      newsBlockStr = buildNewsBlock(relevantNews);
    } catch (e) { console.error('[DIAGNOSIS] buildNewsBlock 실패:', e); }

    const combinedNews = relevantNews.map(n => ({
      title:       n.title,
      description: n.summary ?? '',
      url:         n.url ?? '',
    }));

    const changeRate = (priceData && typeof priceData.changeRate === 'number') ? priceData.changeRate : 0;
    const isBigMove   = Math.abs(changeRate) >= 5;

    const newsInstruction = hasRelevantNews
      ? '위 뉴스는 이 종목과 관련도가 높다고 판단되어 매칭된 실제 기사입니다. summary·reasons를 작성할 때 반드시 이 뉴스를 근거로 최근 주가 변동 원인을 설명하고, 뉴스에 없는 내용을 지어내지 마세요.'
      : '관련 뉴스가 매칭되지 않았습니다. 이 경우 뉴스를 근거로 등락 원인을 지어내지 말고, summary에 "특별한 뉴스 없이 수급·기술적 요인으로 추정됩니다" 취지의 문구를 명확히 포함해 뉴스 기반 분석이 아니라는 점을 밝히세요.';

    const profitRate   = currentPrice > 0 && avgPrice > 0
      ? ((currentPrice - avgPrice) / avgPrice * 100)
      : 0;
    const profitAmount = (currentPrice - avgPrice) * quantity;
    const holdDays = buyDate
      ? Math.floor((Date.now() - new Date(buyDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // ── 벤치마크 비교: 매수일이 있을 때만 계산 (판단 없이 사실 비교 수치만) ──────
    const market = priceData?.market ?? 'KOSPI';
    let benchmark: {
      indexName: 'KOSPI' | 'KOSDAQ'; indexChangeRate: number;
      stockProfitRate: number; fromDate: string; toDate: string;
    } | null = null;

    if (buyDate) {
      try {
        const indexCode = market === 'KOSDAQ' ? '1001' : '0001';
        const idx = await fetchIndexRangeChange(indexCode, new Date(buyDate), new Date());
        if (idx) {
          benchmark = {
            indexName:       market,
            indexChangeRate: parseFloat(idx.changeRate.toFixed(2)),
            stockProfitRate: parseFloat(profitRate.toFixed(2)),
            fromDate:        idx.startDate,
            toDate:          idx.endDate,
          };
        }
      } catch (e) {
        console.error('[DIAGNOSIS] 벤치마크 비교 실패:', e);
      }
    }

    // ── 4단계: Claude 분석 ────────────────────────────────────────────────────
    const resistance = analysisData?.week52High ?? 0;
    const support     = analysisData?.week52Low  ?? 0;
    const benchmarkLine = benchmark
      ? `\n- 벤치마크(참고용 수치 비교, 판단 근거로 쓰지 말 것): 이 종목 수익률 ${benchmark.stockProfitRate >= 0 ? '+' : ''}${benchmark.stockProfitRate}% vs 같은 기간 ${benchmark.indexName} 등락률 ${benchmark.indexChangeRate >= 0 ? '+' : ''}${benchmark.indexChangeRate}% (${benchmark.fromDate}~${benchmark.toDate})`
      : '';

    const prompt = `아래 실제 데이터를 기반으로 관찰된 사실 위주로 정리하여 반드시 JSON만 출력하세요.

## 종목 기본정보
- 종목명: ${stockName} (${ticker})
- 현재가: ${currentPrice.toLocaleString()}원
- 매입 평균가: ${Number(avgPrice).toLocaleString()}원
- 보유 수량: ${quantity}주
- 수익률: ${profitRate >= 0 ? '+' : ''}${profitRate.toFixed(2)}%
- 평가손익: ${profitAmount >= 0 ? '+' : ''}${Math.round(profitAmount).toLocaleString()}원${holdDays !== null ? `\n- 보유 기간: ${holdDays}일` : ''}${isBigMove ? `\n- ⚠️ 금일 등락률: ${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}% (급${changeRate >= 0 ? '등' : '락'} — 원인 관찰 필요)` : ''}${benchmarkLine}

## 기술적 지표 및 밸류에이션
${technicalBlock}
${resistance > 0 ? `- 52주 고점: ${resistance.toLocaleString()}원` : ''}
${support > 0 ? `- 52주 저가: ${support.toLocaleString()}원` : ''}

## 수급 동향 (최근 5영업일)
${investorBlock}

## 관련 뉴스 (${hasRelevantNews ? '관련도 높은 기사만 선별' : '매칭 결과'})
${newsBlockStr}
${newsInstruction}

분석 포인트:
1. 52주 위치와 PER/PBR으로 현재 주가 레벨에 대한 관찰 (과매수/과매도 구간 여부 관찰)
2. 외국인·기관 5일 수급 추이 관찰
3. ${isBigMove ? `금일 ${changeRate >= 0 ? '급등' : '급락'}(${changeRate.toFixed(2)}%)의 배경을 위 뉴스 섹션 지침에 따라 명확히 서술 (뉴스 근거 vs 수급/기술적 추정 구분)` : '실적·뉴스와 결합하여 업황 및 촉매 요인 관찰'}
4. 보유 기간·수익률과 함께 관찰된 특징 정리 (매매 전략을 지시하지 말 것)
5. 수급 동향에서 외국인·기관과 개인의 매매 방향이 서로 반대인지 확인 (반대인 경우에만 그 대립 구도를 summary에 명시)
6. 뉴스 섹션의 논조(긍정/부정)와 실제 주가 흐름(금일 등락률·수익률)이 서로 반대 방향인지 확인 (괴리가 있는 경우에만 summary에서 그 점을 강조)

## 출력 JSON 스키마 (반드시 아래 구조 그대로 출력)
{
  "summary": "【450자 이내, 아래 구조로 작성 — 이 섹션만 읽어도 종목의 핵심 그림이 그려지도록 다른 섹션(수급·리스크·기회 요인)의 데이터를 적극 재활용해 풍부하게 작성】[1] 첫 문장: 현재 상태를 관찰형으로 — 예) '지금 삼성전자는 수익이 충분히 난 상태이며 외국인 자금 유출이 나타나고 있습니다.' [2] 밸류에이션 한 줄 코멘트: PER/PBR이 업종 평균 대비 어느 수준인지 관찰형으로 — 예) 'PER 44배 수준은 반도체 업종 평균 대비 높은 밸류에이션 구간으로 풀이됩니다.' [3] 이유 2~3가지를 일반인이 이해할 수 있는 쉬운 말로 — 예) '외국인 자금이 5일 연속 대규모로 빠져나가고 있는데, 이건 보통 큰손들이 차익 실현에 나설 때 흔히 보이는 패턴입니다.' [4] (외국인·기관과 개인의 자금 방향이 실제로 반대일 때만) 그 대립 구도를 사실로만 명시 — 예) '외국인·기관 자금은 빠져나가는 반면 개인 자금은 반대로 유입되는 구도를 보입니다.' 방향이 같으면 이 문장은 생략. 이 문장 뒤에 '향후 어느 쪽이 우위를 점하는지가 가격 방향을 좌우한다' 같이 미래 가격을 예측하는 문구를 절대 덧붙이지 마세요. [5] (뉴스 논조와 실제 주가 흐름이 실제로 반대일 때만) 그 괴리를 강조 — 예) '~라는 긍정적 뉴스에도 불구하고 실제로는 하락한 점은 뉴스 외 다른 요인이 작용했을 가능성을 시사합니다.' 괴리가 없으면 이 문장은 생략. [6] 데이터 사실로 마무리 — 예) '현재 52주 고점·저점 대비 위치와 수급 방향은 이와 같이 관찰됩니다.' 결론을 유도하거나 '투자자들이 참고한다'는 식의 권유성 마무리 금지. 금지: 매수/매도/홀딩 같은 지시나 권유, '~하세요'/'~하는 게 좋습니다'/'권고'/'~전략이 현실적입니다' 같은 1인칭 조언 문장, 목표가·손절가 언급, 저항선·지지선·매물대 같은 기술적 분석 용어, '가격 방향', '우위를 점하는지' 같은 미래 가격 예측 표현, ①②③ 번호 나열, 데이터 단순 나열, [4][5]에 해당 패턴이 없는데 억지로 만들어 넣기. 스타일: 편하게 설명하는 관찰형 어조를 쓰되, 위 예시들처럼 문장마다 종결 표현을 다양하게 바꾸고 같은 어미를 반복하지 마세요",
  "reasons": ["관찰된 근거 1 (수치 포함)", "관찰된 근거 2", "관찰된 근거 3"],
  "technicalAnalysis": ["가격 위치 관찰 1 (52주 고/저점 대비 위치 — 저항선·지지선 용어 없이 '몇 % 높은/낮은 수준'으로 서술)", "가격 위치 관찰 2 (거래량 수준)"],
  "riskFactors": ["리스크 요인 1 (수치 포함)", "리스크 요인 2", "리스크 요인 3"],
  "opportunityFactors": ["관찰된 긍정 요인 1을 사실로만 서술 — 예) 'KB증권이 영업이익 추정치를 상향했고, 청주 투자 계획이 발표됐습니다' (수치 포함, '추가 상승 여력을 기대', '~라는 신호로 해석될 수 있다' 같이 향후 주가를 암시하는 결론 금지)", "요인 2 (동일 기준)", "요인 3 (동일 기준)"],
  "institutionalFlow": "기관 수급 동향 상세 관찰 (5일 추이·누적 규모·업종 의미, 2-3문장, '순매수 우위' 같은 방향성 판단 표현 대신 관찰된 유입/유출 규모를 그대로 서술)",
  "foreignFlow": "외국인 수급 동향 상세 관찰 (5일 추이·글로벌 매크로 관점, 2-3문장, '순매수 우위' 같은 방향성 판단 표현 대신 관찰된 유입/유출 규모를 그대로 서술)",
  "flowPercentage": 50,
  "shortTermOutlook": "단기 관찰 변수 — 현재 진행 중인 수급/이벤트 요인 중 앞으로 방향이 바뀔 수 있는 지점을 사실 나열형으로 서술 (예: '외국인 자금은 5일째 유출 중이며, 기관은 오늘 하루 대규모로 유입했습니다. 이 두 흐름이 계속될지는 아직 확인되지 않았습니다.') — '주가 방향이 갈릴 수 있다', '~구간이다', '상승/하락 여력' 같이 가격 움직임을 예측하는 표현 절대 금지, 목표가·저항선·지지선 언급 금지, 2문장",
  "midTermOutlook": "중기 관찰 변수 — 업황·실적 관련 사실을 나열하되 특정 가격 수준이나 방향을 예측하지 않음 (예: '메모리 공급 부족 전망과 대규모 투자 계획이 발표된 상태이며, 실제 실적 개선 여부는 다음 분기 실적에서 확인될 예정입니다.') — 가격 방향 예측·목표가·저항선·지지선 언급 절대 금지, 2문장"
}

위 JSON 스키마를 반드시 준수하세요. 각 필드는 반드시 포함되어야 합니다.
규칙:
- ${COMPLIANCE_PRINCIPLE}
- reasons, technicalAnalysis, riskFactors, opportunityFactors는 반드시 문자열 배열 (JSON array)
- flowPercentage는 반드시 숫자 타입, 0~100 사이 정수 (외국인·기관 합산 순매수 강도 관찰치)
- "목표가", "손절가", "매수 추천", "매도 추천", "권고", "정당화", "저항선", "지지선", "매물대", "지지 시험", "가격 방향", "우위를 점하는지", "상승 여력을 기대", "신호로 해석" 단어·표현을 사용하지 마세요
- opportunityFactors·shortTermOutlook·midTermOutlook은 관찰된 사실만 서술하고, 그 사실이 앞으로 주가에 어떤 영향을 줄지 예측하거나 암시하지 마세요
- 52주 고점/저점을 언급할 때는 위에 제공된 수치를 그대로 활용하세요 (임의의 가격을 새로 만들지 마세요)${benchmark ? `\n- 벤치마크 수치는 summary에서 판단 없이 사실 비교로만 1회 언급하세요 (예: "같은 기간 ${benchmark.indexName}는 ${benchmark.indexChangeRate}%로, 이 종목이 시장 대비 ${(benchmark.stockProfitRate - benchmark.indexChangeRate) >= 0 ? '+' : ''}${(benchmark.stockProfitRate - benchmark.indexChangeRate).toFixed(2)}%p ${benchmark.stockProfitRate >= benchmark.indexChangeRate ? '더 상승' : '더 하락'}한 셈임" 정도의 사실 서술은 가능하나 "그래서 ~해야 한다"는 연결 금지)` : ''}
- 순수 JSON만 출력하고 다른 텍스트는 절대 포함하지 마세요.
- 마크다운 코드블록(\`\`\`json), 설명 텍스트, preamble 없이 { 로 시작하는 JSON만 출력하세요.`;

    console.log('[DIAGNOSIS] 4. Claude 분석 시작');

    const message = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 3500,
      system: COMPLIANCE_PRINCIPLE,
      messages: [{ role: 'user', content: prompt }],
    });

    console.log('[DIAGNOSIS] 5. Claude 응답 수신');

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
    // 마크다운 코드펜스 제거 후 JSON 추출
    const cleaned   = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    // fallback 결과 생성 헬퍼 (JSON 파싱 불가 시 최소한의 데이터라도 반환)
    const buildFallback = (errReason: string) => ({
      summary:            rawText.slice(0, 600).trim() || 'AI 분석 결과를 가져오는 중 형식 오류가 발생했습니다.',
      currentPrice:       Math.round(currentPrice),
      avgPrice:           Math.round(Number(avgPrice)),
      quantity:           Number(quantity),
      profitRate:         parseFloat(profitRate.toFixed(2)),
      profitAmount:       Math.round(profitAmount),
      reasons:            [`AI 응답 형식 오류 (${errReason})`, '잠시 후 다시 시도해주세요.'],
      resistance:         Math.round(resistance),
      support:            Math.round(support),
      benchmark,
      institutionalFlow:  '응답 형식 오류로 분석 불가',
      foreignFlow:        '응답 형식 오류로 분석 불가',
      technicalAnalysis:  ['응답 형식 오류로 분석 불가'],
      riskFactors:        ['응답 형식 오류로 리스크 요인 제공 불가'],
      opportunityFactors: ['응답 형식 오류로 기회 요인 제공 불가'],
      flowType:           'NEUTRAL' as const,
      flowPercentage:     50,
      news:               combinedNews,
      newsBasis:          (hasRelevantNews ? 'news' : 'estimated') as 'news' | 'estimated',
    });

    if (!jsonMatch) {
      console.error('[DIAGNOSIS] JSON 없음, 원문 앞 300자:', rawText.slice(0, 300));
      return NextResponse.json(buildFallback('JSON 없음'));
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('[DIAGNOSIS] JSON.parse 실패:', e, jsonMatch[0].slice(0, 300));
      return NextResponse.json(buildFallback('JSON 파싱 실패'));
    }

    // 배열 필드 방어적 정규화 (Claude가 string으로 반환할 경우 변환)
    const toArr = (v: unknown): string[] => {
      if (Array.isArray(v)) return (v as unknown[]).map(String).filter(Boolean);
      if (typeof v === 'string' && v)
        return v.split(/\n/).map(s => s.replace(/^[-·•\d]+[.)]\s*/, '').trim()).filter(Boolean);
      return [];
    };

    // flowType·flowPercentage: 실제 KIS 수급 데이터 우선
    // net(외국인+기관 순매수, 억원)을 절대금액으로 캡핑하면 대형주는 항상 상한(95%)에 붙어
    // 변별력이 없으므로, 최근 20거래일 평균 거래대금 대비 비율로 정규화한다.
    // 문턱을 넘겨도 값이 클수록 95%에 더 가까워지도록 tanh로 부드럽게 포화시킨다.
    let flowType: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let flowPercentage: number = typeof result.flowPercentage === 'number' ? result.flowPercentage : 50;

    if (analysisData?.investorLatest) {
      const { foreign, institution } = analysisData.investorLatest;
      const net = foreign.amount + institution.amount; // 억원
      if (Math.abs(net) > 10) {
        flowType = net > 0 ? 'BUY' : 'SELL';

        const recentDays = chartData.slice(-20).filter(d => d.volume > 0 && d.close > 0);
        const avgTradingValue = recentDays.length > 0
          ? recentDays.reduce((sum, d) => sum + d.volume * d.close, 0) / recentDays.length // 원
          : 0;

        if (avgTradingValue > 0) {
          const netWon    = net * 1e8;                      // 억원 → 원
          const ratio     = Math.abs(netWon) / avgTradingValue; // 거래대금 대비 순매수 비율 (크기만)
          const intensity = Math.tanh(ratio * 10);          // 0~1 범위로 부드럽게 포화
          flowPercentage  = Math.round(25 + intensity * 70); // 25~95 (percent는 방향과 무관한 강도, 방향은 flowType이 담당)
        } else {
          // 거래대금 데이터를 못 가져온 경우 기존 절대금액 캡 방식으로 폴백
          flowPercentage = Math.round(Math.min(Math.abs(net) / 1000 * 70 + 25, 95));
        }
      }
    }

    const finalResult = {
      // 서버 계산 수치 (Claude 응답 무시)
      currentPrice:  Math.round(currentPrice),
      avgPrice:      Math.round(Number(avgPrice)),
      quantity:      Number(quantity),
      profitRate:    parseFloat(profitRate.toFixed(2)),
      profitAmount:  Math.round(profitAmount),
      news:          combinedNews,
      newsBasis:     (hasRelevantNews ? 'news' : 'estimated') as 'news' | 'estimated',
      flowType,
      flowPercentage,
      resistance:    Math.round(resistance), // AI가 산출하지 않고 실제 52주 고가를 그대로 사용
      support:       Math.round(support),    // AI가 산출하지 않고 실제 52주 저가를 그대로 사용
      benchmark,     // 서버 계산 — KOSPI/KOSDAQ 등락률 비교 (매수일 있을 때만)
      // Claude 응답 필드 (정규화)
      summary:            typeof result.summary           === 'string' ? result.summary           : '',
      reasons:            toArr(result.reasons),
      technicalAnalysis:  toArr(result.technicalAnalysis),
      riskFactors:        toArr(result.riskFactors),
      opportunityFactors: toArr(result.opportunityFactors),
      institutionalFlow:  typeof result.institutionalFlow === 'string' ? result.institutionalFlow : '',
      foreignFlow:        typeof result.foreignFlow       === 'string' ? result.foreignFlow       : '',
      shortTermOutlook:   typeof result.shortTermOutlook  === 'string' ? result.shortTermOutlook  : undefined,
      midTermOutlook:     typeof result.midTermOutlook    === 'string' ? result.midTermOutlook    : undefined,
    };

    // DB 저장 (실패해도 결과 반환)
    try {
      await supabase.from('stock_diagnosis').insert({
        user_id:   user.id,
        ticker,
        name:      stockName,
        avg_price: avgPrice,
        quantity,
        buy_date:  buyDate || null,
        result:    finalResult,
      });
      console.log('[DIAGNOSIS] 6. DB 저장 완료');
    } catch (dbErr) {
      console.error('[DIAGNOSIS] DB 저장 실패 (결과는 반환):', dbErr);
    }

    return NextResponse.json(finalResult);

  } catch (e) {
    console.error('[DIAGNOSIS] 최상위 예외:', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
