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
export const maxDuration = 30;

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
          'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID!,
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET!,
        },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items ?? []).map((item: { title: string; description: string }) => ({
      title:       item.title.replace(/<[^>]*>/g, ''),
      description: item.description.replace(/<[^>]*>/g, ''),
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
  return NextResponse.json({ count: count ?? 0, remaining: isAdmin ? 999 : Math.max(0, 2 - (count ?? 0)) });
}

export async function POST(request: NextRequest) {
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
  if (!isAdmin && (count ?? 0) >= 2) {
    return NextResponse.json({ error: '오늘 무료 진단을 이미 사용했습니다.' }, { status: 429 });
  }

  const { ticker, name, avgPrice, quantity, buyDate } = await request.json();
  if (!ticker || !name || !avgPrice || !quantity) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
  }

  // 모든 데이터 병렬 수집
  const [priceResult, analysisResult, naverNewsResult] = await Promise.allSettled([
    fetchStockPrice(ticker),
    collectStockAnalysisData(ticker, name),
    fetchNaverNews(name),
  ]);

  const priceData    = priceResult.status    === 'fulfilled' ? priceResult.value    : null;
  const analysisData = analysisResult.status === 'fulfilled' ? analysisResult.value : null;
  const naverNews    = naverNewsResult.status === 'fulfilled' ? naverNewsResult.value : [];

  const currentPrice = priceData?.price || analysisData?.currentPrice || avgPrice;
  const stockName    = (priceData?.name && priceData.name !== ticker)
    ? priceData.name
    : (analysisData?.stockName || name);

  // 수익률 계산
  const profitRate   = ((currentPrice - avgPrice) / avgPrice * 100);
  const profitAmount = (currentPrice - avgPrice) * quantity;
  const holdDays     = buyDate
    ? Math.floor((Date.now() - new Date(buyDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // 프롬프트 블록 조립
  const technicalBlock = analysisData ? buildTechnicalBlock(analysisData) : '데이터 없음';
  const investorBlock  = analysisData ? buildInvestorBlock(analysisData)  : '데이터 없음';
  const newsBlock      = buildNewsBlock(analysisData?.news ?? [], naverNews);

  const dbNewsForResult = (analysisData?.news ?? []).map(n => ({
    title:       n.title,
    description: n.summary ?? '',
  }));
  const naverNewsForResult = naverNews.map((n: { title: string; description: string }) => ({
    title:       n.title,
    description: n.description,
  }));
  const combinedNews = [...dbNewsForResult, ...naverNewsForResult].slice(0, 5);

  const prompt = `당신은 15년 경력의 국내 주식 전문 애널리스트입니다. 아래 실제 데이터를 기반으로 심층 분석하여 반드시 JSON만 출력하세요.

## 종목 기본정보
- 종목명: ${stockName} (${ticker})
- 현재가: ${currentPrice.toLocaleString()}원
- 매수 평균가: ${avgPrice.toLocaleString()}원
- 보유 수량: ${quantity}주
- 수익률: ${profitRate >= 0 ? '+' : ''}${profitRate.toFixed(2)}%
- 평가손익: ${profitAmount >= 0 ? '+' : ''}${profitAmount.toLocaleString()}원${holdDays !== null ? `\n- 보유 기간: ${holdDays}일` : ''}

## 기술적 지표 및 밸류에이션
${technicalBlock}

## 수급 동향 (최근 5영업일)
${investorBlock}

## 관련 뉴스 (최근)
${newsBlock}

분석 포인트:
1. 52주 위치와 PER/PBR으로 현재 주가 레벨 평가 (과매수/과매도 여부)
2. 외국인·기관 5일 수급 추이로 스마트머니 방향 판단
3. 실적·뉴스와 결합하여 업황 및 촉매 요인 분석
4. 보유 기간·수익률을 고려한 최적 대응 전략 (목표가·손절가 수치 근거 포함)

## 출력 형식 (JSON만, 한국어로)
{
  "summary": "전체 분석 요약 (3-4문장: 주가 레벨·수급 방향·업황·투자의견 순서로)",
  "currentPrice": ${currentPrice},
  "avgPrice": ${avgPrice},
  "quantity": ${quantity},
  "profitRate": ${parseFloat(profitRate.toFixed(2))},
  "profitAmount": ${Math.round(profitAmount)},
  "news": [{"title": "뉴스 제목", "description": "뉴스 내용 요약"}],
  "institutional": "기관 수급 심층 분석 (5일 추이 방향성, 누적 매수/매도 규모, 업종 내 의미 해석, 2-3문장)",
  "foreign": "외국인 수급 심층 분석 (5일 추이, 글로벌 매크로 관점, 환율·지수 연동 해석, 2-3문장)",
  "technical": "기술적 분석 (52주 위치 해석, 지지선·저항선 근거, 거래량 평가, 2-3문장)",
  "recommendation": "홀딩" | "매도" | "분할매도" | "추가매수" | "손절",
  "reason": "추천 이유 (수치 근거 필수 포함, 3가지 핵심 논거를 번호 없이 줄바꿈으로 구분)",
  "targetPrice": 목표가 정수 (PER 또는 기술적 저항선 기반, 현재가 대비 합리적 범위),
  "stopLoss": 손절가 정수 (기술적 지지선 기반, 현재가 대비 -5~-15% 범위),
  "risk": "핵심 리스크 3가지 (수치 포함, 각 항목 줄바꿈 구분)",
  "opportunity": "핵심 기회 요인 3가지 (수치 포함, 각 항목 줄바꿈 구분)",
  "shortTermOutlook": "단기(1개월) 전망 (구체적 가격대 및 조건 포함, 2문장)",
  "midTermOutlook": "중기(3개월) 전망 (업황 변수 및 목표 시나리오 포함, 2문장)",
  "flowType": "BUY" | "SELL" | "NEUTRAL",
  "flowPercent": 0~100 정수 (25=강한매도, 50=중립, 75=강한매수 기준)
}

규칙:
- targetPrice, stopLoss, currentPrice, avgPrice, quantity, profitRate, profitAmount, flowPercent는 반드시 숫자 타입
- news 배열은 제공된 뉴스 데이터 기반 (없으면 빈 배열)
- flowType은 외국인+기관 순매수 합계 방향 기준
- JSON 외 텍스트, 마크다운 코드블록 절대 금지`;

  try {
    const message = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2500,
      system: '당신은 15년 경력의 국내 주식 전문 애널리스트입니다. 제공된 실제 수급·밸류에이션·기술적 데이터를 모두 활용하여 기관급 수준의 분석 리포트를 작성합니다. 수치 근거 없는 막연한 서술은 금지입니다.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text      = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');

    const result = JSON.parse(jsonMatch[0]);

    // flowType / flowPercent 보정 (AI가 잘못 계산하면 데이터 기반으로 재계산)
    let flowType: 'BUY' | 'SELL' | 'NEUTRAL' = result.flowType ?? 'NEUTRAL';
    let flowPercent: number = result.flowPercent ?? 50;

    if (analysisData?.investorLatest) {
      const { foreign, institution } = analysisData.investorLatest;
      const net = foreign.amount + institution.amount;
      if (Math.abs(net) > 10) {
        flowType    = net > 0 ? 'BUY' : 'SELL';
        const raw   = Math.min(Math.abs(net) / 1000 * 70 + 25, 95);
        flowPercent = Math.round(raw);
      }
    }

    const finalResult = {
      ...result,
      news: combinedNews.length > 0 ? combinedNews : (result.news ?? []),
      flowType,
      flowPercent,
    };

    await supabase.from('stock_diagnosis').insert({
      user_id:  user.id,
      ticker,
      name:     stockName,
      avg_price: avgPrice,
      quantity,
      buy_date:  buyDate || null,
      result:    finalResult,
    });

    return NextResponse.json(finalResult);
  } catch (e) {
    console.error('[DIAGNOSIS]', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
