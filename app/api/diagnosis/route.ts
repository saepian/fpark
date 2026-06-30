import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchStockPrice } from '@/lib/kis-api';
import {
  collectStockAnalysisData,
  buildTechnicalBlock,
  buildInvestorBlock,
  buildNewsBlock,
} from '@/lib/stock-analysis-data';

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

  const isAdmin = user.email === 'saepian2@gmail.com';
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

    const isAdmin = user.email === 'saepian2@gmail.com';
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

    const [priceResult, analysisResult, naverNewsResult] = await Promise.allSettled([
      fetchStockPrice(ticker),
      collectStockAnalysisData(ticker, name),
      fetchNaverNews(name),
    ]);

    console.log('[DIAGNOSIS] 2. 데이터 수집 완료', {
      price:    priceResult.status,
      analysis: analysisResult.status,
      news:     naverNewsResult.status,
      priceErr:    priceResult.status    === 'rejected' ? String(priceResult.reason)    : null,
      analysisErr: analysisResult.status === 'rejected' ? String(analysisResult.reason) : null,
      newsErr:     naverNewsResult.status === 'rejected' ? String(naverNewsResult.reason): null,
    });

    // ── 2단계: 결과 추출 ──────────────────────────────────────────────────────
    const priceData    = priceResult.status    === 'fulfilled' ? priceResult.value    : null;
    const analysisData = analysisResult.status === 'fulfilled' ? analysisResult.value : null;
    const naverNewsRaw = naverNewsResult.status === 'fulfilled' ? naverNewsResult.value : [];

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

    try {
      newsBlockStr = buildNewsBlock(analysisData?.news ?? [], naverNewsRaw);
    } catch (e) { console.error('[DIAGNOSIS] buildNewsBlock 실패:', e); }

    const dbNewsForResult = (analysisData?.news ?? []).map(n => ({
      title:       n.title,
      description: n.summary ?? '',
      url:         n.url ?? '',
    }));
    const naverNewsForResult = (Array.isArray(naverNewsRaw) ? naverNewsRaw : []).map(
      (n: { title?: string; description?: string; url?: string }) => ({
        title:       String(n.title ?? ''),
        description: String(n.description ?? ''),
        url:         String(n.url ?? ''),
      }),
    );
    const combinedNews = [...dbNewsForResult, ...naverNewsForResult].slice(0, 5);

    const profitRate   = currentPrice > 0 && avgPrice > 0
      ? ((currentPrice - avgPrice) / avgPrice * 100)
      : 0;
    const profitAmount = (currentPrice - avgPrice) * quantity;
    const holdDays = buyDate
      ? Math.floor((Date.now() - new Date(buyDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // ── 4단계: Claude 분석 ────────────────────────────────────────────────────
    const prompt = `당신은 15년 경력의 국내 주식 전문 애널리스트입니다. 아래 실제 데이터를 기반으로 심층 분석하여 반드시 JSON만 출력하세요.

## 종목 기본정보
- 종목명: ${stockName} (${ticker})
- 현재가: ${currentPrice.toLocaleString()}원
- 매수 평균가: ${Number(avgPrice).toLocaleString()}원
- 보유 수량: ${quantity}주
- 수익률: ${profitRate >= 0 ? '+' : ''}${profitRate.toFixed(2)}%
- 평가손익: ${profitAmount >= 0 ? '+' : ''}${Math.round(profitAmount).toLocaleString()}원${holdDays !== null ? `\n- 보유 기간: ${holdDays}일` : ''}

## 기술적 지표 및 밸류에이션
${technicalBlock}

## 수급 동향 (최근 5영업일)
${investorBlock}

## 관련 뉴스 (최근)
${newsBlockStr}

분석 포인트:
1. 52주 위치와 PER/PBR으로 현재 주가 레벨 평가 (과매수/과매도 여부)
2. 외국인·기관 5일 수급 추이로 스마트머니 방향 판단
3. 실적·뉴스와 결합하여 업황 및 촉매 요인 분석
4. 보유 기간·수익률을 고려한 최적 대응 전략 (목표가·손절가 수치 근거 포함)

## 출력 JSON 스키마 (반드시 아래 구조 그대로 출력)
{
  "recommendation": "홀딩",
  "summary": "【300자 이내, 아래 3단 구조로 작성】[1] 첫 문장: 결론부터 — 지금 이 종목을 어떻게 해야 할지 한 줄로 명확하게. 예) '지금 삼성전자는 수익이 충분히 났고 외국인들이 빠지고 있어서, 일부 팔아두는 게 좋아 보입니다.' [2] 이유 2~3가지를 일반인이 이해할 수 있는 쉬운 말로 풀어서 설명. 예) '외국인들이 5일 연속 대규모로 팔고 있는데, 이건 보통 큰손들이 차익 실현에 나선다는 신호예요.' [3] 지금 당장 어떻게 하면 좋을지 구체적 행동 제안. 예) '보유 물량의 30% 정도만 팔고 나머지는 목표가 X만원까지 기다려보는 전략이 좋을 것 같습니다.' 금지: ①②③ 번호 나열, PER·PBR·EPS 등 전문용어 그대로 쓰기(쓴다면 괄호로 쉬운 설명 추가), 데이터 단순 나열. 스타일: 친한 전문가 친구가 편하게 말해주는 어조",
  "targetPrice": ${Math.round(currentPrice * 1.15)},
  "stopLoss": ${Math.round(currentPrice * 0.92)},
  "reasons": ["추천 이유 1 (수치 근거 포함)", "추천 이유 2", "추천 이유 3"],
  "technicalAnalysis": ["기술적 분석 1 (52주 위치·지지선·저항선)", "기술적 분석 2 (거래량·모멘텀)"],
  "riskFactors": ["리스크 요인 1 (수치 포함)", "리스크 요인 2", "리스크 요인 3"],
  "opportunityFactors": ["기회 요인 1 (수치 포함)", "기회 요인 2", "기회 요인 3"],
  "institutionalFlow": "기관 수급 동향 상세 설명 (5일 추이·누적 규모·업종 의미, 2-3문장)",
  "foreignFlow": "외국인 수급 동향 상세 설명 (5일 추이·글로벌 매크로 관점, 2-3문장)",
  "flowPercentage": 50,
  "shortTermOutlook": "단기(1개월) 전망 (구체적 가격대 및 조건 포함, 2문장)",
  "midTermOutlook": "중기(3개월) 전망 (업황 변수 및 목표 시나리오 포함, 2문장)"
}

위 JSON 스키마를 반드시 준수하세요. 각 필드는 반드시 포함되어야 합니다.
규칙:
- recommendation은 반드시 "홀딩", "매도", "분할매도", "추가매수", "손절" 중 하나
- reasons, technicalAnalysis, riskFactors, opportunityFactors는 반드시 문자열 배열 (JSON array)
- targetPrice, stopLoss, flowPercentage는 반드시 숫자 타입
- flowPercentage는 0~100 사이 정수 (외국인·기관 합산 매수 강도)
- 순수 JSON만 출력하고 다른 텍스트는 절대 포함하지 마세요.
- 마크다운 코드블록(\`\`\`json), 설명 텍스트, preamble 없이 { 로 시작하는 JSON만 출력하세요.`;

    console.log('[DIAGNOSIS] 4. Claude 분석 시작');

    const message = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 3500,
      system: '당신은 15년 경력의 국내 주식 전문가입니다. summary 필드는 반드시 친한 전문가 친구처럼 쉽고 편하게 결론부터 말하는 어조로 작성하고, 나머지 분석 필드는 실제 데이터를 근거로 전문적으로 작성합니다. 반드시 유효한 JSON만 출력하세요.',
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
      recommendation:     '홀딩' as const,
      reasons:            [`AI 응답 형식 오류 (${errReason})`, '잠시 후 다시 시도해주세요.'],
      targetPrice:        Math.round(currentPrice * 1.1),
      stopLoss:           Math.round(currentPrice * 0.92),
      institutionalFlow:  '응답 형식 오류로 분석 불가',
      foreignFlow:        '응답 형식 오류로 분석 불가',
      technicalAnalysis:  ['응답 형식 오류로 분석 불가'],
      riskFactors:        ['응답 형식 오류로 리스크 요인 제공 불가'],
      opportunityFactors: ['응답 형식 오류로 기회 요인 제공 불가'],
      flowType:           'NEUTRAL' as const,
      flowPercentage:     50,
      news:               combinedNews,
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
    let flowType: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let flowPercentage: number = typeof result.flowPercentage === 'number' ? result.flowPercentage : 50;

    if (analysisData?.investorLatest) {
      const { foreign, institution } = analysisData.investorLatest;
      const net = foreign.amount + institution.amount;
      if (Math.abs(net) > 10) {
        flowType       = net > 0 ? 'BUY' : 'SELL';
        flowPercentage = Math.round(Math.min(Math.abs(net) / 1000 * 70 + 25, 95));
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
      flowType,
      flowPercentage,
      // Claude 응답 필드 (정규화)
      recommendation: (['홀딩','매도','분할매도','추가매수','손절'].includes(result.recommendation as string)
        ? result.recommendation as string : '홀딩'),
      summary:            typeof result.summary           === 'string' ? result.summary           : '',
      targetPrice:        typeof result.targetPrice       === 'number' ? result.targetPrice       : Math.round(currentPrice * 1.15),
      stopLoss:           typeof result.stopLoss          === 'number' ? result.stopLoss          : Math.round(currentPrice * 0.92),
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
