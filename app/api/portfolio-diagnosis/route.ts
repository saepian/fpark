import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  collectStockAnalysisData,
  buildTechnicalBlock,
  buildInvestorBlock,
} from '@/lib/stock-analysis-data';

export const dynamic    = 'force-dynamic';
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

  const isPro  = await checkPro(supabase, user.id, user.email);
  const count  = await getMonthlyCount(supabase, user.id);

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

  // 모든 종목 데이터 병렬 수집 (KIS 가격·52w·수급·네이버 재무·DB 뉴스)
  const analysisResults = await Promise.allSettled(
    holdings.map(h => collectStockAnalysisData(h.ticker, h.name)),
  );

  const enriched = holdings.map((h, i) => {
    const ar           = analysisResults[i];
    const ad           = ar.status === 'fulfilled' ? ar.value : null;
    const currentPrice = (ad?.currentPrice && ad.currentPrice > 0) ? ad.currentPrice : h.avgPrice;
    const resolvedName = (ad?.stockName && ad.stockName !== h.ticker) ? ad.stockName : h.name;
    const invested     = h.avgPrice * h.quantity;
    const value        = currentPrice * h.quantity;
    const profit       = value - invested;
    const profitRate   = h.avgPrice > 0 ? ((currentPrice - h.avgPrice) / h.avgPrice) * 100 : 0;
    return { ...h, name: resolvedName, currentPrice, invested, value, profit, profitRate, analysisData: ad };
  });

  const totalInvested   = enriched.reduce((s, h) => s + h.invested, 0);
  const totalValue      = enriched.reduce((s, h) => s + h.value, 0);
  const totalProfit     = totalValue - totalInvested;
  const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

  // 종목별 상세 블록 생성
  const holdingsDetailBlock = enriched.map(h => {
    const ad  = h.analysisData;
    const pr  = h.profitRate >= 0 ? '+' : '';
    const lines: string[] = [
      `### ${h.name} (${h.ticker})`,
      `현황: 현재가 ${h.currentPrice.toLocaleString()}원 | 매수가 ${h.avgPrice.toLocaleString()}원 | ${h.quantity}주 | 수익률 ${pr}${h.profitRate.toFixed(2)}% | 평가금액 ${h.value.toLocaleString()}원`,
    ];
    if (ad) {
      lines.push('기술/밸류: ' + buildTechnicalBlock(ad).replace(/\n- /g, ' | ').replace(/^- /, ''));
      const invBlock = buildInvestorBlock(ad);
      if (invBlock !== '데이터 없음') {
        lines.push('수급 동향:');
        lines.push(invBlock);
      }
      if (ad.news.length > 0) {
        lines.push('관련 뉴스: ' + ad.news.slice(0, 3).map(n => n.title).join(' / '));
      }
    }
    return lines.join('\n');
  }).join('\n\n');

  const prompt = `당신은 15년 경력의 국내 주식 포트폴리오 매니저입니다. 아래 실제 데이터를 종합 분석하여 반드시 JSON만 출력하세요.

## 포트폴리오 현황
- 총 투자금: ${totalInvested.toLocaleString()}원
- 총 평가금액: ${totalValue.toLocaleString()}원
- 총 손익: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString()}원 (${totalProfitRate >= 0 ? '+' : ''}${totalProfitRate.toFixed(2)}%)
- 보유 종목 수: ${enriched.length}개

## 종목별 상세 데이터
${holdingsDetailBlock}

분석 포인트:
1. 각 종목의 52주 위치·PER/PBR로 현재 주가 레벨 및 밸류에이션 평가
2. 외국인·기관 수급 추이로 스마트머니 방향 파악
3. 실적·뉴스와 결합한 업황 전망
4. 포트폴리오 전체 섹터 집중도·리스크 분산 평가
5. 각 종목 보유/매도/추가매수 액션 근거

## 출력 형식 (JSON만)
{
  "summary": "포트폴리오 종합 평가 (4-5문장: 전체 수익률 상태·강점·약점·수급 시그널·향후 전략 포함)",
  "sectors": [
    {"name": "섹터명", "tickers": ["코드1", "코드2"], "weight": 비중정수(합계100), "warning": 40이상true}
  ],
  "holdings": [
    {
      "ticker": "종목코드",
      "action": "매수" | "보유" | "분할매도" | "전량매도",
      "reason": "액션 이유 (수급·밸류에이션·수익률 수치 근거 포함, 2-3문장)",
      "sector": "실제 업종명"
    }
  ],
  "suggestions": [
    "구체적 개선 제안 1 (리스크 분산·비중 조정·신규 편입 등 수치 포함)",
    "제안 2", "제안 3", "제안 4"
  ]
}

규칙:
- sectors 비중 합계 반드시 100
- 각 종목 sector는 실제 업종(반도체/배터리/금융/바이오/IT서비스/자동차/철강/에너지 등)
- action은 수급·밸류에이션·수익률 종합 판단 (손절 수준 종목은 전량매도 고려)
- suggestions는 포트폴리오 전략 수준의 구체적 조언 (단순 모니터링 권유 금지)
- JSON 외 텍스트, 마크다운 코드블록 절대 금지`;

  try {
    const message = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 6000,
      system: '당신은 15년 경력의 국내 주식 포트폴리오 매니저입니다. 제공된 실제 수급·밸류에이션·기술적 데이터를 모두 활용하여 기관급 수준의 포트폴리오 분석을 제공합니다.',
      messages: [{ role: 'user', content: prompt }],
    });

    if (message.stop_reason === 'max_tokens') {
      console.error('[PORTFOLIO-DIAGNOSIS] Claude 응답이 max_tokens에서 잘림 — JSON 불완전할 수 있음');
    }

    const raw  = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    // 마크다운 코드블록 제거
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패: JSON 블록 없음');

    let aiResult: Record<string, unknown>;
    try {
      aiResult = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      const reason = message.stop_reason === 'max_tokens' ? 'max_tokens로 응답 잘림' : String(parseErr);
      throw new Error(`JSON 파싱 실패: ${reason}`);
    }

    const mergedHoldings = enriched.map(h => {
      const aiH = ((aiResult.holdings as { ticker: string; action?: string; reason?: string; sector?: string }[]) ?? []).find((a) => a.ticker === h.ticker);
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
        action:       aiH?.action ?? '보유',
        reason:       aiH?.reason ?? '',
        sector:       aiH?.sector ?? '',
      };
    });

    const finalResult = {
      totalInvested,
      totalValue,
      totalProfit,
      totalProfitRate: parseFloat(totalProfitRate.toFixed(2)),
      summary:     aiResult.summary    ?? '',
      sectors:     aiResult.sectors    ?? [],
      holdings:    mergedHoldings,
      suggestions: aiResult.suggestions ?? [],
    };

    try {
      await supabase.from('portfolio_diagnosis').insert({
        user_id: user.id,
        result:  finalResult,
      });
    } catch { /* ignore if table missing */ }

    return NextResponse.json(finalResult);
  } catch (e) {
    console.error('[PORTFOLIO-DIAGNOSIS]', e);
    return NextResponse.json({ error: 'AI 분석 생성 실패' }, { status: 500 });
  }
}
