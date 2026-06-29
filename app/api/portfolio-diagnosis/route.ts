import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  collectStockAnalysisData,
  buildTechnicalBlock,
  buildInvestorBlock,
} from '@/lib/stock-analysis-data';
import type { StockAnalysisData } from '@/lib/stock-analysis-data';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const claude        = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MONTHLY_LIMIT = 30;
const MAX_HOLDINGS  = 10;

// ── Supabase ────────────────────────────────────────────────────────────────

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
  } catch { return false; }
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
}

interface StockAiResult {
  ticker: string; action: string; reason: string; sector: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseAiJson<T>(text: string, fallback: T): T {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try { return JSON.parse(match[0]); } catch { return fallback; }
}

// 종목 1개 프롬프트 — PER·52주위치·수급·뉴스 1개만 포함
function buildStockPrompt(h: EnrichedHolding): string {
  const ad  = h.analysisData;
  const pr  = h.profitRate >= 0 ? '+' : '';
  const lines: string[] = [
    `종목: ${h.name}(${h.ticker}) | 매수가:${h.avgPrice.toLocaleString()} | 현재가:${h.currentPrice.toLocaleString()} | 수익률:${pr}${h.profitRate.toFixed(1)}%`,
  ];
  if (ad) {
    const tech: string[] = [];
    if (ad.per > 0)        tech.push(`PER:${ad.per.toFixed(1)}배`);
    if (ad.week52Position) tech.push(`52주위치:${ad.week52Position.toFixed(0)}%`);
    if (ad.operatingProfit) tech.push(`영업이익:${ad.operatingProfit}`);
    if (tech.length)       lines.push(tech.join(' | '));
    const inv = buildInvestorBlock(ad);
    if (inv && inv !== '데이터 없음') lines.push(`수급: ${inv.replace(/\n/g, ' ')}`);
    if (ad.news?.[0])      lines.push(`뉴스: ${ad.news[0].title}`);
  }
  return lines.join('\n');
}

// ── Stage 1: 종목 개별 분석 ─────────────────────────────────────────────────

async function analyzeOneStock(h: EnrichedHolding): Promise<StockAiResult> {
  const prompt =
    `다음 한국 주식을 분석하고 JSON만 출력하세요.\n\n` +
    buildStockPrompt(h) +
    `\n\n{"ticker":"${h.ticker}","action":"매수"|"보유"|"분할매도"|"전량매도","reason":"2문장 이내 근거","sector":"실제업종명"}`;

  try {
    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system: '한국주식 애널리스트. 수급·밸류에이션 데이터 기반 간결한 종목 분석. JSON만 출력. reason 작성 시 종목명 사용, 숫자 종목코드 출력 금지.',
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    return parseAiJson<StockAiResult>(text, { ticker: h.ticker, action: '보유', reason: '', sector: '' });
  } catch (e) {
    console.error(`[PORTFOLIO-DIAGNOSIS] 종목 분석 실패 ${h.ticker}:`, e);
    return { ticker: h.ticker, action: '보유', reason: '', sector: '' };
  }
}

// ── Stage 2: 포트폴리오 종합 분석 ──────────────────────────────────────────

async function analyzePortfolioSummary(
  stockResults: StockAiResult[],
  nameMap: Record<string, string>,   // ticker → 종목명
  totalProfitRate: number,
  holdingCount: number,
): Promise<{ summary: string; sectors: unknown[]; suggestions: string[] }> {
  // 종목명-종목코드 매핑 테이블
  const mappingTable = Object.entries(nameMap)
    .map(([ticker, name]) => `${ticker}: ${name}`)
    .join(', ');

  // 종목명으로 라인 구성
  const lines = stockResults
    .map(s => `${nameMap[s.ticker] ?? s.ticker}(${s.sector || '기타'}): ${s.action} — ${s.reason}`)
    .join('\n');

  const prompt =
    `포트폴리오 종합 분석 (JSON만 출력)\n\n` +
    `[종목코드→종목명 매핑] ${mappingTable}\n\n` +
    `총 수익률: ${totalProfitRate.toFixed(2)}% | 보유종목: ${holdingCount}개\n` +
    `${lines}\n\n` +
    `{"summary":"4-5문장 종합 평가(전체 수익률·강약점·수급·전략)","sectors":[{"name":"섹터명","tickers":["코드"],"weight":정수,"warning":boolean}],"suggestions":["구체적 제안1","제안2","제안3","제안4"]}\n\n` +
    `규칙:\n` +
    `- sectors weight 합계=100\n` +
    `- suggestions는 구체적 전략(단순 모니터링 금지)\n` +
    `- summary와 suggestions에서 종목을 언급할 때는 반드시 종목명을 사용하고 종목코드(숫자 6자리)는 절대 출력하지 마세요`;

  try {
    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system: '한국주식 포트폴리오 매니저. 섹터분석·리스크분산·전략수립 전문. JSON만 출력. 종목 언급 시 반드시 종목명 사용, 종목코드(숫자 6자리) 출력 금지.',
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    return parseAiJson(text, { summary: '', sectors: [], suggestions: [] });
  } catch (e) {
    console.error('[PORTFOLIO-DIAGNOSIS] 종합 분석 실패:', e);
    return { summary: '', sectors: [], suggestions: [] };
  }
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

  const isPro  = await checkPro(supabase, user.id, user.email);
  const count  = await getMonthlyCount(supabase, user.id);
  return NextResponse.json({
    isPro,
    count,
    remaining: isPro ? Math.max(0, MONTHLY_LIMIT - count) : 0,
  });
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── 1. Auth (정상 JSON 에러 반환) ──────────────────────────────────────────
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

        const analysisResults = await Promise.allSettled(
          holdings.map(h => collectStockAnalysisData(h.ticker, h.name)),
        );

        const enriched: EnrichedHolding[] = holdings.map((h, i) => {
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

        // Stage 1: 종목별 개별 분석 (병렬)
        send(controller, { type: 'progress', label: `${enriched.length}개 종목 개별 분석 중...` });
        console.log(`[PORTFOLIO-DIAGNOSIS] Stage 1 시작 — ${enriched.length}개 병렬 분석`);

        const stockResults = await Promise.all(enriched.map(h => analyzeOneStock(h)));

        // Stage 2: 포트폴리오 종합 분석
        send(controller, { type: 'progress', label: '포트폴리오 종합 분석 중...' });
        console.log('[PORTFOLIO-DIAGNOSIS] Stage 2 시작 — 종합 분석');

        // ticker → 종목명 매핑 (AI가 summary/suggestions에 종목명 사용하도록)
        const nameMap: Record<string, string> = {};
        enriched.forEach(h => { nameMap[h.ticker] = h.name; });

        const summary = await analyzePortfolioSummary(stockResults, nameMap, totalProfitRate, enriched.length);

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
          summary:     summary.summary     ?? '',
          sectors:     summary.sectors     ?? [],
          holdings:    mergedHoldings,
          suggestions: summary.suggestions ?? [],
        };

        // DB 저장
        try {
          await supabase.from('portfolio_diagnosis').insert({
            user_id: user.id,
            result:  finalResult,
          });
        } catch { /* ignore */ }

        console.log('[PORTFOLIO-DIAGNOSIS] 완료');
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
