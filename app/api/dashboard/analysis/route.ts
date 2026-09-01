import { NextResponse, after } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { collectStockAnalysisData, computeTradingValueMultiple, buildTradingValueBlock, computeRiskMetrics } from '@/lib/stock-analysis-data';
import { fetchDailyChart } from '@/lib/kis-api';
import { selectRelevantNews, type NewsCandidate } from '@/lib/news-selection';
import { selectSectorMacroNews } from '@/lib/sector-news';
import { kstDateStr, daysBetween } from '@/lib/ai-grounding';
import { getDomesticMarketDayContext } from '@/lib/market-day-context';
import { isKoreanMarketOpen } from '@/lib/market-utils';
import type { Database, Json } from '@/lib/database.types';
import {
  type HoldingInput, type EnrichedHolding, type StockAiResult, type PrevPortfolioRow,
  type SectorBreakdownItem, type SectorConcentrationResult, type RiskContributionItem, type PortfolioCorrelationResult,
  EMPTY_SUMMARY_SECTIONS,
  buildPortfolioMarketDayBlock, buildPortfolioHistoryBlock, buildCoMovementText, buildHoldingPeriodFactsLine,
  analyzeOneStock, analyzePortfolioSummary,
  PORTFOLIO_FIRST_TONE, PORTFOLIO_ONE_DAY_TONE, PORTFOLIO_FEW_DAYS_TONE, PORTFOLIO_LONG_GAP_TONE,
  computeSectorBreakdown, computeSectorConcentration, computeRiskContribution,
  computePortfolioCorrelation, buildCorrelationFactsLine,
  MIN_HOLDINGS_FOR_QUANT_METRICS,
} from '@/lib/portfolio-analysis-pipeline';

export const dynamic     = 'force-dynamic';
export const maxDuration = 120; // portfolio-diagnosis와 동일한 Stage1/Stage2 파이프라인이라 같은 여유 필요

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

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timer = new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms));
  return Promise.race([promise, timer]);
}

function sseEncode(ctrl: ReadableStreamDefaultController, encoder: TextEncoder, data: object) {
  try {
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  } catch { /* 클라이언트가 이미 끊었으면 무시 — portfolio-diagnosis와 동일 정책 */ }
}

// 대시보드 finalResult 타입 — portfolio_diagnosis의 finalResult보다 얕다(v1 스코프:
// 벤치마크·배당·급등이력·MDD/변동성은 의도적으로 제외 — lib/portfolio-analysis-pipeline.ts
// 상단 주석 및 대시보드 설계 검토 참고).
interface DashboardMergedHolding {
  ticker: string; name: string; currentPrice: number; avgPrice: number; quantity: number;
  value: number; invested: number; profit: number; profitRate: number;
  signal: string; reason: string; sector: string; newsBasis: 'news' | 'estimated';
  news: { title: string; summary?: string; date?: string; url?: string }[];
  todayContribution: number | null;
}

interface DashboardAnalysisResult {
  totalInvested: number; totalValue: number; totalProfit: number; totalProfitRate: number;
  summary: string; summarySections: { background: string; newsInterpretation: string; historicalComparison: string; judgment: string };
  sectors: SectorBreakdownItem[]; holdings: DashboardMergedHolding[];
  sectorConcentration: SectorConcentrationResult | null;
  riskContribution: RiskContributionItem[] | null;
  correlation: PortfolioCorrelationResult | null;
  riskFactors: unknown[]; opportunityFactors: string[];
  shortTermOutlook: string; midTermOutlook: string;
  coMovementText: string | null; coMovementNarrative: string;
  holdingPeriod: { longest: unknown; mostRecent: unknown; narrative: string };
  history: { daysSince: number | null; prevDate?: string; narrative: string };
}

export async function POST() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 장중에는 애초에 프론트 버튼 자체가 안 보이지만(격리된 UX 가드), 서버도 동일하게
  // 막아 직접 API 호출을 방어한다 — 차트 조회 등 비용이 드는 Stage 0 시작 전에 먼저 검사.
  if (isKoreanMarketOpen()) {
    return NextResponse.json({ error: '장중에는 AI 분석을 생성할 수 없습니다. 장 마감 후 다시 시도해주세요.' }, { status: 403 });
  }

  const { data: holdingRows, error: holdingsError } = await supabase
    .from('dashboard_holdings')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (holdingsError) return NextResponse.json({ error: holdingsError.message }, { status: 500 });
  if (!holdingRows || holdingRows.length === 0) {
    return NextResponse.json({ error: '등록된 종목이 없습니다.' }, { status: 400 });
  }

  const holdings: HoldingInput[] = holdingRows.map(r => ({
    ticker:   r.ticker,
    name:     r.name,
    avgPrice: r.avg_price,
    quantity: r.quantity,
    buyDate:  r.buy_date ?? undefined,
  }));

  const todayStr = kstDateStr();

  // ── 당일 캐시 확인 — 오늘 이미 생성됐으면 즉시 그 결과를 SSE로 흘려보내고 끝낸다 ──
  const { data: cachedRow } = await supabase
    .from('dashboard_analysis')
    .select('result, created_at')
    .eq('user_id', user.id)
    .eq('report_date', todayStr)
    .maybeSingle();

  const encoder = new TextEncoder();
  const send    = (ctrl: ReadableStreamDefaultController, data: object) => sseEncode(ctrl, encoder, data);

  if (cachedRow?.result) {
    const cached = cachedRow.result as unknown as DashboardAnalysisResult;
    const stream = new ReadableStream({
      start(controller) {
        send(controller, {
          type: 'meta',
          totalInvested: cached.totalInvested, totalValue: cached.totalValue,
          totalProfit: cached.totalProfit, totalProfitRate: cached.totalProfitRate,
          history: cached.history, holdingPeriod: cached.holdingPeriod,
          // 이 필드들이 없는 옛 캐시(신설 이전 저장분)는 undefined ?? null로 안전 폴백 —
          // 프론트는 null을 "종목 수 부족/계산 불가"와 동일하게 취급해 캡션으로 대체한다.
          riskContribution: cached.riskContribution ?? null,
          correlation: cached.correlation ?? null,
        });
        send(controller, {
          type: 'holding-meta',
          holdings: cached.holdings.map(h => ({
            ticker: h.ticker, name: h.name, currentPrice: h.currentPrice, avgPrice: h.avgPrice,
            quantity: h.quantity, value: h.value, invested: h.invested, profit: h.profit,
            profitRate: h.profitRate, newsBasis: h.newsBasis, news: h.news, todayContribution: h.todayContribution,
          })),
        });
        for (const h of cached.holdings) {
          send(controller, { type: 'holding-field', ticker: h.ticker, key: 'reason', value: h.reason });
          send(controller, { type: 'holding-field', ticker: h.ticker, key: 'sector', value: h.sector });
        }
        send(controller, { type: 'stage1-done', coMovementText: cached.coMovementText });
        send(controller, { type: 'portfolio-field', key: 'summarySections_background', value: cached.summarySections.background });
        send(controller, { type: 'portfolio-field', key: 'summarySections_newsInterpretation', value: cached.summarySections.newsInterpretation });
        send(controller, { type: 'portfolio-field', key: 'summarySections_historicalComparison', value: cached.summarySections.historicalComparison });
        send(controller, { type: 'portfolio-field', key: 'summarySections_judgment', value: cached.summarySections.judgment });
        send(controller, { type: 'portfolio-field', key: 'sectors', value: cached.sectors });
        send(controller, { type: 'portfolio-field', key: 'sectorConcentration', value: cached.sectorConcentration ?? null });
        send(controller, { type: 'portfolio-field', key: 'riskFactors', value: cached.riskFactors });
        send(controller, { type: 'portfolio-field', key: 'opportunityFactors', value: cached.opportunityFactors });
        send(controller, { type: 'portfolio-field', key: 'holdingPeriodNarrative', value: cached.holdingPeriod.narrative });
        send(controller, { type: 'portfolio-field', key: 'coMovementNarrative', value: cached.coMovementNarrative });
        send(controller, { type: 'portfolio-field', key: 'shortTermOutlook', value: cached.shortTermOutlook });
        send(controller, { type: 'portfolio-field', key: 'midTermOutlook', value: cached.midTermOutlook });
        send(controller, { type: 'done', isCached: true, createdAt: cachedRow.created_at });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  }

  // ── 신규 생성 — Stage 0(트림된 데이터 수집) → Stage 1 → Stage 2 ──
  const stream = new ReadableStream({
    async start(controller) {
      try {
        send(controller, { type: 'progress', label: '종목 데이터 수집 중...' });
        console.log(`[DASHBOARD-ANALYSIS] 데이터 수집 시작 (${holdings.length}개 종목)`);

        // v1 스코프: 벤치마크·배당·급등이력은 의도적으로 계속 제외(portfolio-diagnosis
        // 대비 트림된 Stage 0) — collectStockAnalysisData(현재가·PER·수급·뉴스)만 조회한다.
        // 2026-08-28: 정량 지표 B(종목간 상관관계)·C-1(변동성 기여도)가 1년치 일별 종가와
        // computeRiskMetrics(mdd/volatility)를 필요로 해서, 차트 fetch를 '1M'→'1Y'로
        // 늘리고 MDD/변동성 계산을 여기서도 추가했다(portfolio-diagnosis와 동일 호출 —
        // KIS 한 번의 요청 범위만 다를 뿐 왕복 횟수는 그대로라 지연 영향은 미미할 것으로
        // 판단, 실측으로 검증 필요).
        const analysisDataPromises = holdings.map(h =>
          withTimeout(collectStockAnalysisData(h.ticker, h.name), 8000, null)
        );

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
            return map;
          });

        const [analysisResults, chartResults, newsSelectionResults, sectorMacroMap] = await Promise.all([
          Promise.allSettled(analysisDataPromises),
          Promise.allSettled(
            holdings.map(h => withTimeout(fetchDailyChart(h.ticker, '1Y'), 15000, null)),
          ),
          Promise.allSettled(
            holdings.map((h, i) => {
              const extraCandidates: Promise<NewsCandidate[]> = analysisDataPromises[i].then(
                (ad) => (ad?.news ?? []).map(n => ({ title: n.title, summary: n.summary, date: n.date, url: n.url })),
                () => [],
              );
              return withTimeout(
                selectRelevantNews(h.ticker, h.name, extraCandidates),
                12000,
                { items: [], isCached: false, apiError: true },
              );
            }),
          ),
          sectorMacroMapPromise,
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
          const risk      = computeRiskMetrics(chartData.map(p => p.close));

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

          const tradingValueMultiple = chartData.length ? computeTradingValueMultiple(chartData) : null;
          const tradingValueBlock    = tradingValueMultiple?.valid ? buildTradingValueBlock(tradingValueMultiple) : null;

          return {
            ...h, name: resolvedName, currentPrice, invested, value, profit, profitRate,
            analysisData: ad, relevantNews, sectorMacroNews,
            dividendSummary: null, dividendHistory: [],
            mdd:        risk?.mdd        ?? null,
            volatility: risk?.volatility ?? null,
            todayChangeRate, todayContribution, surgeHistoryBlock: null, tradingValueBlock,
          };
        });

        const firstAvailableChart = chartResults
          .map(r => (r.status === 'fulfilled' && r.value) ? r.value : [])
          .find(c => c.length > 0) ?? [];
        const marketDayContext = getDomesticMarketDayContext(firstAvailableChart);
        if (!marketDayContext.isTradingDay) {
          console.log(`[DASHBOARD-ANALYSIS] 거래일 아님(${marketDayContext.reason}) — 분석 생성 거부`);
          send(controller, { type: 'error', message: '오늘은 거래일이 아니라 AI 분석을 생성할 수 없습니다.' });
          controller.close();
          return;
        }

        const totalInvested   = enriched.reduce((s, h) => s + h.invested, 0);
        const totalValue      = enriched.reduce((s, h) => s + h.value, 0);
        const totalProfit     = totalValue - totalInvested;
        const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

        // 정량 지표 B·C-1 — portfolio-diagnosis와 동일 원칙(app/api/portfolio-diagnosis/
        // route.ts 참고), Stage 1 없이 바로 계산 가능해 meta 이벤트로 즉시 흘려보낸다.
        const hasEnoughHoldingsForQuant = enriched.length >= MIN_HOLDINGS_FOR_QUANT_METRICS;
        const riskContribution = hasEnoughHoldingsForQuant
          ? computeRiskContribution(enriched, totalValue)
          : null;
        const correlation = hasEnoughHoldingsForQuant
          ? computePortfolioCorrelation(enriched.map((h, i) => {
              const cr = chartResults[i];
              return { weight: totalValue > 0 ? h.value / totalValue : 0, chart: (cr.status === 'fulfilled' && cr.value) ? cr.value : [] };
            }))
          : null;

        const lossHoldings  = enriched.filter(h => h.profitRate < 0);
        const lossCount     = lossHoldings.length;
        const lossWeightPct = totalValue > 0 ? (lossHoldings.reduce((s, h) => s + h.value, 0) / totalValue) * 100 : 0;

        // ── 직전 대시보드 분석(오늘 이전 가장 최근 1건) 조회 ──
        let prevRow: PrevPortfolioRow | null = null;
        try {
          const { data } = await supabase
            .from('dashboard_analysis')
            .select('report_date, result, created_at')
            .eq('user_id', user.id)
            .lt('report_date', todayStr)
            .order('report_date', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data?.result) {
            const r = data.result as unknown as DashboardAnalysisResult;
            prevRow = {
              report_date: data.report_date,
              created_at:  data.created_at,
              result: { totalProfitRate: r.totalProfitRate, totalProfit: r.totalProfit, holdings: r.holdings.map(h => ({ ticker: h.ticker, name: h.name })) },
            };
          }
        } catch (e) {
          console.warn('[DASHBOARD-ANALYSIS] 직전 분석 조회 실패, 비교 없이 진행:', e instanceof Error ? e.message : e);
        }
        const daysSinceLastReport = (prevRow && prevRow.report_date) ? daysBetween(todayStr, prevRow.report_date) : null;
        const currentHoldingsForHistory = enriched.map(h => ({ ticker: h.ticker, name: h.name }));
        const {
          block: historyComparisonBlock, addedTickers, removedTickers, compositionChanged,
        } = buildPortfolioHistoryBlock(
          prevRow,
          { totalProfitRate, totalProfit, holdings: currentHoldingsForHistory },
          daysSinceLastReport,
        );
        const gapTone =
          daysSinceLastReport === null ? PORTFOLIO_FIRST_TONE :
          daysSinceLastReport === 1 ? PORTFOLIO_ONE_DAY_TONE :
          daysSinceLastReport <= 6 ? PORTFOLIO_FEW_DAYS_TONE :
          PORTFOLIO_LONG_GAP_TONE;

        const topContributorsN = Math.min(5, Math.max(3, Math.ceil(enriched.length / 2)));
        const contributors = enriched.filter(h => h.todayContribution !== null);
        const topPositive = [...contributors].filter(h => (h.todayContribution as number) > 0)
          .sort((a, b) => (b.todayContribution as number) - (a.todayContribution as number)).slice(0, topContributorsN);
        const topNegative = [...contributors].filter(h => (h.todayContribution as number) < 0)
          .sort((a, b) => (a.todayContribution as number) - (b.todayContribution as number)).slice(0, topContributorsN);

        const fmtContrib = (h: EnrichedHolding) => `${h.name} ${(h.todayContribution as number) >= 0 ? '+' : ''}${Math.round(h.todayContribution as number).toLocaleString()}원 (${(h.todayChangeRate as number) >= 0 ? '+' : ''}${(h.todayChangeRate as number).toFixed(2)}%)`;
        const contributionFactsLine = contributors.length > 0
          ? [
              topPositive.length ? `- 상승 기여 상위: ${topPositive.map(fmtContrib).join(', ')}` : null,
              topNegative.length ? `- 하락 기여 상위: ${topNegative.map(fmtContrib).join(', ')}` : null,
            ].filter(Boolean).join('\n') || '뚜렷한 기여 종목 없음'
          : '오늘 등락 데이터 없음';

        const holdingPeriodFacts = buildHoldingPeriodFactsLine(enriched, todayStr);

        send(controller, {
          type: 'meta',
          totalInvested, totalValue, totalProfit,
          totalProfitRate: parseFloat(totalProfitRate.toFixed(2)),
          history: {
            daysSince: daysSinceLastReport,
            prevDate: prevRow?.report_date,
            compositionChanged, addedTickers, removedTickers,
          },
          holdingPeriod: { longest: holdingPeriodFacts.longest, mostRecent: holdingPeriodFacts.mostRecent },
          riskContribution,
          correlation,
        });
        send(controller, {
          type: 'holding-meta',
          holdings: enriched.map(h => ({
            ticker: h.ticker, name: h.name, currentPrice: h.currentPrice, avgPrice: h.avgPrice,
            quantity: h.quantity, value: h.value, invested: h.invested, profit: h.profit,
            profitRate: parseFloat(h.profitRate.toFixed(2)),
            newsBasis: h.relevantNews.length > 0 ? 'news' : 'estimated',
            news: h.relevantNews, todayContribution: h.todayContribution,
          })),
        });

        send(controller, { type: 'progress', label: `${enriched.length}개 종목 개별 분석 중...` });
        const portfolioMarketDayBlock = buildPortfolioMarketDayBlock(marketDayContext);
        const stockResults = await Promise.all(enriched.map(h => analyzeOneStock(
          h, portfolioMarketDayBlock,
          (key, value) => send(controller, { type: 'holding-field-partial', ticker: h.ticker, key, value }),
          (key, value) => send(controller, { type: 'holding-field', ticker: h.ticker, key, value }),
        )));

        const coMovementText = buildCoMovementText(enriched, stockResults);
        const coMovementFactsLine = coMovementText ?? '동조화 사례 없음';
        const correlationFactsLine = buildCorrelationFactsLine(correlation);
        send(controller, { type: 'stage1-done', coMovementText });

        // 정량 지표 A — portfolio-diagnosis와 동일(stockResults 폴백이 있어야 그룹핑
        // 가능해서 Stage 1 완료 직후). sectors는 이제 AI가 만들지 않는다.
        const sectors = computeSectorBreakdown(enriched, stockResults, totalValue);
        const sectorConcentration = hasEnoughHoldingsForQuant ? computeSectorConcentration(sectors) : null;
        send(controller, { type: 'portfolio-field', key: 'sectors', value: sectors });
        send(controller, { type: 'portfolio-field', key: 'sectorConcentration', value: sectorConcentration });

        send(controller, { type: 'progress', label: '포트폴리오 종합 분석 중...' });
        const nameMap: Record<string, string> = {};
        const newsMap: Record<string, { title: string; summary?: string }[]> = {};
        enriched.forEach(h => {
          nameMap[h.ticker] = h.name;
          newsMap[h.ticker] = h.relevantNews;
        });

        const sentValues: Record<string, unknown> = {};
        const emitField = (key: string, value: unknown) => {
          if (JSON.stringify(sentValues[key]) === JSON.stringify(value)) return;
          sentValues[key] = value;
          send(controller, { type: 'portfolio-field', key, value });
        };
        const emitPartial = (key: string, value: string) =>
          send(controller, { type: 'portfolio-field-partial', key, value });

        const seenSectorMacroTitles = new Set<string>();
        const sectorMacroNewsFlat = enriched
          .flatMap(h => h.sectorMacroNews)
          .filter(n => (seenSectorMacroTitles.has(n.title) ? false : (seenSectorMacroTitles.add(n.title), true)));

        const summary = await analyzePortfolioSummary(
          stockResults, nameMap, newsMap, sectorMacroNewsFlat, totalProfitRate, enriched.length, null,
          { lossCount, lossWeightPct, riskiestLines: [] },
          historyComparisonBlock, contributionFactsLine, holdingPeriodFacts.line,
          '데이터 없음', coMovementFactsLine, correlationFactsLine, '', gapTone, portfolioMarketDayBlock, 'dashboard',
          emitPartial, emitField,
        );
        if (summary._failed) {
          send(controller, { type: 'stage2-error' });
        }

        const mergedHoldings: DashboardMergedHolding[] = enriched.map(h => {
          const aiH = stockResults.find((s: StockAiResult) => s.ticker === h.ticker);
          return {
            ticker: h.ticker, name: h.name, currentPrice: h.currentPrice, avgPrice: h.avgPrice,
            quantity: h.quantity, value: h.value, invested: h.invested, profit: h.profit,
            profitRate: parseFloat(h.profitRate.toFixed(2)),
            signal: aiH?.signal ?? '중립·관망', reason: aiH?.reason ?? '', sector: aiH?.sector ?? '',
            newsBasis: aiH?.newsBasis ?? (h.relevantNews.length > 0 ? 'news' : 'estimated'),
            news: h.relevantNews, todayContribution: h.todayContribution,
          };
        });

        const finalResult: DashboardAnalysisResult = {
          totalInvested, totalValue, totalProfit,
          totalProfitRate: parseFloat(totalProfitRate.toFixed(2)),
          summary: summary.summary ?? '',
          summarySections: summary.summarySections ?? EMPTY_SUMMARY_SECTIONS,
          // sectors는 더 이상 AI 추정치가 아니라 실제 평가금액 기준 서버 계산값 —
          // portfolio-diagnosis와 동일 원칙(위 computeSectorBreakdown 호출 참고).
          sectors,
          sectorConcentration,
          riskContribution,
          correlation,
          holdings: mergedHoldings,
          riskFactors: summary.riskFactors ?? [],
          opportunityFactors: summary.opportunityFactors ?? [],
          shortTermOutlook: summary.shortTermOutlook || '',
          midTermOutlook: summary.midTermOutlook || '',
          coMovementText,
          coMovementNarrative: summary.coMovementNarrative || '',
          holdingPeriod: {
            longest: holdingPeriodFacts.longest, mostRecent: holdingPeriodFacts.mostRecent,
            narrative: summary.holdingPeriodNarrative || '',
          },
          history: {
            daysSince: daysSinceLastReport, prevDate: prevRow?.report_date,
            narrative: summary.historyNarrative || (daysSinceLastReport === null ? '이 대시보드의 첫 분석입니다.' : ''),
          },
        };

        after(async () => {
          try {
            const { error: insertError } = await supabase.from('dashboard_analysis').insert({
              user_id: user.id, report_date: todayStr, result: finalResult as unknown as Json,
            });
            if (insertError) console.error('[DASHBOARD-ANALYSIS] DB 저장 실패:', insertError);
            else console.log('[DASHBOARD-ANALYSIS] DB 저장 완료');
          } catch (dbErr) {
            console.error('[DASHBOARD-ANALYSIS] DB 저장 실패:', dbErr);
          }
        });

        console.log('[DASHBOARD-ANALYSIS] 완료');
        send(controller, { type: 'done', isCached: false, createdAt: new Date().toISOString() });
      } catch (e) {
        console.error('[DASHBOARD-ANALYSIS] 치명적 오류:', e);
        send(controller, { type: 'error', message: 'AI 분석 생성 실패' });
      } finally {
        try { controller.close(); } catch { /* 이미 취소된 스트림이면 무시 */ }
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
