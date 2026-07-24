import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { Resend } from 'resend';
import { fetchStockPrice, fetchInvestorFlowRanking, type InvestorFlowRankRow } from '@/lib/kis-api';
import { fetchTopTradingValueTickers } from '@/lib/market-ranking';
import { listAllAuthUserEmails } from '@/lib/list-all-auth-users';
import {
  type StockResult,
  type DailyAiResult,
  SURGE_UP_THRESHOLD_PCT,
  SURGE_DOWN_THRESHOLD_PCT,
  isTargetStock,
  fetchNewsMapForStocks,
  findCommonCauseNews,
  fetchLiveMacroNews,
  generateAiComment,
  buildEmailHtml,
  getKstInfo,
} from '@/lib/daily-email';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function fetchPricesInChunks(tickers: string[]): Promise<Map<string, StockResult>> {
  const result = new Map<string, StockResult>();
  for (let i = 0; i < tickers.length; i += 3) {
    const batch = tickers.slice(i, i + 3);
    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const data = await fetchStockPrice(ticker);
        return {
          ticker, name: data.name, price: data.price, change: data.change,
          changeRate: data.changeRate, sector: data.sector,
        };
      }),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') result.set(r.value.ticker, r.value);
    }
    if (i + 3 < tickers.length) await new Promise((r) => setTimeout(r, 300));
  }
  return result;
}

export async function GET(request: NextRequest) {
  const resend     = new Resend(process.env.RESEND_API_KEY!);
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/daily-alert-email] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/daily-alert-email] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { dateStr, notifDate, mm, dd } = getKstInfo();

  // 1. Pro 구독자 + 이메일 수신 동의자
  const { data: proUsers, error: usersError } = await adminClient
    .from('users')
    .select('id')
    .eq('plan', 'pro')
    .eq('email_alert_enabled', true);

  if (usersError) {
    console.error('[DAILY-EMAIL] users 쿼리 실패:', usersError.message);
    return NextResponse.json({ ok: false, error: usersError.message });
  }
  if (!proUsers?.length) {
    console.log('[DAILY-EMAIL] 발송 대상 없음');
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const userIds = proUsers.map((u: { id: string }) => u.id);
  console.log(`[DAILY-EMAIL] 발송 대상: ${userIds.length}명`);

  // 2. 이메일 주소 일괄 조회 (페이지네이션으로 1000명 초과 대응)
  let emailMap: Map<string, string>;
  try {
    emailMap = await listAllAuthUserEmails('[DAILY-EMAIL]');
  } catch (e) {
    console.error('[DAILY-EMAIL] 유저 이메일 조회 최종 실패 — 발송 중단:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'listUsers failed' });
  }

  // 3. 관심종목 일괄 조회
  const { data: allWatchlist } = await adminClient
    .from('watchlist')
    .select('user_id, ticker, name')
    .in('user_id', userIds)
    .or('market.eq.kr,market.is.null');

  const userWatchMap = new Map<string, { ticker: string; name: string }[]>();
  for (const item of (allWatchlist ?? [])) {
    const curr = userWatchMap.get(item.user_id) ?? [];
    curr.push({ ticker: item.ticker, name: item.name });
    userWatchMap.set(item.user_id, curr);
  }

  const activeUserIds = userIds.filter((id) => (userWatchMap.get(id)?.length ?? 0) > 0);
  if (!activeUserIds.length) {
    console.log('[DAILY-EMAIL] 관심종목 보유 사용자 없음');
    return NextResponse.json({ ok: true, sent: 0 });
  }

  // 4. 유니크 ticker 주가 일괄 조회
  const uniqueTickers = [
    ...new Set(activeUserIds.flatMap((id) => (userWatchMap.get(id) ?? []).map((w) => w.ticker))),
  ];
  console.log(`[DAILY-EMAIL] 주가 조회: ${uniqueTickers.length}개 종목`);
  const priceMap = await fetchPricesInChunks(uniqueTickers);

  // 5. 오늘 알림 일괄 조회
  const { data: todayNotifs } = await adminClient
    .from('notifications')
    .select('user_id, message, type')
    .in('user_id', activeUserIds)
    .eq('notif_date', notifDate);

  const notifMap = new Map<string, { message: string }[]>();
  for (const n of (todayNotifs ?? [])) {
    const curr = notifMap.get(n.user_id) ?? [];
    curr.push({ message: n.message });
    notifMap.set(n.user_id, curr);
  }

  // 6. 사용자별 컨텍스트 수집
  type UserCtx = {
    userId: string;
    email: string;
    userName: string;
    stocks: StockResult[];
    notifications: { message: string }[];
  };

  const userCtxList: UserCtx[] = [];
  for (const userId of activeUserIds) {
    const email = emailMap.get(userId) ?? '';
    if (!email) { console.warn(`[DAILY-EMAIL] 이메일 없음: ${userId}`); continue; }
    const watchItems = userWatchMap.get(userId) ?? [];
    // 2026-07-23: priceMap의 이름(fetchStockPrice → resolveStockName)은 KIS 재조회가
    // 실패하면 종목코드를 그대로 반환하는데(lib/kis-api.ts), 여기서 그 값을 무조건
    // 채택해 watchlist 테이블에 있던 정상 이름을 버리고 있었다 — 실제 발송에서
    // 012860/047040/375500/006800/185750이 코드로 노출된 원인. watchlist 쪽도
    // 드물게 이름이 코드로 잘못 저장된 경우가 있어(예: 064260) 단순히 watchlist를
    // 우선할 수는 없고, "종목코드와 다른(=진짜 이름으로 보이는)" 쪽을 우선한다.
    const isPlaceholderName = (name: string, ticker: string) => !name || name === ticker;
    const stocks: StockResult[] = watchItems
      .map((w) => {
        const p = priceMap.get(w.ticker);
        if (!p) return null;
        const name = !isPlaceholderName(p.name, w.ticker) ? p.name
                   : !isPlaceholderName(w.name, w.ticker) ? w.name
                   : p.name;
        return { ...p, name };
      })
      .filter((s): s is StockResult => !!s);
    if (!stocks.length) continue;
    userCtxList.push({
      userId,
      email,
      userName:      email.split('@')[0],
      stocks,
      notifications: notifMap.get(userId) ?? [],
    });
  }

  if (!userCtxList.length) {
    console.error(`[DAILY-EMAIL] 활성 유저 ${activeUserIds.length}명 있었으나 이메일/주가 매칭 실패로 발송 대상 0명 — 확인 필요`);
    return NextResponse.json({ ok: true, sent: 0, failed: 0, reason: 'no-valid-recipients' });
  }

  // 6-1. 이상 매매 활동 판정 — 코스피·코스닥 거래대금 상위 30위 종목코드 집합을
  // 크론 실행당 1회만 조회(전 유저 공유). "상위 10%"는 KIS 랭킹 API가 시장당 최대
  // 30행만 주고 페이지네이션도 없어(2026-07-24 실측) 계산 불가 — "시장당 상위 30위
  // 이내"로 재정의(설계 합의). 등락률 기준은 상승 +8%/하락 -5% 비대칭(2026-07-24 조정).
  const uniqueWatchlist = [...priceMap.values()];
  const tradingValueTickers = await fetchTopTradingValueTickers(30);
  const isTarget = (s: StockResult) => isTargetStock(s, tradingValueTickers);
  const targetWatchlist = uniqueWatchlist.filter(isTarget);
  console.log(
    `[DAILY-EMAIL] 관심종목 ${uniqueWatchlist.length}개 중 주목 대상(거래대금 상위30 또는 +${SURGE_UP_THRESHOLD_PCT}%↑/${SURGE_DOWN_THRESHOLD_PCT}%↓) ${targetWatchlist.length}개:`,
    targetWatchlist.map((s) => `${s.name}(${s.changeRate.toFixed(2)}%)`),
  );

  // 6-2. 뉴스 배치 조회 — 유저별이 아니라 종목 단위로 한 번만. 2026-07-24: 조건 미달
  // 종목("그 외 관심종목")도 뉴스는 조회하도록 확장 — 전체 유니크 관심종목 대상으로
  // 변경(기존엔 targetWatchlist만 조회했음). 관심종목이 유저당 15개 하드캡이라 뉴스
  // 조회 전종목 확장 비용은 미미(1차 daily-alert-email 뉴스 파이프라인 적용 때 검증된
  // 패턴 재사용, lib/news-selection.ts). 조회 후 뉴스 유무로 그룹을 서버가 나눈다 —
  // AI는 그룹 A(주목 대상+뉴스)/otherStockNotes 대상(조건 미달+뉴스) 코멘트 생성만
  // 담당하고, 어느 그룹인지 판정 자체는 서버가 한다(2026-07-24 설계).
  const { newsMap, apiErrorTickers } = await fetchNewsMapForStocks(uniqueWatchlist);
  const hasNews = (s: StockResult) => (newsMap.get(s.ticker) ?? []).length > 0;
  const groupAWatchlist = targetWatchlist.filter(hasNews);
  const groupBWatchlist = targetWatchlist.filter((s) => !hasNews(s));
  const otherNewsWatchlist = uniqueWatchlist.filter((s) => !isTarget(s) && hasNews(s));
  console.log(
    `[DAILY-EMAIL] 주목 대상 ${targetWatchlist.length}개 중 뉴스 있음(그룹A) ${groupAWatchlist.length}개, ` +
    `뉴스 없음(그룹B) ${groupBWatchlist.length}개 / 그 외 관심종목 중 뉴스 있음 ${otherNewsWatchlist.length}개`,
  );
  if (apiErrorTickers.size > 0) {
    console.warn(
      `[DAILY-EMAIL] 뉴스 확인 자체를 못한(apiError) 종목 ${apiErrorTickers.size}개:`,
      uniqueWatchlist.filter((s) => apiErrorTickers.has(s.ticker)).map((s) => s.name),
    );
  }
  const commonCauseNews = findCommonCauseNews(groupAWatchlist, newsMap);
  if (commonCauseNews.length) {
    console.log(`[DAILY-EMAIL] 공통 원인 뉴스 ${commonCauseNews.length}건:`,
      commonCauseNews.map((n) => `"${n.title}" → ${n.stocks.join(',')}`));
  }

  // 6-3. 시장 전체(코스피/코스닥/금리/환율/지정학 등) 뉴스 — 크론 실행당 1회만 조회, 전 유저
  // 공유. 2026-07-24: DB articles 테이블(09:00 KST 1일1회 갱신, 최대 7시간 묵음) 조회 대신
  // morning-briefing과 동일하게 발송 시점에 라이브 검색으로 교체(원인 조사 결과 반영).
  const marketNews = await fetchLiveMacroNews();
  console.log(`[DAILY-EMAIL] 시장 전체 뉴스 ${marketNews.length}건:`, marketNews.map((n) => n.title));

  // 6-4. 외국인/기관 매매종목가집계(전 종목 대상) — 크론 실행당 1회만 조회, 전 유저 공유.
  // 09:30(외국인)/10:00(기관) 첫 집계 전이나 휴장일에는 빈 배열이 정상 응답이라 개별 실패로
  // 취급하지 않고, 실패한 리스트만 빈 배열로 두고 이메일에서 해당 섹션만 자연스럽게 생략한다.
  const flowRankingSettled = await Promise.allSettled([
    fetchInvestorFlowRanking('foreign', 'inflow'),
    fetchInvestorFlowRanking('foreign', 'outflow'),
    fetchInvestorFlowRanking('institution', 'inflow'),
    fetchInvestorFlowRanking('institution', 'outflow'),
  ]);
  const [foreignInflow, foreignOutflow, institutionInflow, institutionOutflow] = flowRankingSettled.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    console.error('[DAILY-EMAIL] 외국인/기관 매매종목가집계 조회 실패:', r.reason);
    return [] as InvestorFlowRankRow[];
  });
  console.log(
    `[DAILY-EMAIL] 외국인/기관 매매동향 — 외국인 유입 ${foreignInflow.length}/유출 ${foreignOutflow.length}, ` +
    `기관 유입 ${institutionInflow.length}/유출 ${institutionOutflow.length}`,
  );

  // 7. Claude 호출 병렬 실행 (Promise.allSettled) — 유저별로 그룹 A(주목 대상+뉴스)와
  // "그 외 관심종목 중 뉴스 있음" 종목만 AI에 전달. 그룹 B(뉴스 없음)/뉴스 없는 그 외
  // 관심종목은 서버가 buildEmailHtml에서 직접 처리한다.
  const aiResults = await Promise.allSettled(
    userCtxList.map((ctx) => {
      const userGroupA = ctx.stocks.filter((s) => isTarget(s) && hasNews(s));
      const userOtherNews = ctx.stocks.filter((s) => !isTarget(s) && hasNews(s));
      return generateAiComment(ctx.userName, ctx.stocks, userGroupA, userOtherNews, newsMap, commonCauseNews, marketNews);
    }),
  );

  // 8. 이메일 발송 (순차 — Resend 속도 제한 준수)
  let sent = 0;
  let failed = 0;
  const subject = `[Finance Park] ${mm}월 ${dd}일 관심종목 일일 리포트`;

  for (let i = 0; i < userCtxList.length; i++) {
    const ctx       = userCtxList[i];
    const aiSettled = aiResults[i];
    if (aiSettled.status === 'rejected') {
      console.error(`[DAILY-EMAIL] ${ctx.email} generateAiComment 예상 밖 예외:`, aiSettled.reason);
    }
    const userGroupA = ctx.stocks.filter((s) => isTarget(s) && hasNews(s));
    const userGroupB = ctx.stocks.filter((s) => isTarget(s) && !hasNews(s));
    const userGroupC = ctx.stocks.filter((s) => !isTarget(s));
    const aiResult: DailyAiResult = aiSettled.status === 'fulfilled'
      ? aiSettled.value
      : {
          focusedStockAnalysis: userGroupA.map((s) => ({ ticker: s.ticker, comment: '관련 뉴스가 확인되었습니다.' })),
          otherStockNotes: userGroupC.filter(hasNews).map((s) => ({ ticker: s.ticker, comment: '관련 뉴스가 확인되었습니다.' })),
          marketSection: '오늘의 시장 전체 분석을 생성하지 못했습니다.',
          outlookSection: '',
        };
    const html = buildEmailHtml({
      userName:      ctx.userName,
      dateStr,
      stocks:        ctx.stocks,
      aiResult,
      groupBStocks:  userGroupB,
      groupCStocks:  userGroupC,
      apiErrorTickers,
      notifications: ctx.notifications,
      userId:        ctx.userId,
      investorFlow:  { foreignInflow, foreignOutflow, institutionInflow, institutionOutflow },
    });
    // 로그 저장용 — 구조화된 결과를 사람이 읽을 수 있는 텍스트로 합쳐 기존 ai_comment 컬럼에 저장
    const aiComment = [
      ...aiResult.focusedStockAnalysis.map((c) => `${c.ticker}: ${c.comment}`),
      ...aiResult.otherStockNotes.map((c) => `${c.ticker}(그외): ${c.comment}`),
      aiResult.marketSection,
      aiResult.outlookSection,
    ].filter(Boolean).join('\n');

    let status: 'sent' | 'failed' = 'sent';
    try {
      const { error: sendError } = await resend.emails.send({
        from: 'Finance Park <noreply@fpark.com>',
        to: [ctx.email],
        subject,
        html,
      });
      if (sendError) throw new Error(JSON.stringify(sendError));
      sent++;
      console.log(`[DAILY-EMAIL] ✓ 발송: ${ctx.email} (주식 ${ctx.stocks.length}개, 알림 ${ctx.notifications.length}개)`);
    } catch (e) {
      status = 'failed';
      failed++;
      console.error(`[DAILY-EMAIL] 발송 실패 (${ctx.email}):`, e instanceof Error ? e.message : e);
    }

    try {
      await adminClient.from('email_send_logs').insert({
        user_id:            ctx.userId,
        stock_count:        ctx.stocks.length,
        notification_count: ctx.notifications.length,
        ai_comment:         aiComment || null,
        status,
      });
    } catch (e) {
      console.warn('[DAILY-EMAIL] 로그 저장 실패:', e instanceof Error ? e.message : e);
    }
  }

  console.log(`[DAILY-EMAIL] 완료 — 발송: ${sent}, 실패: ${failed}`);
  if (sent === 0 && activeUserIds.length > 0) {
    console.error(`[DAILY-EMAIL] 활성 유저 ${activeUserIds.length}명 있었으나 최종 발송 0건 (실패 ${failed}건) — 확인 필요`);
  }
  return NextResponse.json({ ok: true, sent, failed });
}
