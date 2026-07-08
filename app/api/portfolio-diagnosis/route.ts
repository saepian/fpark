import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { deductCredit } from '@/lib/credits';
import { checkPlan } from '@/lib/plan';
import {
  collectStockAnalysisData,
  buildTechnicalBlock,
  buildInvestorBlock,
  pickRelevantNews,
  computeRiskMetrics,
} from '@/lib/stock-analysis-data';
import type { StockAnalysisData } from '@/lib/stock-analysis-data';
import { fetchDailyChart, fetchIndexRangeChange } from '@/lib/kis-api';
import { COMPLIANCE_PRINCIPLE, clampSignal, type Signal } from '@/lib/ai-compliance';
import { nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, checkTemporalConsistency } from '@/lib/ai-grounding';
import type { Database } from '@/lib/database.types';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const claude        = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MONTHLY_LIMIT       = 20;
const BASIC_MONTHLY_LIMIT = 1;
const MAX_HOLDINGS        = 10;

// 종목별 개별 분석(Stage 1) 고정 지침 — 종목마다 반복 호출되므로 프롬프트 캐싱 대상.
// 실제 ticker 값은 종목마다 다르므로 예시 스키마에서는 플레이스홀더만 사용한다.
const STOCK_SIGNAL_SYSTEM = `${COMPLIANCE_PRINCIPLE} 한국주식 데이터 정리자로서, 수급·밸류에이션·뉴스 데이터를 근거로 간결하게 관찰 사실을 정리합니다. 뉴스가 있으면 그 내용을 근거로 설명하고, 없으면 수급·기술적 요인으로만 설명하며 뉴스를 지어내지 마세요. JSON만 출력. reason 작성 시 종목명 사용, 숫자 종목코드 출력 금지.`;

const STOCK_SIGNAL_INSTRUCTIONS = `다음 한국 주식의 관찰된 데이터를 분석하고 JSON만 출력하세요.

{"ticker":"<종목코드>","signal":"순유입 우위"|"중립·관망"|"차익실현 관찰"|"순유출 우위","reason":"2문장 이내, 관찰된 사실 설명","sector":"실제업종명"}

signal은 매매 지시가 아니라 현재 수급·가격 패턴에 대한 관찰 결과입니다 — 외국인·기관의 순매수 자금 유입이 우위면 "순유입 우위", 순매도로 자금이 빠져나가는 흐름이 우위면 "순유출 우위", 수익률이 높고 밸류에이션 부담이 겹쳐 차익실현 패턴이 관찰되면 "차익실현 관찰", 그 외에는 "중립·관망"을 선택하세요. 뉴스 기사 제목에 "목표가"라는 단어가 있어도 reason에서는 그 단어를 그대로 쓰지 말고 "영업이익 추정치 상향" 같은 실적 전망치 표현으로만 언급하세요. 아래에 주어지는 실제 종목 데이터를 분석 대상으로 삼아, 응답의 "ticker" 필드에는 위 플레이스홀더 대신 그 종목의 실제 코드를 채워 넣으세요. ${TEMPORAL_GROUNDING_INSTRUCTION}`;

// 포트폴리오 종합 분석(Stage 2) 고정 지침 — 요청마다 1회만 호출되지만 다른 요청 간에도 재사용 가능.
const PORTFOLIO_SUMMARY_SYSTEM = `${COMPLIANCE_PRINCIPLE} 한국주식 포트폴리오 데이터를 섹터·수급·뉴스 관점에서 있는 그대로 정리하는 정보 제공자입니다. 숫자(PER·수급 등) 근거와 실제 뉴스 이슈를 함께 담아 설명하되, 무엇을 하라고 지시하지 마세요. JSON만 출력. 종목 언급 시 반드시 종목명 사용, 종목코드(숫자 6자리) 출력 금지.`;

const PORTFOLIO_SUMMARY_INSTRUCTIONS = `{"summary":"4-5문장 종합 설명(전체 수익률·구조적 특징·수급 현황, 뉴스가 있는 종목은 그 이슈를 구체적으로 언급, 벤치마크 수치가 있으면 사실로만 1회 언급)","sectors":[{"name":"섹터명","tickers":["코드"],"weight":정수,"warning":boolean}],"riskFactors":["포트폴리오 전체 관점의 리스크 요인1(수치 포함, 손실 종목 비중·섹터 과집중·벤치마크 대비 부진·개별 종목 변동성 등 근거)","요인2","요인3"],"opportunityFactors":["포트폴리오 전체 관점에서 관찰된 긍정 요인1을 사실로만 서술(수치 포함, '추가 상승 여력을 기대', '~라는 신호로 해석될 수 있다' 같이 향후 주가를 암시하는 결론 금지)","요인2(동일 기준)","요인3(동일 기준)"],"shortTermOutlook":"포트폴리오 관점 단기 관찰 변수 — 현재 진행 중인 섹터 업황·수급 흐름 중 앞으로 바뀔 수 있는 지점을 사실 나열형으로 서술, '수익률이 갈릴 수 있다'/'상승·하락 여력' 같이 가격을 예측하는 표현 절대 금지, 2문장","midTermOutlook":"포트폴리오 관점 중기 관찰 변수 — 섹터 업황·리밸런싱 관련 사실을 나열하되 특정 수익률이나 방향을 예측하지 않음, 가격 방향 예측 절대 금지, 2문장","suggestions":["참고할 만한 관찰 포인트1","포인트2","포인트3","포인트4"]}

규칙:
- sectors weight 합계=100
- riskFactors/opportunityFactors는 개별 종목이 아니라 포트폴리오 전체 구조(손실 비중·섹터 편중·벤치마크 대비·변동성)를 보는 관점으로 작성하세요
- shortTermOutlook/midTermOutlook도 개별 종목이 아니라 포트폴리오 전체 관점으로 작성하고, 목표가·손절가·매수매도 지시·저항선·지지선·가격 방향 예측은 금지하세요 — 관찰된 사실만 서술하고 그 사실이 앞으로 수익률에 어떤 영향을 줄지 예측하지 마세요
- suggestions는 "이렇게 하세요" 식 지시나 "투자자들이 참고한다"는 식의 권유성 결론이 아니라, 관찰된 데이터 특징을 사실 그대로 서술하는 정보 형태로 작성
- 뉴스가 있는 종목은 그 이슈를 근거로 언급하고, 뉴스가 없는 종목은 수급·기술적 요인으로만 설명하며 뉴스를 지어내지 마세요
- 벤치마크 수치는 판단 없이 사실 비교로만 1회 언급(예: "~보다 높습니다/낮습니다" 정도의 사실 서술은 가능하나 "그래서 ~해야 한다"는 연결 금지)
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- summary·suggestions·riskFactors·opportunityFactors·outlook에서 종목을 언급할 때는 반드시 종목명을 사용하고 종목코드(숫자 6자리)는 절대 출력하지 마세요`;

// ── Supabase ────────────────────────────────────────────────────────────────

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient<Database>(
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

// subscription_start_date 기준 현재 사이클 시작일 계산 (null이면 매월 1일 폴백)
function getBillingCycleStart(subscriptionStartDate: string | null, now: Date): Date {
  if (!subscriptionStartDate) {
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }
  const startDay = new Date(subscriptionStartDate).getDate();
  const y = now.getFullYear();
  const m = now.getMonth();
  // 말일 클램핑 (e.g., 1월 31일 → 2월 28일)
  const lastDay = (yr: number, mo: number) => new Date(yr, mo + 1, 0).getDate();
  const thisMonthStart = new Date(y, m, Math.min(startDay, lastDay(y, m)), 0, 0, 0, 0);
  if (thisMonthStart <= now) return thisMonthStart;
  return new Date(y, m - 1, Math.min(startDay, lastDay(y, m - 1)), 0, 0, 0, 0);
}

async function getMonthlyCount(
  supabase: ReturnType<typeof makeSupabase>,
  userId: string,
): Promise<number> {
  try {
    // subscription_start_date 조회 후 사이클 시작일 계산
    const { data: userRow } = await supabase
      .from('users')
      .select('subscription_start_date')
      .eq('id', userId)
      .maybeSingle();

    const cycleStart = getBillingCycleStart(
      userRow?.subscription_start_date ?? null,
      new Date(),
    );

    const { count } = await supabase
      .from('portfolio_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', cycleStart.toISOString());
    return count ?? 0;
  } catch { return 0; }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface HoldingInput {
  ticker: string; name: string;
  avgPrice: number; quantity: number; buyDate?: string;
}

interface EnrichedHolding extends HoldingInput {
  currentPrice: number; invested: number; value: number;
  profit: number; profitRate: number;
  analysisData: StockAnalysisData | null;
  relevantNews: { title: string; summary?: string; date?: string; url?: string }[];
  mdd: number | null;         // 최근 3개월 최대낙폭(%), 음수
  volatility: number | null;  // 최근 3개월 일별 변동성(표준편차, %)
}

interface StockAiResult {
  ticker: string; signal: Signal; reason: string; sector: string;
  newsBasis: 'news' | 'estimated';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseAiJson<T>(text: string, fallback: T): T {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('[PORTFOLIO-DIAGNOSIS] AI 응답에서 JSON을 찾지 못함, 길이:', text.length);
    return fallback;
  }
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('[PORTFOLIO-DIAGNOSIS] JSON.parse 실패 (응답이 잘렸을 가능성):', e instanceof Error ? e.message : e);
    return fallback;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timer = new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms));
  return Promise.race([promise, timer]);
}

// 종목 1개 프롬프트 — PER·52주위치·수급·관련도 상위 뉴스 포함
function buildStockPrompt(h: EnrichedHolding): string {
  const ad  = h.analysisData;
  const pr  = h.profitRate >= 0 ? '+' : '';
  const lines: string[] = [
    `현재 시각: ${nowKstString()}`,
    `종목: ${h.name}(${h.ticker}) | 매입가:${h.avgPrice.toLocaleString()} | 현재가:${h.currentPrice.toLocaleString()} | 수익률:${pr}${h.profitRate.toFixed(1)}%`,
  ];
  if (ad) {
    const tech: string[] = [];
    if (ad.per > 0)         tech.push(`PER:${ad.per.toFixed(1)}배`);
    if (ad.week52Position)  tech.push(`52주위치:${ad.week52Position.toFixed(0)}%`);
    if (ad.operatingProfit) tech.push(`영업이익:${ad.operatingProfit}`);
    if (tech.length)        lines.push(tech.join(' | '));
    const inv = buildInvestorBlock(ad);
    if (inv && inv !== '데이터 없음') lines.push(`수급: ${inv.replace(/\n/g, ' ')}`);

    lines.push(buildNewsFreshnessLine(h.relevantNews));
    if (h.relevantNews.length > 0) {
      const newsLines = h.relevantNews
        .map(n => `${n.title}${n.summary ? ` — ${n.summary}` : ''}`)
        .join(' / ');
      lines.push(`뉴스: ${newsLines}`);
      lines.push('(위 뉴스를 근거로 reason을 작성하되, 뉴스에 없는 내용은 지어내지 말 것)');
    } else {
      lines.push('뉴스: 관련 뉴스 없음 — reason은 수급·기술적 요인으로만 작성하고 뉴스를 지어내지 말 것');
    }

    if (!ad.operatingProfit && !ad.revenue) {
      lines.push('재무 데이터 없음 - 수급과 뉴스 기반으로만 분석');
    }
  } else {
    lines.push('데이터 조회 실패 - 수익률 기반으로만 분석');
  }
  return lines.join('\n');
}

// ── Stage 1: 종목 개별 분석 ─────────────────────────────────────────────────

async function analyzeOneStock(h: EnrichedHolding): Promise<StockAiResult> {
  const prompt = buildStockPrompt(h);

  const newsBasis: 'news' | 'estimated' = h.relevantNews.length > 0 ? 'news' : 'estimated';

  try {
    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system: [
        { type: 'text', text: STOCK_SIGNAL_SYSTEM },
        { type: 'text', text: STOCK_SIGNAL_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const parsed = parseAiJson<Omit<StockAiResult, 'newsBasis'>>(text, { ticker: h.ticker, signal: '중립·관망', reason: '', sector: '' });

    // 시간적 사실관계 사후 검증 — N개 종목 병렬 호출이라 재생성은 비용이 커서 로그만 남긴다.
    const newsText = h.relevantNews.map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
    const check = checkTemporalConsistency(parsed.reason ?? '', newsText);
    if (check.flagged) {
      console.warn(`[PORTFOLIO-DIAGNOSIS] ${h.ticker} 시간적 사실관계 불일치 감지 (재생성 없음):`, check);
    }

    return { ...parsed, signal: clampSignal(parsed.signal), newsBasis };
  } catch (e) {
    console.error(`[PORTFOLIO-DIAGNOSIS] 종목 분석 실패 ${h.ticker}:`, e);
    return { ticker: h.ticker, signal: '중립·관망', reason: '', sector: '', newsBasis };
  }
}

// ── Stage 2: 포트폴리오 종합 분석 ──────────────────────────────────────────

async function analyzePortfolioSummary(
  stockResults: StockAiResult[],
  nameMap: Record<string, string>,   // ticker → 종목명
  newsMap: Record<string, { title: string; summary?: string }[]>, // ticker → 관련도 상위 뉴스
  totalProfitRate: number,
  holdingCount: number,
  benchmark: { portfolioProfitRate: number; kospiChangeRate: number } | null,
  portfolioFacts: { lossCount: number; lossWeightPct: number; riskiestLines: string[] },
): Promise<{
  summary: string; sectors: unknown[]; suggestions: string[];
  riskFactors: string[]; opportunityFactors: string[];
  shortTermOutlook: string; midTermOutlook: string;
}> {
  // 종목명-종목코드 매핑 테이블
  const mappingTable = Object.entries(nameMap)
    .map(([ticker, name]) => `${ticker}: ${name}`)
    .join(', ');

  // 종목명 + 뉴스 현황으로 라인 구성
  const lines = stockResults
    .map(s => {
      const news = newsMap[s.ticker] ?? [];
      const newsPart = news.length > 0 ? ` | 뉴스: ${news[0].title}` : ' | 뉴스: 없음(수급·기술적 요인)';
      return `${nameMap[s.ticker] ?? s.ticker}(${s.sector || '기타'}): ${s.signal} — ${s.reason}${newsPart}`;
    })
    .join('\n');

  const benchmarkLine = benchmark
    ? `\n벤치마크(참고용 수치 비교, 판단 근거로 쓰지 말 것): 포트폴리오 수익률 ${benchmark.portfolioProfitRate.toFixed(2)}% vs 같은 기간 KOSPI 등락률 ${benchmark.kospiChangeRate.toFixed(2)}%`
    : '';

  const riskFactsLine =
    `\n포트폴리오 리스크 참고 데이터:\n` +
    `- 손실 종목: ${portfolioFacts.lossCount}/${holdingCount}개 (평가금액 기준 ${portfolioFacts.lossWeightPct.toFixed(1)}%)` +
    (portfolioFacts.riskiestLines.length > 0 ? `\n- 변동성 참고: ${portfolioFacts.riskiestLines.join(', ')}` : '');

  const prompt =
    `포트폴리오 관찰 데이터 정리 (JSON만 출력)\n\n` +
    `현재 시각: ${nowKstString()}\n\n` +
    `[종목코드→종목명 매핑] ${mappingTable}\n\n` +
    `총 수익률: ${totalProfitRate.toFixed(2)}% | 보유종목: ${holdingCount}개${benchmarkLine}\n` +
    `${lines}\n${riskFactsLine}\n\n` +
    `위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 스키마와 규칙에 따라 정리하세요.`;

  try {
    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [
        { type: 'text', text: PORTFOLIO_SUMMARY_SYSTEM },
        { type: 'text', text: PORTFOLIO_SUMMARY_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const parsed = parseAiJson(text, {
      summary: '', sectors: [], suggestions: [],
      riskFactors: [], opportunityFactors: [], shortTermOutlook: '', midTermOutlook: '',
    });

    // 시간적 사실관계 사후 검증 — 포트폴리오 요약은 1회 호출이지만, 종목별 뉴스가 이미
    // Stage 1에서 개별 검증되므로 여기서는 종합 텍스트만 가볍게 로그로 남긴다(재생성 없음).
    const allNewsText = Object.values(newsMap).flat().map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
    const summaryText = [parsed.summary, ...(parsed.suggestions ?? []), ...(parsed.opportunityFactors ?? []), parsed.shortTermOutlook, parsed.midTermOutlook].filter(Boolean).join(' ');
    const check = checkTemporalConsistency(summaryText, allNewsText);
    if (check.flagged) {
      console.warn('[PORTFOLIO-DIAGNOSIS] 포트폴리오 종합 요약 시간적 사실관계 불일치 감지 (재생성 없음):', check);
    }

    return parsed;
  } catch (e) {
    console.error('[PORTFOLIO-DIAGNOSIS] 종합 분석 실패:', e);
    return {
      summary: '', sectors: [], suggestions: [],
      riskFactors: [], opportunityFactors: [], shortTermOutlook: '', midTermOutlook: '',
    };
  }
}

// 여러 종목에 동일 뉴스가 매칭된 경우(예: 섹터 뉴스가 복수 종목에 매칭) url(없으면 정규화된 제목) 기준으로 병합
function buildNewsDigest(
  enriched: { name: string; relevantNews: { title: string; summary?: string; date?: string; url?: string }[] }[],
): { title: string; summary?: string; url?: string; stocks: string[] }[] {
  const map = new Map<string, { title: string; summary?: string; url?: string; stocks: string[] }>();
  for (const h of enriched) {
    for (const n of h.relevantNews) {
      const key = (n.url && n.url.trim()) || n.title.trim().toLowerCase();
      const existing = map.get(key);
      if (existing) {
        if (!existing.stocks.includes(h.name)) existing.stocks.push(h.name);
      } else {
        map.set(key, { title: n.title, summary: n.summary, url: n.url, stocks: [h.name] });
      }
    }
  }
  return [...map.values()];
}

// ── SSE helper ──────────────────────────────────────────────────────────────

function sseEncode(ctrl: ReadableStreamDefaultController, encoder: TextEncoder, data: object) {
  ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const plan    = await checkPlan(supabase, user.id, user.email);
  const count   = await getMonthlyCount(supabase, user.id);
  const isPro   = plan === 'pro' || plan === 'admin';
  const isBasic = plan === 'basic';
  const limit   = plan === 'admin' ? 999 : isPro ? MONTHLY_LIMIT : isBasic ? BASIC_MONTHLY_LIMIT : 0;
  return NextResponse.json({
    isPro,
    isBasic,
    count,
    remaining: Math.max(0, limit - count),
  });
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── 1. Auth (정상 JSON 에러 반환) ──────────────────────────────────────────
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const plan    = await checkPlan(supabase, user.id, user.email);
  const isPro   = plan === 'pro' || plan === 'admin';
  const isBasic = plan === 'basic';

  // 플랜 없는 경우 1회권 크레딧 원자적 차감(레이스 컨디션 방지)
  let usedCredit = false;
  if (!isPro && !isBasic) {
    const result = await deductCredit(user.id, 'portfolio');
    if (result.success === false) {
      if (result.reason === 'error') {
        return NextResponse.json({ error: '크레딧 확인 중 오류가 발생했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ error: 'PRO_REQUIRED' }, { status: 403 });
    }
    usedCredit = true;
  }

  const count = await getMonthlyCount(supabase, user.id);
  const limit = plan === 'admin' ? 999 : isPro ? MONTHLY_LIMIT : BASIC_MONTHLY_LIMIT;
  if (!usedCredit && count >= limit) {
    // 월 한도 초과 시에도 1회권 크레딧 원자적 차감
    const result = await deductCredit(user.id, 'portfolio');
    if (result.success === false) {
      if (result.reason === 'error') {
        return NextResponse.json({ error: '크레딧 확인 중 오류가 발생했습니다.' }, { status: 500 });
      }
      return NextResponse.json(
        { error: `이번 달 사용 한도(${limit}회)를 초과했습니다.` },
        { status: 429 },
      );
    }
    usedCredit = true;
  }

  // ── 2. 입력 검증 ──────────────────────────────────────────────────────────
  const { holdings } = (await request.json()) as { holdings: HoldingInput[] };
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return NextResponse.json({ error: '종목을 하나 이상 입력해주세요.' }, { status: 400 });
  }
  if (holdings.length > MAX_HOLDINGS) {
    return NextResponse.json({ error: `최대 ${MAX_HOLDINGS}종목까지 분석 가능합니다.` }, { status: 400 });
  }

  // ── 3. SSE 스트림 시작 ────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const send    = (ctrl: ReadableStreamDefaultController, data: object) =>
    sseEncode(ctrl, encoder, data);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Stage 0: 데이터 수집
        send(controller, { type: 'progress', label: '종목 데이터 수집 중...' });
        console.log(`[PORTFOLIO-DIAGNOSIS] 데이터 수집 시작 (${holdings.length}개 종목)`);

        const [analysisResults, chartResults] = await Promise.all([
          Promise.allSettled(
            holdings.map(h =>
              withTimeout(collectStockAnalysisData(h.ticker, h.name), 8000, null)
            ),
          ),
          Promise.allSettled(
            holdings.map(h =>
              withTimeout(fetchDailyChart(h.ticker, '3M'), 8000, null)
            ),
          ),
        ]);

        const enriched: EnrichedHolding[] = holdings.map((h, i) => {
          const ar           = analysisResults[i];
          const ad           = ar.status === 'fulfilled' ? ar.value : null;
          const currentPrice = (ad?.currentPrice && ad.currentPrice > 0) ? ad.currentPrice : h.avgPrice;
          const resolvedName = (ad?.stockName && ad.stockName !== h.ticker) ? ad.stockName : h.name;
          const invested     = h.avgPrice * h.quantity;
          const value        = currentPrice * h.quantity;
          const profit       = value - invested;
          const profitRate   = h.avgPrice > 0 ? ((currentPrice - h.avgPrice) / h.avgPrice) * 100 : 0;
          const relevantNews = ad ? pickRelevantNews(ad.news ?? [], resolvedName, ad.sector, 2) : [];

          const cr     = chartResults[i];
          const closes = (cr.status === 'fulfilled' && cr.value) ? cr.value.map(p => p.close) : [];
          const risk   = computeRiskMetrics(closes);

          return {
            ...h, name: resolvedName, currentPrice, invested, value, profit, profitRate,
            analysisData: ad, relevantNews,
            mdd:        risk?.mdd        ?? null,
            volatility: risk?.volatility ?? null,
          };
        });

        // 벤치마크 비교: 편입 종목 평균 매수일 ~ 현재 KOSPI 등락률 (매수일 입력된 종목이 있을 때만)
        let benchmark: {
          portfolioProfitRate: number; kospiChangeRate: number;
          fromDate: string; toDate: string;
        } | null = null;
        try {
          const buyDates = holdings
            .map(h => h.buyDate)
            .filter((d): d is string => !!d)
            .map(d => new Date(d).getTime())
            .filter(t => !isNaN(t));
          if (buyDates.length > 0) {
            const avgBuyDate = new Date(buyDates.reduce((s, t) => s + t, 0) / buyDates.length);
            const kospi = await withTimeout(fetchIndexRangeChange('0001', avgBuyDate, new Date()), 8000, null);
            if (kospi) {
              benchmark = {
                portfolioProfitRate: 0, // 아래에서 totalProfitRate 계산 후 채움
                kospiChangeRate: parseFloat(kospi.changeRate.toFixed(2)),
                fromDate: kospi.startDate,
                toDate:   kospi.endDate,
              };
            }
          }
        } catch (e) {
          console.error('[PORTFOLIO-DIAGNOSIS] 벤치마크 비교 실패:', e);
        }

        const totalInvested   = enriched.reduce((s, h) => s + h.invested, 0);
        const totalValue      = enriched.reduce((s, h) => s + h.value, 0);
        const totalProfit     = totalValue - totalInvested;
        const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

        if (benchmark) benchmark.portfolioProfitRate = parseFloat(totalProfitRate.toFixed(2));

        // 포트폴리오 리스크 참고 데이터 (Stage 2 프롬프트에 사실로 주입)
        const lossHoldings   = enriched.filter(h => h.profitRate < 0);
        const lossCount      = lossHoldings.length;
        const lossWeightPct  = totalValue > 0 ? (lossHoldings.reduce((s, h) => s + h.value, 0) / totalValue) * 100 : 0;
        const riskiestLines  = [...enriched]
          .filter(h => h.mdd != null)
          .sort((a, b) => (a.mdd as number) - (b.mdd as number))
          .slice(0, 2)
          .map(h => `${h.name} 최근 3개월 MDD ${(h.mdd as number).toFixed(1)}%`);

        // Stage 1: 종목별 개별 분석 (병렬)
        send(controller, { type: 'progress', label: `${enriched.length}개 종목 개별 분석 중...` });
        console.log(`[PORTFOLIO-DIAGNOSIS] Stage 1 시작 — ${enriched.length}개 병렬 분석`);

        const stockResults = await Promise.all(enriched.map(h => analyzeOneStock(h)));

        // Stage 2: 포트폴리오 종합 분석
        send(controller, { type: 'progress', label: '포트폴리오 종합 분석 중...' });
        console.log('[PORTFOLIO-DIAGNOSIS] Stage 2 시작 — 종합 분석');

        // ticker → 종목명 / 관련 뉴스 매핑 (AI가 summary/suggestions에 종목명·뉴스 근거 사용하도록)
        const nameMap: Record<string, string> = {};
        const newsMap: Record<string, { title: string; summary?: string }[]> = {};
        enriched.forEach(h => {
          nameMap[h.ticker] = h.name;
          newsMap[h.ticker] = h.relevantNews;
        });

        const summary = await analyzePortfolioSummary(
          stockResults, nameMap, newsMap, totalProfitRate, enriched.length, benchmark,
          { lossCount, lossWeightPct, riskiestLines },
        );

        // 뉴스 동향 집계 (여러 종목에 매칭된 동일 뉴스는 병합)
        const newsDigest = buildNewsDigest(enriched);

        // 결과 병합
        const mergedHoldings = enriched.map(h => {
          const aiH = stockResults.find(s => s.ticker === h.ticker);
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
            signal:       aiH?.signal ?? '중립·관망',
            reason:       aiH?.reason ?? '',
            sector:       aiH?.sector ?? '',
            newsBasis:    aiH?.newsBasis ?? (h.relevantNews.length > 0 ? 'news' : 'estimated'),
            news:         h.relevantNews,
            mdd:          h.mdd,
            volatility:   h.volatility,
            isCached:     h.analysisData?.isCached,
            cachedAt:     h.analysisData?.cachedAt,
          };
        });

        const finalResult = {
          totalInvested,
          totalValue,
          totalProfit,
          totalProfitRate: parseFloat(totalProfitRate.toFixed(2)),
          summary:            summary.summary            ?? '',
          sectors:            summary.sectors            ?? [],
          holdings:           mergedHoldings,
          suggestions:        summary.suggestions        ?? [],
          riskFactors:        summary.riskFactors        ?? [],
          opportunityFactors: summary.opportunityFactors ?? [],
          shortTermOutlook:   summary.shortTermOutlook    || '',
          midTermOutlook:     summary.midTermOutlook      || '',
          newsDigest,
          benchmark,
        };

        // DB 저장
        try {
          const { error: insertError } = await supabase.from('portfolio_diagnosis').insert({
            user_id: user.id,
            result:  finalResult,
          });
          if (insertError) console.error('[PORTFOLIO-DIAGNOSIS] DB 저장 실패:', insertError);
        } catch (dbErr) {
          console.error('[PORTFOLIO-DIAGNOSIS] DB 저장 실패:', dbErr);
        }

        console.log(`[PORTFOLIO-DIAGNOSIS] 완료${usedCredit ? ' (1회권 사용)' : ''}`);
        send(controller, { type: 'result', data: finalResult });
      } catch (e) {
        console.error('[PORTFOLIO-DIAGNOSIS] 치명적 오류:', e);
        send(controller, { type: 'error', message: 'AI 분석 생성 실패' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
