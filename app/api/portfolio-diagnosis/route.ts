import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchStockPrice } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MONTHLY_LIMIT = 30;

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

async function checkPro(
  supabase: ReturnType<typeof makeSupabase>,
  userId: string,
  email: string | undefined,
): Promise<boolean> {
  if (email === 'saepian2@gmail.com') return true;
  try {
    const { data } = await supabase.from('users').select('plan').eq('id', userId).maybeSingle();
    return data?.plan === 'pro';
  } catch {
    return false;
  }
}

async function getMonthlyCount(
  supabase: ReturnType<typeof makeSupabase>,
  userId: string,
): Promise<number> {
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('portfolio_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', monthStart.toISOString());
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isPro = await checkPro(supabase, user.id, user.email);
  const count = await getMonthlyCount(supabase, user.id);

  return NextResponse.json({
    isPro,
    count,
    remaining: isPro ? Math.max(0, MONTHLY_LIMIT - count) : 0,
  });
}

export async function POST(request: NextRequest) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isPro = await checkPro(supabase, user.id, user.email);
  if (!isPro) return NextResponse.json({ error: 'PRO_REQUIRED' }, { status: 403 });

  const count = await getMonthlyCount(supabase, user.id);
  if (count >= MONTHLY_LIMIT) {
    return NextResponse.json(
      { error: `이번 달 사용 한도(${MONTHLY_LIMIT}회)를 초과했습니다.` },
      { status: 429 },
    );
  }

  const { holdings } = (await request.json()) as {
    holdings: { ticker: string; name: string; avgPrice: number; quantity: number; buyDate?: string }[];
  };

  if (!Array.isArray(holdings) || holdings.length === 0) {
    return NextResponse.json({ error: '종목을 하나 이상 입력해주세요.' }, { status: 400 });
  }
  if (holdings.length > 10) {
    return NextResponse.json({ error: '최대 10종목까지 분석 가능합니다.' }, { status: 400 });
  }

  // 현재가 일괄 조회
  const priceResults = await Promise.allSettled(
    holdings.map(h => fetchStockPrice(h.ticker)),
  );

  const enriched = holdings.map((h, i) => {
    const pr = priceResults[i];
    const currentPrice = pr.status === 'fulfilled' ? pr.value.price || h.avgPrice : h.avgPrice;
    const resolvedName = pr.status === 'fulfilled' && pr.value.name ? pr.value.name : h.name;
    const invested = h.avgPrice * h.quantity;
    const value = currentPrice * h.quantity;
    const profit = value - invested;
    const profitRate = h.avgPrice > 0 ? ((currentPrice - h.avgPrice) / h.avgPrice) * 100 : 0;
    return { ...h, name: resolvedName, currentPrice, invested, value, profit, profitRate };
  });

  const totalInvested = enriched.reduce((s, h) => s + h.invested, 0);
  const totalValue    = enriched.reduce((s, h) => s + h.value, 0);
  const totalProfit   = totalValue - totalInvested;
  const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

  const holdingsBlock = enriched
    .map(h =>
      `- ${h.name}(${h.ticker}): 현재가 ${h.currentPrice.toLocaleString()}원, 매수가 ${h.avgPrice.toLocaleString()}원, ${h.quantity}주, 평가금액 ${h.value.toLocaleString()}원, 수익률 ${h.profitRate >= 0 ? '+' : ''}${h.profitRate.toFixed(2)}%`,
    )
    .join('\n');

  const prompt = `당신은 국내 주식 포트폴리오 전문 애널리스트입니다. 아래 포트폴리오 데이터를 종합 분석하고 반드시 JSON만 출력하세요.

## 포트폴리오 현황
- 총 투자금: ${totalInvested.toLocaleString()}원
- 총 평가금액: ${totalValue.toLocaleString()}원
- 총 손익: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString()}원 (${totalProfitRate >= 0 ? '+' : ''}${totalProfitRate.toFixed(2)}%)

## 보유 종목 상세
${holdingsBlock}

## 출력 형식 (JSON만)
{
  "summary": "전체 포트폴리오 종합 평가 (3-4줄, 현재 상태·강점·약점·전망 포함)",
  "sectors": [
    {"name": "섹터명", "tickers": ["종목코드1", "종목코드2"], "weight": 비중정수(합계100), "warning": 과집중여부(40이상true)}
  ],
  "holdings": [
    {
      "ticker": "종목코드",
      "action": "매수" | "보유" | "분할매도" | "전량매도",
      "reason": "액션 이유 1~2줄 구체적 근거",
      "sector": "섹터명"
    }
  ],
  "suggestions": ["구체적 개선 제안 1", "제안 2", "제안 3", "제안 4"]
}

규칙:
- sectors 비중 합계는 반드시 100
- 각 종목의 sector는 실제 업종(반도체/배터리/금융/바이오/IT서비스 등)
- action은 현재 수익률·업황·포트폴리오 비중 종합 판단
- suggestions는 리스크 분산·편입 추천·비중 조정 등 구체적으로
- JSON 외 텍스트 절대 금지`;

  try {
    const message = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');

    const aiResult = JSON.parse(jsonMatch[0]);

    const mergedHoldings = enriched.map(h => {
      const aiH = (aiResult.holdings ?? []).find((a: { ticker: string }) => a.ticker === h.ticker);
      return {
        ticker:       h.ticker,
        name:         h.name,
        currentPrice: h.currentPrice,
        avgPrice:     h.avgPrice,
        quantity:     h.quantity,
        value:        h.value,
        invested:     h.invested,
        profit:       h.profit,
        profitRate:   parseFloat(h.profitRate.toFixed(2)),
        action:       aiH?.action  ?? '보유',
        reason:       aiH?.reason  ?? '',
        sector:       aiH?.sector  ?? '',
      };
    });

    const finalResult = {
      totalInvested,
      totalValue,
      totalProfit,
      totalProfitRate: parseFloat(totalProfitRate.toFixed(2)),
      summary:     aiResult.summary   ?? '',
      sectors:     aiResult.sectors   ?? [],
      holdings:    mergedHoldings,
      suggestions: aiResult.suggestions ?? [],
    };

    // 사용량 기록 (테이블 없어도 결과는 반환)
    try {
      await supabase.from('portfolio_diagnosis').insert({
        user_id: user.id,
        result:  finalResult,
      });
    } catch { /* ignore */ }

    return NextResponse.json(finalResult);
  } catch (e) {
    console.error('[PORTFOLIO-DIAGNOSIS]', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
