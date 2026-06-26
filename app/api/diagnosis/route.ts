import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchStockPrice } from '@/lib/kis-api';
import { getAccessToken } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const KIS = 'https://openapi.koreainvestment.com:9443';

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

function kisHeaders(token: string, trId: string) {
  return {
    'content-type': 'application/json; charset=UTF-8',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
  };
}

const toAuk = (v: string | number | undefined) => Math.round(Number(v || 0) / 100);

async function fetchInvestorData(ticker: string) {
  try {
    const token = await getAccessToken();
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = kst.toISOString().split('T')[0].replace(/-/g, '');

    const res = await fetch(
      `${KIS}/uapi/domestic-stock/v1/quotations/inquire-investor?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${ticker}`,
      { headers: kisHeaders(token, 'FHKST01010900'), cache: 'no-store' }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const output: Record<string, string>[] = data?.output ?? [];
    const recent = output.find(d => d.stck_bsop_date === todayStr && d.frgn_ntby_tr_pbmn !== '')
      ?? output.find(d => d.frgn_ntby_tr_pbmn !== '');

    if (!recent) return null;

    return {
      foreign:     { qty: Number(recent.frgn_ntby_qty || 0), amount: toAuk(recent.frgn_ntby_tr_pbmn) },
      institution: { qty: Number(recent.orgn_ntby_qty || 0), amount: toAuk(recent.orgn_ntby_tr_pbmn) },
      individual:  { qty: Number(recent.prsn_ntby_qty || 0), amount: toAuk(recent.prsn_ntby_tr_pbmn) },
    };
  } catch {
    return null;
  }
}

async function fetchNaverNews(stockName: string) {
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(stockName)}&display=5`,
      {
        headers: {
          'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID!,
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET!,
        },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items ?? []).map((item: any) => ({
      title: item.title.replace(/<[^>]*>/g, ''),
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

  return NextResponse.json({ count: count ?? 0, remaining: 999 }); // TODO: 테스트 중 — 제한 해제
}

export async function POST(request: NextRequest) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 오늘 진단 횟수 체크
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { count } = await supabase
    .from('stock_diagnosis')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', `${todayKst}T00:00:00+09:00`);

  // TODO: 테스트 중 — 횟수 제한 해제
  // if ((count ?? 0) >= 1) {
  //   return NextResponse.json({ error: '오늘 무료 진단을 이미 사용했습니다.' }, { status: 429 });
  // }

  const { ticker, name, avgPrice, quantity, buyDate } = await request.json();
  if (!ticker || !name || !avgPrice || !quantity) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
  }

  // KIS 현재가 및 기관/외국인 동향
  let currentPrice = 0;
  let stockName = name;
  let investorData: Awaited<ReturnType<typeof fetchInvestorData>> = null;

  try {
    const priceData = await fetchStockPrice(ticker);
    currentPrice = priceData.price;
    stockName = priceData.name || name;
  } catch {
    currentPrice = avgPrice;
  }

  [investorData] = await Promise.all([fetchInvestorData(ticker)]);

  // 네이버 뉴스
  const news = await fetchNaverNews(stockName);

  // 수익률 계산
  const profitRate = ((currentPrice - avgPrice) / avgPrice * 100);
  const profitAmount = (currentPrice - avgPrice) * quantity;

  // 보유 기간
  const holdDays = buyDate
    ? Math.floor((Date.now() - new Date(buyDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const investorBlock = investorData
    ? `- 외국인 순매수: ${investorData.foreign.qty.toLocaleString()}주 (${investorData.foreign.amount}억원)
- 기관 순매수: ${investorData.institution.qty.toLocaleString()}주 (${investorData.institution.amount}억원)
- 개인 순매수: ${investorData.individual.qty.toLocaleString()}주 (${investorData.individual.amount}억원)`
    : '데이터 없음';

  const newsBlock = news.length > 0
    ? news.map((n: any, i: number) => `${i + 1}. ${n.title}`).join('\n')
    : '관련 뉴스 없음';

  const prompt = `당신은 국내 주식 전문 애널리스트입니다. 아래 보유 종목 데이터를 분석하고 반드시 JSON만 출력하세요.

## 보유 종목 정보
- 종목명: ${stockName} (${ticker})
- 현재가: ${currentPrice.toLocaleString()}원
- 매수 평균가: ${avgPrice.toLocaleString()}원
- 보유 수량: ${quantity}주
- 수익률: ${profitRate > 0 ? '+' : ''}${profitRate.toFixed(2)}%
- 평가손익: ${profitAmount > 0 ? '+' : ''}${profitAmount.toLocaleString()}원${holdDays !== null ? `\n- 보유 기간: ${holdDays}일` : ''}

## 수급 동향
${investorBlock}

## 최근 뉴스
${newsBlock}

## 출력 형식 (JSON만)
{
  "summary": "전체 요약 (2-3줄, 수익률 상황과 향후 전망 포함)",
  "currentPrice": ${currentPrice},
  "avgPrice": ${avgPrice},
  "quantity": ${quantity},
  "profitRate": ${parseFloat(profitRate.toFixed(2))},
  "profitAmount": ${profitAmount},
  "news": [{"title": "뉴스제목", "description": "뉴스요약"}],
  "institutional": "기관 매매동향 분석 (2-3줄)",
  "foreign": "외국인 매매동향 분석 (2-3줄)",
  "technical": "기술적 분석 (현재가 위치, 추세 등 2-3줄)",
  "recommendation": "홀딩" | "매도" | "분할매도" | "추가매수" | "손절",
  "reason": "추천 이유 (3-5줄, 구체적 근거 포함)",
  "targetPrice": 목표가 정수,
  "stopLoss": 손절가 정수,
  "risk": "리스크 요인 (2-3줄)",
  "opportunity": "기회 요인 (2-3줄)"
}

규칙:
- targetPrice, stopLoss는 정수
- news는 제공된 뉴스 데이터 그대로 사용
- recommendation은 현재 수익률과 수급 상황을 종합적으로 판단
- JSON 외 텍스트 절대 포함 금지`;

  try {
    const message = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');

    const result = JSON.parse(jsonMatch[0]);

    // DB 저장
    await supabase.from('stock_diagnosis').insert({
      user_id: user.id,
      ticker,
      name: stockName,
      avg_price: avgPrice,
      quantity,
      buy_date: buyDate || null,
      result,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error('[DIAGNOSIS]', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
