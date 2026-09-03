import { NextRequest, NextResponse, after } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { deductCredit } from '@/lib/credits';
import { checkPlan, resolvePortfolioLimit, getUsageCycleStart } from '@/lib/plan';
import {
  collectStockAnalysisData,
  computeRiskMetrics,
  computeSurgeHistory,
  buildSurgeHistoryBlock,
  computeTradingValueMultiple,
  buildTradingValueBlock,
} from '@/lib/stock-analysis-data';
import { fetchDailyChart, fetchIndexRangeChange, fetchDividendHistory, type DividendHistoryRow } from '@/lib/kis-api';
import { fetchDividendSummary, type DartDividendSummary } from '@/lib/dart-api';
import { computePortfolioDividendSummary } from '@/lib/dividend-aggregation';
import { selectRelevantNews, type NewsCandidate } from '@/lib/news-selection';
import { selectSectorMacroNews } from '@/lib/sector-news';
import { fetchSectorSentiment, type SectorSentimentEntry } from '@/lib/news-sentiment';
import { kstDateStr, daysBetween } from '@/lib/ai-grounding';
import { getDomesticMarketDayContext } from '@/lib/market-day-context';
import type { Database } from '@/lib/database.types';
// 2026-08-12 대시보드 신설을 계기로 Stage1/Stage2 스트리밍 로직을 공용 모듈로 추출
// (lib/portfolio-analysis-pipeline.ts) — app/api/dashboard/analysis/route.ts와 함께 쓴다.
import {
  type HoldingInput, type EnrichedHolding, type StockAiResult, type PrevPortfolioRow,
  EMPTY_SUMMARY_SECTIONS,
  buildPortfolioMarketDayBlock, buildPortfolioHistoryBlock, buildCoMovementText, buildHoldingPeriodFactsLine,
  analyzeOneStock, analyzePortfolioSummary,
  computeSectorBreakdown, computeSectorConcentration, computeRiskContribution,
  computePortfolioCorrelation, buildCorrelationFactsLine,
  // 정량 지표(A/B/C-1) 공통 게이트 — 종목 수가 이보다 적으면 지표 자체가 무의미(N=1은
  // 섹터든 상관관계든 계산할 대상이 없음)하다고 판단해 프론트에서 카드를 숨기고 캡션으로
  // 대체한다(설계 검토 합의 사항).
  MIN_HOLDINGS_FOR_QUANT_METRICS,
} from '@/lib/portfolio-analysis-pipeline';
import { buildPortfolioStructureFacts } from '@/lib/portfolio-structure-facts';
import { computeWeightDrift } from '@/lib/portfolio-position';

export const dynamic     = 'force-dynamic';
// 2026-07-13 프로덕션 조사: Stage 2(포트폴리오 종합 분석) 단일 호출만 실측 43~46초
// (3차 고도화로 요구 필드가 7개로 늘며 출력이 길어진 영향) — Stage 0(최대 15초) + 벤치마크
// (순차, 최대 8초) + Stage 1(병렬, 실측 최대 ~8초) + Stage 2(~46초)를 합치면 최악 케이스
// 약 76~89초로 기존 60초를 구조적으로 초과해 Vercel이 함수를 강제 종료했다(로컬은 이
// 제약이 없어 항상 성공, "로컬은 되는데 프로덕션은 안 되는" 증상과 일치). 실측치 대비
// 30~40초 여유를 두고 120으로 상향.
export const maxDuration = 120;

const MAX_HOLDINGS        = 10;

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

// subscription_start_date 기준 이번 달 이용 건수 — 사이클 계산은 lib/plan.ts의
// getUsageCycleStart로 공용화(2026-07-14, app/api/mypage/route.ts와 중복이던 로직 통합).
async function getMonthlyCount(
  supabase: ReturnType<typeof makeSupabase>,
  userId: string,
): Promise<number> {
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('subscription_start_date')
      .eq('id', userId)
      .maybeSingle();

    const { cycleStart } = getUsageCycleStart(userRow?.subscription_start_date ?? null, new Date());

    const { count } = await supabase
      .from('portfolio_diagnosis')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', cycleStart.toISOString());
    return count ?? 0;
  } catch { return 0; }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timer = new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms));
  return Promise.race([promise, timer]);
}


// ── SSE helper ──────────────────────────────────────────────────────────────

// 2026-08-11 발견: enqueue가 send(controller,...)를 통해 claudeStream.on('text', ...)
// 콜백(analyzeOneStock/analyzePortfolioSummary의 onField·onPartial) "안에서" 호출되는
// 구조라, 클라이언트가 스트리밍 도중 연결을 끊으면 controller가 즉시 닫혀 enqueue가
// 예외를 던지고 — 그 예외가 on('text') 밖으로 전파돼 각 단계가 "진짜 생성 실패"로
// 오인해 실제 생성된 내용 대신 빈 폴백을 반환했다(단순 중단보다 나쁨 — 저장은 되지만
// 내용이 비어버림). 클라이언트가 끊긴 건 서버 쪽 생성/저장 로직에 영향을 주면 안 되므로
// 여기서 조용히 무시한다.
function sseEncode(ctrl: ReadableStreamDefaultController, encoder: TextEncoder, data: object) {
  try {
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  } catch { /* 클라이언트가 이미 끊었으면 무시 — Claude 스트림 소비·DB 저장은 계속돼야 함 */ }
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
  const limit   = resolvePortfolioLimit(plan);
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
  const limit = resolvePortfolioLimit(plan);
  if (!usedCredit && count >= limit) {
    // 월 한도 초과 시에도 1회권 크레딧 원자적 차감
    const result = await deductCredit(user.id, 'portfolio');
    if (result.success === false) {
      if (result.reason === 'error') {
        return NextResponse.json({ error: '크레딧 확인 중 오류가 발생했습니다.' }, { status: 500 });
      }
      return NextResponse.json(
        { error: `이번 달 이용 한도(${limit}회)를 모두 사용했습니다. 다음 결제일에 초기화됩니다.` },
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

        // 2026-07-23: 뉴스 조회를 종목명 단독 검색에서 종목명+종목코드 병행 검색 +
        // Haiku 1차 선별로 교체(lib/news-selection.ts, 종목분석에서 이미 검증됨).
        // collectStockAnalysisData 완료를 기다리지 않도록 promise를 미리 만들어
        // 재사용 — 종목별로 selectRelevantNews가 완전히 병렬로 나가야 보유종목
        // 수와 무관하게 Stage 0 시간이 늘어나지 않는다(analysisResults 배치와
        // 동일하게 holdings.map()으로 병렬 fan-out).
        const analysisDataPromises = holdings.map(h =>
          // 2026-09-03 트래픽점검 10번: 보유종목 수만큼 fan-out되는 서버 내부 배치 호출 — 'batch'
          // (소프트캡에서 거부 대신 대기, lib/kis-api.ts acquireKisRateSlot 주석 참고).
          withTimeout(collectStockAnalysisData(h.ticker, h.name, { priority: 'batch' }), 8000, null)
        );

        // 업종 매크로 뉴스 — 종목분석/기업분석과 동일한 lib/sector-news.ts 재사용.
        // holdings 수가 아니라 "distinct 업종 수"만큼만 fan-out(같은 업종 종목이 여러
        // 개면 1번만 조회) — analysisDataPromises가 전부 resolve된 뒤에야 각 종목의
        // sector(KIS bstp_kor_isnm)를 알 수 있으므로 그 결과를 체이닝한다. 단,
        // analysisDataPromises 자체는 위 analysisResults와 같은 promise 객체를
        // 재사용하므로(참조 동일) collectStockAnalysisData가 중복 호출되지는 않는다.
        const sectorMacroMapPromise: Promise<Map<string, NewsCandidate[]>> = Promise.allSettled(analysisDataPromises)
          .then(async (results) => {
            const sectors = new Set<string>();
            results.forEach((r) => {
              const s = (r.status === 'fulfilled' ? r.value?.sector : '') ?? '';
              if (s.trim().length >= 2) sectors.add(s.trim());
            });
            const sectorList = [...sectors];
            const settled = await Promise.allSettled(sectorList.map((s) => selectSectorMacroNews(s)));
            const map = new Map<string, NewsCandidate[]>();
            sectorList.forEach((s, i) => {
              const r = settled[i];
              map.set(s, r.status === 'fulfilled' ? r.value.items : []);
            });
            console.log(`[PORTFOLIO-DIAGNOSIS] 업종 매크로 뉴스 fan-out: 종목 ${holdings.length}개 → 업종 ${sectorList.length}개 (${sectorList.join(', ') || '없음'})`);
            return map;
          });

        // 2026-08-24: selectRelevantNews에 오늘 등락률을 주입해야 선별 프롬프트 규칙 1
        // ("오늘 가격변동의 실제 원인 최우선 선택")이 발동한다(lib/news-selection.ts 참고).
        // 별도 KIS 호출을 추가하지 않고, 이미 fetch하는 차트의 마지막 2개 종가로 계산하는
        // 기존 todayChangeRate 로직(아래 enriched map)을 재사용 — chartPromises를 이름 붙여
        // 빼내서 종목별 selectRelevantNews가 "자기 종목의" 차트 resolve를 기다린 뒤 시작하게
        // 체이닝한다(다른 종목의 차트/선별과는 무관하게 종목별로 독립적으로 진행 — holdings
        // 수와 무관하게 fan-out 병렬성은 유지됨). 차트 타임아웃(15초)에 선별 타임아웃(12초)이
        // 더해져 종목당 최악 지연이 늘어날 수 있는 트레이드오프가 있음 — 실측 검증 필요.
        const chartPromises = holdings.map(h =>
          withTimeout(fetchDailyChart(h.ticker, '1Y', { priority: 'batch' }), 15000, null).then(v => {
            if (v === null) console.warn(`[PORTFOLIO-DIAGNOSIS] ${h.ticker}(${h.name}) 차트 조회 실패/타임아웃 — 손익 기여도·급등이력·거래대금배수 계산에서 제외됨`);
            return v;
          })
        );

        const newsSelectionPromises = holdings.map((h, i) => {
          const extraCandidates: Promise<NewsCandidate[]> = analysisDataPromises[i].then(
            (ad) => (ad?.news ?? []).map(n => ({ title: n.title, summary: n.summary, date: n.date, url: n.url })),
            () => [],
          );
          const changeRatePromise: Promise<number | undefined> = chartPromises[i].then(
            (chart) => {
              if (!chart || chart.length < 2) return undefined;
              const todayClose = chart[chart.length - 1].close;
              const prevClose = chart[chart.length - 2].close;
              return (todayClose > 0 && prevClose > 0) ? ((todayClose - prevClose) / prevClose) * 100 : undefined;
            },
            () => undefined,
          );
          return changeRatePromise.then((changeRate) => withTimeout(
            selectRelevantNews(h.ticker, h.name, extraCandidates, changeRate),
            12000,
            { items: [], isCached: false, apiError: true }, // 타임아웃도 "확인 자체를 못함" 상태
          ));
        });

        const [analysisResults, chartResults, newsSelectionResults, sectorMacroMap, dividendResults] = await Promise.all([
          Promise.allSettled(analysisDataPromises),
          // '3M'→'1Y': computeSurgeHistory(최근 약 5개월 이력)에 필요한 최소 기간 확보.
          // 호출 수는 그대로(종목당 1회) — MDD/변동성 계산도 배열이 길어져도 동일하게 동작.
          // 타임아웃 8초→15초(2026-07-13 발견): fetchDailyChart 내부 자체 타임아웃이
          // 시장 코드(J/Q)당 10초라 최악의 경우 20초까지 걸리는데, 바깥 래퍼가 8초로
          // 더 짧으면 KIS 응답이 오기도 전에 먼저 포기해서 오늘 손익 기여도·급등이력·
          // 거래대금배수가 조용히 null 처리되는 버그가 있었다(4종목 동시 요청 부하에서
          // 매번 다른 종목이 랜덤하게 누락됨 — 실측: 모베이스전자).
          Promise.allSettled(chartPromises),
          Promise.allSettled(newsSelectionPromises),
          sectorMacroMapPromise,
          // 배당 정보(2026-08-04 신설) — DART 요약(7일 캐시) + KIS 5년 이력(24시간 캐시).
          // 기존 chart(15초 상한)와 같은 Promise.all에 편승시켜 새 병목을 만들지 않는다
          // — 최악의 경우(완전 콜드 캐시)에도 이미 지배적인 chart fetch와 동시에 진행된다.
          Promise.allSettled(
            holdings.map(h => Promise.all([fetchDividendSummary(h.ticker), fetchDividendHistory(h.ticker, { priority: 'batch' })])),
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
          const sectorMacroNews = sectorMacroMap.get((ad?.sector ?? '').trim()) ?? [];

          const newsRes = newsSelectionResults[i];
          const relevantNews = newsRes.status === 'fulfilled' ? newsRes.value.items : [];

          const cr        = chartResults[i];
          const chartData = (cr.status === 'fulfilled' && cr.value) ? cr.value : [];
          const closes    = chartData.map(p => p.close);
          const risk      = computeRiskMetrics(closes);

          // 오늘 손익 기여도 — 신규 API 호출 없이 이미 fetch한 차트의 마지막 2개 종가로 계산
          let todayChangeRate: number | null = null;
          let todayContribution: number | null = null;
          if (chartData.length >= 2) {
            const todayClose = chartData[chartData.length - 1].close;
            const prevClose  = chartData[chartData.length - 2].close;
            if (todayClose > 0 && prevClose > 0) {
              todayChangeRate   = ((todayClose - prevClose) / prevClose) * 100;
              todayContribution = (todayClose - prevClose) * h.quantity;
            }
          }

          const surgeHistory      = chartData.length ? computeSurgeHistory(chartData) : null;
          const surgeHistoryBlock = surgeHistory?.hasMatches ? buildSurgeHistoryBlock(surgeHistory) : null;

          // 거래대금배수(우선순위 최상, 2026-07-13 2차 고도화) — "오늘 이 종목이 얼마나
          // 얇은/두꺼운 거래량에서 움직였는지"는 포트폴리오 리스크 판단에 직결.
          const tradingValueMultiple = chartData.length ? computeTradingValueMultiple(chartData) : null;
          const tradingValueBlock    = tradingValueMultiple?.valid ? buildTradingValueBlock(tradingValueMultiple) : null;

          const dr              = dividendResults[i];
          const dividendSummary = dr.status === 'fulfilled' ? dr.value[0] : null;
          const dividendHistory = dr.status === 'fulfilled' ? dr.value[1] : [];

          return {
            ...h, name: resolvedName, currentPrice, invested, value, profit, profitRate,
            analysisData: ad, relevantNews, sectorMacroNews,
            dividendSummary, dividendHistory,
            mdd:        risk?.mdd        ?? null,
            volatility: risk?.volatility ?? null,
            todayChangeRate, todayContribution, surgeHistoryBlock, tradingValueBlock,
          };
        });

        // 거래일 상태 — 포트폴리오는 현재 국내 종목만 지원하므로(app/portfolio-diagnosis/
        // page.tsx: "국내 기업만 지원됩니다") 보유 종목 전체가 같은 국내 캘린더를 공유한다
        // — 종목별로 따로 판정할 필요 없이 1회만 계산. 별도 KIS 재조회 없이 위에서 이미
        // 받은 종목별 차트 중 하나(첫 성공 응답)를 재사용한다(lib/market-day-context.ts).
        const firstAvailableChart = chartResults
          .map(r => (r.status === 'fulfilled' && r.value) ? r.value : [])
          .find(c => c.length > 0) ?? [];
        const marketDayContext = getDomesticMarketDayContext(firstAvailableChart);
        if (!marketDayContext.isTradingDay) {
          console.log(`[PORTFOLIO-DIAGNOSIS] 휴장일 감지(${marketDayContext.reason}) — 마지막 거래일 ${marketDayContext.lastTradingDate} 기준으로 서술 지시`);
        }

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
            const kospi = await withTimeout(fetchIndexRangeChange('0001', avgBuyDate, new Date(), { priority: 'batch' }), 8000, null);
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

        // 정량 지표 B(종목간 상관관계)·C-1(변동성 기여도) — 섹터 그룹핑(A)과 달리
        // stockResults(Stage 1) 없이도 이미 계산 가능해서(둘 다 value/volatility/차트만
        // 필요) Stage 1을 기다리지 않고 meta 이벤트로 바로 흘려보낸다. 종목 수가
        // MIN_HOLDINGS_FOR_QUANT_METRICS 미만이면 지표 자체가 무의미해 null로 둔다.
        const hasEnoughHoldingsForQuant = enriched.length >= MIN_HOLDINGS_FOR_QUANT_METRICS;
        const riskContribution = hasEnoughHoldingsForQuant
          ? computeRiskContribution(enriched, totalValue)
          : null;
        // 2026-09-01: 매입 시점 비중 → 현재 비중 드리프트(순수 사실) — 카드 + 프롬프트 사실 블록 양쪽에 사용
        const weightDrift = computeWeightDrift(enriched.map(h => ({ ticker: h.ticker, name: h.name, invested: h.invested, value: h.value, profitRate: h.profitRate })));
        const correlation = hasEnoughHoldingsForQuant
          ? computePortfolioCorrelation(enriched.map((h, i) => {
              const cr = chartResults[i];
              return { weight: totalValue > 0 ? h.value / totalValue : 0, chart: (cr.status === 'fulfilled' && cr.value) ? cr.value : [] };
            }))
          : null;

        // 배당 정보(2026-08-04 신설) — 전체 무배당이면 null(섹션 자체 미노출).
        const dividendSummary = computePortfolioDividendSummary(
          enriched.map(h => ({
            ticker: h.ticker, name: h.name, quantity: h.quantity,
            dividendSummary: h.dividendSummary, dividendHistory: h.dividendHistory,
          })),
          totalValue,
        );

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

        // ── 직전 진단(오늘 이전 가장 최근 1건) 조회 — "직전 진단 대비" 계산용 ──────
        const todayStr = kstDateStr();
        let prevRow: PrevPortfolioRow | null = null;
        try {
          const { data } = await supabase
            .from('portfolio_diagnosis')
            .select('report_date, result, created_at')
            .eq('user_id', user.id)
            .lt('report_date', todayStr)
            .order('report_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          prevRow = data as PrevPortfolioRow | null;
        } catch (e) {
          console.warn('[PORTFOLIO-DIAGNOSIS] 직전 진단 조회 실패, 비교 없이 진행:', e instanceof Error ? e.message : e);
        }
        const daysSinceLastReport = (prevRow && prevRow.report_date) ? daysBetween(todayStr, prevRow.report_date) : null;
        const currentHoldingsForHistory = enriched.map(h => ({ ticker: h.ticker, name: h.name }));
        // 2026-09-01: 직전 진단 대비 서술(historyNarrative)은 제거됐고, 여기서는 과거 리포트/공유
        // 스냅샷 호환을 위한 history 수치(구성 변화·직전 수치)만 계산해 저장한다.
        const { addedTickers, removedTickers, compositionChanged } = buildPortfolioHistoryBlock(
          prevRow,
          { totalProfitRate, totalProfit, holdings: currentHoldingsForHistory },
          daysSinceLastReport,
        );

        // ── 오늘 손익 기여도 상위 종목 (방향당 최대 N개 컷오프, N은 보유종목 수에 비례) ──
        // 2026-07-13 4차 개선: N을 3으로 고정하면 보유종목이 늘어날 때(최대 10개) 상위
        // 기여 종목을 너무 적게 보여주게 된다 — 최소 3, 최대 5, 그 사이는 보유종목 수의
        // 절반로 스케일. 주의: 이 N은 "상승/하락 각 방향의 컷오프"일 뿐이라 실제 표시되는
        // 총 종목 수(양+음 합계, 극단치 강제포함분 포함)와 다를 수 있다 — UI 라벨에 쓸
        // 개수는 아래 finalResult에서 topPositive.length + topNegative.length로 별도 계산한다.
        const topContributorsN = Math.min(5, Math.max(3, Math.ceil(enriched.length / 2)));
        const contributors = enriched.filter(h => h.todayContribution !== null);
        const topPositive = [...contributors].filter(h => (h.todayContribution as number) > 0)
          .sort((a, b) => (b.todayContribution as number) - (a.todayContribution as number)).slice(0, topContributorsN);
        const topNegative = [...contributors].filter(h => (h.todayContribution as number) < 0)
          .sort((a, b) => (a.todayContribution as number) - (b.todayContribution as number)).slice(0, topContributorsN);

        const mostExtreme = [...contributors].sort(
          (a, b) => Math.abs(b.todayChangeRate as number) - Math.abs(a.todayChangeRate as number),
        )[0];
        if (mostExtreme && !topPositive.includes(mostExtreme) && !topNegative.includes(mostExtreme)) {
          if ((mostExtreme.todayContribution as number) >= 0) topPositive.push(mostExtreme);
          else topNegative.push(mostExtreme);
        }

        const fmtContrib = (h: EnrichedHolding) => `${h.name} ${(h.todayContribution as number) >= 0 ? '+' : ''}${Math.round(h.todayContribution as number).toLocaleString()}원 (${(h.todayChangeRate as number) >= 0 ? '+' : ''}${(h.todayChangeRate as number).toFixed(2)}%)`;
        const contributionFactsLine = contributors.length > 0
          ? [
              topPositive.length ? `- 상승 기여 상위: ${topPositive.map(fmtContrib).join(', ')}` : null,
              topNegative.length ? `- 하락 기여 상위: ${topNegative.map(fmtContrib).join(', ')}` : null,
            ].filter(Boolean).join('\n') || '뚜렷한 기여 종목 없음'
          : '오늘 등락 데이터 없음';

        // ── 보유 기간별 관점 (3-1) — 최장/최근 보유 종목 성과 비교 ─────────────────
        const holdingPeriodFacts = buildHoldingPeriodFactsLine(enriched, todayStr);

        // 2026-07-27 스트리밍 전환 — 여기까지는 전부 서버가 Claude 호출 전에 이미 계산해
        // 둔 값들이라(집계 금액·벤치마크·직전 진단 대비·손익 기여도·보유기간) Stage 1을
        // 시작하기 전에 먼저 통째로 흘려보낸다. 프론트는 이걸로 상단 숫자 카드들을 즉시
        // 그리고, 종목별 카드도 스켈레톤(숫자는 이미 채워짐, reason만 비어있음) 상태로
        // 입력 순서 그대로 먼저 그릴 수 있다.
        send(controller, {
          type: 'meta',
          totalInvested,
          totalValue,
          totalProfit,
          totalProfitRate: parseFloat(totalProfitRate.toFixed(2)),
          benchmark,
          history: {
            daysSince: daysSinceLastReport,
            prevDate: prevRow?.report_date,
            prevTotalProfitRate: prevRow?.result?.totalProfitRate ?? null,
            prevTotalProfit:     prevRow?.result?.totalProfit     ?? null,
            compositionChanged,
            addedTickers,
            removedTickers,
          },
          topContributors: {
            n: topPositive.length + topNegative.length,
            positive: topPositive.map(h => ({ ticker: h.ticker, name: h.name, amount: Math.round(h.todayContribution as number) })),
            negative: topNegative.map(h => ({ ticker: h.ticker, name: h.name, amount: Math.round(h.todayContribution as number) })),
          },
          holdingPeriod: {
            longest:    holdingPeriodFacts.longest,
            mostRecent: holdingPeriodFacts.mostRecent,
          },
          dividend: dividendSummary,
          riskContribution,
          correlation,
          weightDrift,
        });
        send(controller, {
          type: 'holding-meta',
          holdings: enriched.map(h => ({
            ticker:       h.ticker,
            name:         h.name,
            currentPrice: h.currentPrice,
            avgPrice:     h.avgPrice,
            quantity:     h.quantity,
            value:        h.value,
            invested:     h.invested,
            profit:       h.profit,
            profitRate:   parseFloat(h.profitRate.toFixed(2)),
            newsBasis:    h.relevantNews.length > 0 ? 'news' : 'estimated',
            news:         h.relevantNews,
            mdd:          h.mdd,
            volatility:   h.volatility,
            todayContribution: h.todayContribution,
            isCached:     h.analysisData?.isCached,
            cachedAt:     h.analysisData?.cachedAt,
            dividendSummary: h.dividendSummary,
            dividendHistory: h.dividendHistory,
          })),
        });

        // Stage 1: 종목별 개별 분석 (병렬) — 종목마다 완료되는 대로 holding-field(-partial)를
        // 그 종목의 ticker를 실어 보낸다. 프론트는 위 holding-meta로 이미 그려둔 자기 자리에서
        // 채운다(카드 위치는 입력 순서 고정, 내용만 완료 순서대로).
        send(controller, { type: 'progress', label: `${enriched.length}개 종목 개별 분석 중...` });
        console.log(`[PORTFOLIO-DIAGNOSIS] Stage 1 시작 — ${enriched.length}개 병렬 분석`);

        const portfolioMarketDayBlock = buildPortfolioMarketDayBlock(marketDayContext);
        const stockResults = await Promise.all(enriched.map(h => analyzeOneStock(
          h, portfolioMarketDayBlock,
          (key, value) => send(controller, { type: 'holding-field-partial', ticker: h.ticker, key, value }),
          (key, value) => send(controller, { type: 'holding-field', ticker: h.ticker, key, value }),
        )));

        // 섹터별 최근 뉴스 논조(2단계 UI 노출, 2026-08-21) — "섹터 편중도 분석" 카드와 동일한
        // 그룹핑 키(stockResults의 AI sector 라벨)를 그대로 재사용해 두 카드의 섹터명이 어긋나지
        // 않게 한다. Stage 2(~46초, 아래 analyzePortfolioSummary)와 겹치도록 여기서 미리 시작만
        // 해두고 finalResult 조립 직전에 await — 순수 DB 조회라 Stage 2 지연에 편승해도 체감
        // 추가 지연이 없다. .catch()로 감싸 이 promise 자체가 절대 reject하지 않게 한다 —
        // 아래 await 지점이 route.ts 최상위 try/catch 안에 있어서, 감싸지 않으면 이 순수
        // 부가 기능(섹터 논조) 하나의 일시적 오류가 이미 스트리밍된 Stage1/Stage2 결과 전체를
        // 'error' 이벤트로 날려버리고 DB 저장(아래 after())까지 건너뛰게 만들 수 있었다.
        // 2026-08-21 수정: 그룹핑 키를 AI가 종목마다 자유 텍스트로 붙이는 stockResults[].sector
        // 대신 KIS 원천 분류(analysisData.sector, 예: "전기·전자")로 교체 — buildCoMovementText()가
        // 이미 겪고 고친 것과 동일한 문제였다(위 coMovementText 계산부 주석 참고: 삼성전자/
        // SK하이닉스가 KIS 분류로는 둘 다 "전기·전자"인데 AI 자유텍스트로는 "반도체·전자"/"반도체"로
        // 갈려 별개 섹터처럼 보였음, 2026-08-21 실사용 스크린샷으로 재현 확인). KIS 분류가 없는
        // 경우(조회 실패 등)에만 AI sector로 폴백 — h.analysisData가 collectStockAnalysisData
        // 실패 시 null일 수 있어 완전히 배제하면 그 종목이 통째로 커버리지 밖으로 빠진다.
        const sectorSentimentPromise = fetchSectorSentiment(
          enriched.map(h => ({
            ticker: h.ticker,
            sector: h.analysisData?.sector || stockResults.find(s => s.ticker === h.ticker)?.sector || '',
          })),
        ).catch((e) => {
          console.warn('[PORTFOLIO-DIAGNOSIS] 섹터별 뉴스 논조 조회 실패, 카드 생략:', e instanceof Error ? e.message : e);
          return [] as SectorSentimentEntry[];
        });

        // 섹터 co-movement 사실 — 그룹핑·방향 판정은 AI 호출 없이 서버가 결정형으로 계산
        // (컴플라이언스 리스크 없는 순수 사실). 이 사실을 Stage 2 프롬프트에 넣어
        // "왜/무슨 함의인지"는 AI가 해석하게 한다(2026-07-13 3차 고도화 — 사실 재조합에
        // 그쳤던 문제 개선). stockResults(각 종목의 AI sector 라벨)가 있어야 계산 가능해서
        // Stage 1이 끝난 지금 시점에야 알 수 있다 — stage1-done 이벤트로 함께 통지.
        const coMovementText = buildCoMovementText(enriched, stockResults);
        const coMovementFactsLine = coMovementText ?? '동조화 사례 없음';
        const correlationFactsLine = buildCorrelationFactsLine(correlation);
        send(controller, { type: 'stage1-done', coMovementText });

        // 정량 지표 A(섹터 실효분산업종수) — 그룹핑 키가 stockResults(AI sector 라벨
        // 폴백)를 필요로 해서 co-movement와 같은 시점(Stage 1 완료 직후)에야 계산 가능.
        // sectors는 더 이상 AI 추정치가 아니라 여기서 계산한 실제 평가금액 기준 값을
        // finalResult에 그대로 쓴다 — analyzePortfolioSummary는 이제 이 필드를 만들지 않는다.
        const sectors = computeSectorBreakdown(enriched, stockResults, totalValue);
        const sectorConcentration = hasEnoughHoldingsForQuant ? computeSectorConcentration(sectors) : null;
        send(controller, { type: 'portfolio-field', key: 'sectors', value: sectors });
        send(controller, { type: 'portfolio-field', key: 'sectorConcentration', value: sectorConcentration });

        // Stage 2: 포트폴리오 종합 분석
        send(controller, { type: 'progress', label: '포트폴리오 종합 분석 중...' });
        console.log('[PORTFOLIO-DIAGNOSIS] Stage 2 시작 — 종합 분석');

        // ticker → 종목명 / 관련 뉴스 매핑 (AI가 summary에 종목명·뉴스 근거 사용하도록)
        const nameMap: Record<string, string> = {};
        const newsMap: Record<string, { title: string; summary?: string }[]> = {};
        enriched.forEach(h => {
          nameMap[h.ticker] = h.name;
          newsMap[h.ticker] = h.relevantNews;
        });

        // Stage 2는 재생성이 없어 dedup은 "정합성 보정이 스트리밍 완결값과 같으면 중복
        // 전송 생략" 용도로만 쓰인다(종목분석과 동일 패턴, 재시도 diff 목적은 아님).
        const sentPortfolioValues: Record<string, unknown> = {};
        const emitPortfolioField = (key: string, value: unknown) => {
          if (JSON.stringify(sentPortfolioValues[key]) === JSON.stringify(value)) return;
          sentPortfolioValues[key] = value;
          send(controller, { type: 'portfolio-field', key, value });
        };
        const emitPortfolioPartial = (key: string, value: string) =>
          send(controller, { type: 'portfolio-field-partial', key, value });

        // 시간적 사실관계 검증용 — 업종별로 이미 중복 제거된 sectorMacroNews를 다시
        // 제목 기준으로 dedup(같은 업종 종목이 여러 개면 동일 배열이 여러 번 들어옴).
        const seenSectorMacroTitles = new Set<string>();
        const sectorMacroNewsFlat = enriched
          .flatMap(h => h.sectorMacroNews)
          .filter(n => (seenSectorMacroTitles.has(n.title) ? false : (seenSectorMacroTitles.add(n.title), true)));

        // 2026-09-01: AI 종합평가를 "포트폴리오 구조 분석"으로 재설계 — 서버가 이미 계산한
        // 비중·섹터 집중도·상관계수·변동성 기여도·손익 구조를 한 블록으로 정리해 Stage 2의
        // 핵심 근거로 넘긴다(lib/portfolio-structure-facts.ts). sectors/sectorConcentration은
        // Stage 1 완료 직후(바로 위)에야 계산되므로 이 시점에 만든다.
        const structureFactsBlock = buildPortfolioStructureFacts({
          holdings: enriched.map(h => ({
            ticker: h.ticker, name: h.name, value: h.value, invested: h.invested,
            profit: h.profit, profitRate: h.profitRate, volatility: h.volatility,
          })),
          totalValue, totalInvested, totalProfit,
          sectors, sectorConcentration, riskContribution, correlation, weightDrift,
        });

        const summary = await analyzePortfolioSummary(
          stockResults, nameMap, newsMap, sectorMacroNewsFlat, totalProfitRate, enriched.length, benchmark,
          { lossCount, lossWeightPct, riskiestLines },
          contributionFactsLine, holdingPeriodFacts.line,
          coMovementFactsLine, correlationFactsLine, structureFactsBlock, portfolioMarketDayBlock,
          emitPortfolioPartial, emitPortfolioField,
        );
        // Stage 1은 다 됐는데 Stage 2만 실패/폴백된 경우 — 이미 보여준 종목별 카드는
        // 그대로 두고 "종합 평가" 자리에만 배너+재시도를 띄우도록 프론트에 명시적으로 알림
        // (알림 없이 빈 문자열만 보내면 사용자는 그냥 내용이 없는 건지 실패한 건지 구분 못함).
        if (summary._failed) {
          send(controller, { type: 'stage2-error' });
        }

        const sectorSentiment: SectorSentimentEntry[] = await sectorSentimentPromise;
        // portfolio-field 이벤트로 즉시 방출 — finalResult는 DB 저장 전용이라(위 'done' 이벤트
        // 주석 참고) 스트리밍 중인 클라이언트에는 이렇게 개별 필드로 보내야 반영된다.
        emitPortfolioField('sectorSentiment', sectorSentiment);

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
            todayContribution: h.todayContribution,
            isCached:     h.analysisData?.isCached,
            cachedAt:     h.analysisData?.cachedAt,
            dividendSummary: h.dividendSummary,
            dividendHistory: h.dividendHistory,
            // 2026-09-03 최종 다듬기: 종목별 개별 이슈 카드 → 기업별 관찰 지표 배지 옆 성격 태그로 흡수
            issueTag: summary.holdingTags?.find(t => t.ticker === h.ticker)?.tag ?? null,
          };
        });

        const finalResult = {
          totalInvested,
          totalValue,
          totalProfit,
          totalProfitRate: parseFloat(totalProfitRate.toFixed(2)),
          summary:            summary.summary            ?? '',
          summarySections:    summary.summarySections    ?? EMPTY_SUMMARY_SECTIONS,
          // sectors는 더 이상 AI 추정치가 아니라 실제 평가금액 기준 서버 계산값(위 Stage 1
          // 직후 computeSectorBreakdown) — summary(AI 응답)에는 이 필드가 아예 없다.
          sectors,
          sectorConcentration,
          riskContribution,
          correlation,
          weightDrift,
          sectorSentiment,
          holdings:           mergedHoldings,
          // 2026-09-03 최종 다듬기: riskFactors/opportunityFactors(문장 카드) → holdingTags(종목별 성격 태그).
          // 옛 리포트의 두 배열은 저장돼 있어도 더 이상 렌더링하지 않는다.
          holdingTags:        summary.holdingTags        ?? [],
          shortTermOutlook:   summary.shortTermOutlook    || '',
          midTermOutlook:     summary.midTermOutlook      || '',
          benchmark,
          history: {
            daysSince: daysSinceLastReport,
            prevDate: prevRow?.report_date,
            prevTotalProfitRate: prevRow?.result?.totalProfitRate ?? null,
            prevTotalProfit:     prevRow?.result?.totalProfit     ?? null,
            compositionChanged,
            addedTickers,
            removedTickers,
            // 2026-09-01: "직전 진단 대비" 카드를 포트폴리오분석에서 제거 — 수치(prev*·구성 변화)는
            // 과거 리포트/공유 스냅샷 호환을 위해 그대로 저장하되 AI 서술은 더 이상 생성하지 않는다.
            narrative: '',
          },
          // 서버 계산 금액을 그대로 노출 — AI(contributionNarrative)가 숫자를 옮겨 적다 틀릴
          // 여지를 없앤다(2026-07-13 발견: AI 서술에만 의존하면 실제 금액과 어긋날 수 있음).
          topContributors: {
            // 2026-07-13 발견: topContributorsN은 "방향당 컷오프"라 상승/하락 각각
            // 그 값까지 담길 수 있고 극단치 종목이 강제로 하나 더 추가될 수도 있어서,
            // 실제 표시되는 총 개수와 다를 수 있었다(실측: 컷오프 3인데 5종목 표시).
            // 라벨은 반드시 아래 두 배열의 실제 길이 합으로 계산한다.
            n: topPositive.length + topNegative.length, // UI 라벨용 — "오늘 손익 영향이 가장 큰 N종목"
            positive: topPositive.map(h => ({ ticker: h.ticker, name: h.name, amount: Math.round(h.todayContribution as number) })),
            negative: topNegative.map(h => ({ ticker: h.ticker, name: h.name, amount: Math.round(h.todayContribution as number) })),
          },
          contributionNarrative: '', // 2026-09-01 3차: 카드 제거로 AI 서술 중단(수치 topContributors는 유지)
          coMovementText,
          coMovementNarrative: '',   // 2026-09-01 3차: 카드 제거(coMovementText 계산값은 유지)
          holdingPeriod: {
            longest:    holdingPeriodFacts.longest,
            mostRecent: holdingPeriodFacts.mostRecent,
            narrative:  summary.holdingPeriodNarrative || '',
          },
          dividend: dividendSummary,
        };

        // DB 저장 — 2026-08-11: 클라이언트 연결 상태와 완전히 분리하기 위해 next/server의
        // after()로 감쌌다 — 종목분석(app/api/stock/[ticker]/analysis/route.ts)이 이미 같은
        // 이유로 쓰고 있는 검증된 패턴과 일관성을 맞춘 것. done 전송은 저장 완료를 기다리지
        // 않지만, 클라이언트는 원래도 저장 성공 여부와 무관하게 done만 보고 화면을
        // 마무리하므로 사용자 경험 변화는 없다.
        //
        // 2026-09-03 "저장" 기능 선행 변경(app/api/diagnosis/route.ts와 동일 이유) — id를
        // DB 기본값에 맡기지 않고 미리 생성해 insert와 done 프레임에 함께 실어 보낸다.
        // after() 안에서 만든 id는 스트림이 이미 닫힌 뒤라 클라이언트에 전달할 방법이 없다.
        const reportId = crypto.randomUUID();
        after(async () => {
          try {
            const { error: insertError } = await supabase.from('portfolio_diagnosis').insert({
              id:          reportId,
              user_id:     user.id,
              report_date: todayStr,
              result:      finalResult,
            });
            if (insertError) console.error('[PORTFOLIO-DIAGNOSIS] DB 저장 실패:', insertError);
            else console.log(`[PORTFOLIO-DIAGNOSIS] DB 저장 완료${usedCredit ? ' (1회권 사용)' : ''}`);
          } catch (dbErr) {
            console.error('[PORTFOLIO-DIAGNOSIS] DB 저장 실패:', dbErr);
          }
        });

        console.log(`[PORTFOLIO-DIAGNOSIS] 완료${usedCredit ? ' (1회권 사용)' : ''}`);
        // 2026-07-27 스트리밍 전환 — 프론트는 위에서 이미 meta/holding-meta/holding-field/
        // portfolio-field 이벤트로 finalResult와 동등한 내용을 다 받았으므로, 여기서는
        // 전체를 다시 보내지 않고 종료만 통지한다(종목분석 done 이벤트와 동일 설계).
        send(controller, { type: 'done', id: reportId });
      } catch (e) {
        console.error('[PORTFOLIO-DIAGNOSIS] 치명적 오류:', e);
        send(controller, { type: 'error', message: 'AI 분석 생성 실패' });
      } finally {
        try { controller.close(); } catch { /* 이미 취소된 스트림이면 무시 */ }
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
