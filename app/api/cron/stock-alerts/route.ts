import { NextRequest, NextResponse } from 'next/server';
import { adminClient as supabase } from '@/lib/supabase-admin';
import { fetchStockPrice, fetchDailyChart, getAccessToken, acquireKisRateSlot } from '@/lib/kis-api';
import { getDomesticMarketDayContext } from '@/lib/market-day-context';
import { sendTelegramMessage, isBlockedByUser } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const PRICE_THRESHOLDS = [5, 10, 20, 30];
const FLOW_THRESHOLD_AUK = 1000;

function formatAmount(auk: number): string {
  const abs = Math.abs(auk);
  if (abs >= 10000) {
    const jo  = Math.floor(abs / 10000);
    const rem = abs % 10000;
    return rem > 0 ? `${jo}조 ${rem}억` : `${jo}조`;
  }
  return `${abs}억`;
}

function isMarketOpen(): boolean {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}

function getKstTodayStr(): string {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return (
    `${kst.getFullYear()}` +
    `${String(kst.getMonth() + 1).padStart(2, '0')}` +
    `${String(kst.getDate()).padStart(2, '0')}`
  );
}

function kstMidnightIso(todayStr: string): string {
  const y = todayStr.slice(0, 4);
  const m = todayStr.slice(4, 6);
  const d = todayStr.slice(6, 8);
  return `${y}-${m}-${d}T00:00:00+09:00`;
}

function kisHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=UTF-8',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: 'FHKST01010900',
    custtype: 'P',
  };
}

async function fetchInvestorFlow(
  ticker: string,
  token: string,
): Promise<{ foreignNetBuyAuk: number; institutionNetBuyAuk: number }> {
  for (const mktCode of ['J', 'Q']) {
    try {
      const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-investor`);
      url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
      url.searchParams.set('FID_INPUT_ISCD', ticker);

      await acquireKisRateSlot();
      const res = await fetch(url.toString(), {
        headers: kisHeaders(token),
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (data.rt_cd !== '0') continue;

      const output: Record<string, string>[] = data.output ?? [];
      // KIS API는 장중 당일 집계를 제공하지 않음 — 데이터가 있는 최근 거래일 행 사용
      const latestRow = output.find((d) => d.frgn_ntby_tr_pbmn !== '');
      if (!latestRow) return { foreignNetBuyAuk: 0, institutionNetBuyAuk: 0 };

      // frgn_ntby_tr_pbmn 단위: 백만원 → /100 = 억원
      const foreignNetBuyAuk     = Math.round(Number(latestRow.frgn_ntby_tr_pbmn || 0) / 100);
      const institutionNetBuyAuk = Math.round(Number(latestRow.orgn_ntby_tr_pbmn || 0) / 100);

      console.log(`[STOCK-ALERTS] ${ticker} 수급 (${latestRow.stck_bsop_date}): 외국인=${foreignNetBuyAuk}억, 기관=${institutionNetBuyAuk}억`);
      return { foreignNetBuyAuk, institutionNetBuyAuk };
    } catch {
      continue;
    }
  }
  return { foreignNetBuyAuk: 0, institutionNetBuyAuk: 0 };
}

async function fetchInChunks<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  chunkSize = 3,
  gapMs = 300,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await Promise.allSettled(items.slice(i, i + chunkSize).map(fn));
    if (i + chunkSize < items.length) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/stock-alerts] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/stock-alerts] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isMarketOpen()) {
    return NextResponse.json({ ok: true, skipped: 'market_closed' });
  }

  // isMarketOpen()은 요일+시각만 확인해 평일 공휴일(예: 대체공휴일)을 걸러내지 못한다 —
  // daily-alert-email/market-cache-warm과 동일한 패턴으로 앵커 종목(삼성전자) 차트
  // 1주치를 조회해 getDomesticMarketDayContext()로 실제 거래일 여부를 확인한다. 이
  // 크론은 09:00~15:30 KST에만 도는데, 그 판정 로직 자체가 정확히 이 구간(09:00
  // 이후)에서 신뢰 가능하도록 설계되어 있다(lib/market-day-context.ts 상단 주석 참고).
  // 판정 실패 시엔 안전하게 거래일로 간주해 정상 진행한다(알림 누락보다 과다 발송이
  // 덜 해로움).
  const anchorChart = await fetchDailyChart('005930', '1W').catch(() => []);
  const marketDayContext = getDomesticMarketDayContext(anchorChart);
  if (!marketDayContext.isTradingDay) {
    console.log(
      `[STOCK-ALERTS] 오늘은 휴장일(${marketDayContext.reason})이라 실행 생략 ` +
      `— 마지막 거래일 ${marketDayContext.lastTradingDate}`,
    );
    return NextResponse.json({ ok: true, skipped: true, reason: marketDayContext.reason });
  }

  const todayStr  = getKstTodayStr();
  const notifDate = `${todayStr.slice(0, 4)}-${todayStr.slice(4, 6)}-${todayStr.slice(6, 8)}`;
  const todayStart = kstMidnightIso(todayStr);

  // 1. Pro 구독자 목록 — telegram_chat_id도 같이 가져와 아래 5-3(텔레그램 발송)에서
  //    재조회 없이 바로 쓴다.
  const { data: proUsers, error: usersError } = await supabase
    .from('users')
    .select('id, telegram_chat_id')
    .eq('plan', 'pro');

  if (usersError) {
    console.error('[STOCK-ALERTS] users 쿼리 실패:', usersError.message);
    return NextResponse.json({ ok: false, error: usersError.message });
  }
  if (!proUsers?.length) {
    console.log('[STOCK-ALERTS] Pro 구독자 없음');
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  const userIds = proUsers.map((u: { id: string }) => u.id);
  const telegramChatIdByUser = new Map(
    proUsers
      .filter((u: { telegram_chat_id: string | null }) => u.telegram_chat_id)
      .map((u: { id: string; telegram_chat_id: string | null }) => [u.id, u.telegram_chat_id as string]),
  );
  console.log(`[STOCK-ALERTS] Pro 구독자: ${userIds.length}명 (텔레그램 연동 ${telegramChatIdByUser.size}명) — ${userIds.join(', ')}`);

  // 2. 관심종목 조회 (국내 주식만)
  const { data: watchlistItems, error: watchErr } = await supabase
    .from('watchlist')
    .select('user_id, ticker, name')
    .in('user_id', userIds)
    .or('market.eq.kr,market.is.null');

  if (watchErr) {
    console.error('[STOCK-ALERTS] watchlist 쿼리 실패:', watchErr.message);
    return NextResponse.json({ ok: false, error: watchErr.message });
  }
  if (!watchlistItems?.length) {
    console.log('[STOCK-ALERTS] 관심종목 없음');
    return NextResponse.json({ ok: true, inserted: 0 });
  }
  console.log(`[STOCK-ALERTS] 관심종목: ${watchlistItems.length}건 — ${watchlistItems.map((w: { ticker: string }) => w.ticker).join(', ')}`);

  // 3. 유니크 ticker 주가·수급 데이터 조회
  const uniqueTickers = [...new Set(watchlistItems.map((w: { ticker: string }) => w.ticker))];
  console.log(`[STOCK-ALERTS] 조회 종목: ${uniqueTickers.length}개 — ${uniqueTickers.join(', ')}`);

  const token = await getAccessToken();

  type StockData = {
    name: string;
    price: number;
    changeRate: number;
    foreignNetBuyAuk: number;
    institutionNetBuyAuk: number;
  };
  const stockDataMap = new Map<string, StockData>();

  await fetchInChunks(
    uniqueTickers,
    async (ticker) => {
      const [priceRes, flowRes] = await Promise.allSettled([
        fetchStockPrice(ticker),
        fetchInvestorFlow(ticker, token),
      ]);

      if (priceRes.status !== 'fulfilled') {
        console.warn(`[STOCK-ALERTS] ${ticker} 가격 조회 실패`);
        return;
      }

      const { name, price, changeRate } = priceRes.value;
      const flow =
        flowRes.status === 'fulfilled'
          ? flowRes.value
          : { foreignNetBuyAuk: 0, institutionNetBuyAuk: 0 };

      console.log(`[STOCK-ALERTS] ${ticker}(${name}) 현재가=${price.toLocaleString()}원 등락률=${changeRate}% 외국인=${flow.foreignNetBuyAuk}억 기관=${flow.institutionNetBuyAuk}억`);
      stockDataMap.set(ticker, { name, price, changeRate, ...flow });
    },
    3,
    300,
  );

  console.log(`[STOCK-ALERTS] 주가 조회 완료: ${stockDataMap.size}/${uniqueTickers.length}개`);

  // 4. 조건 충족 알림 수집
  type AlertItem = {
    user_id: string;
    stock_code: string;
    stock_name: string;
    type: string;
    threshold: number;
    message: string;
    current_value: number;
  };

  const alertMap = new Map<string, AlertItem>();

  for (const item of watchlistItems) {
    const { user_id, ticker, name: watchName } = item as { user_id: string; ticker: string; name: string };
    const data = stockDataMap.get(ticker);
    if (!data) continue;

    const { price, changeRate, foreignNetBuyAuk, institutionNetBuyAuk } = data;
    const stockName = data.name || watchName;

    const setAlert = (type: string, threshold: number, message: string, currentValue: number) => {
      // threshold를 키에 포함 → 각 임계값은 별도 알림으로 취급 (5%·10%·20%·30% 각각 독립)
      alertMap.set(`${user_id}:${ticker}:${type}:${threshold}`, {
        user_id, stock_code: ticker, stock_name: stockName,
        type, threshold, message, current_value: currentValue,
      });
    };

    // 주가 변동 — threshold가 setAlert 키에 포함되므로(229번 줄) 5/10/20/30%는 서로
    // 덮어쓰지 않고 전부 독립적으로 저장됨(예: +12%면 5%·10% 알림이 각각 별도로 생성)
    for (const thr of PRICE_THRESHOLDS) {
      if (changeRate >= thr) {
        setAlert('price_up', thr, `[${stockName}] +${thr}% 상승 | 현재가 ${price.toLocaleString()}원`, price);
      }
      if (changeRate <= -thr) {
        setAlert('price_down', thr, `[${stockName}] -${thr}% 하락 | 현재가 ${price.toLocaleString()}원`, price);
      }
    }

    // 외국인 수급
    if (foreignNetBuyAuk >= FLOW_THRESHOLD_AUK) {
      setAlert('foreign_buy', FLOW_THRESHOLD_AUK, `[${stockName}] 외국인 자금 ${formatAmount(foreignNetBuyAuk)} 유입`, foreignNetBuyAuk);
    } else if (foreignNetBuyAuk <= -FLOW_THRESHOLD_AUK) {
      setAlert('foreign_sell', FLOW_THRESHOLD_AUK, `[${stockName}] 외국인 자금 ${formatAmount(foreignNetBuyAuk)} 유출`, foreignNetBuyAuk);
    }

    // 기관 수급
    if (institutionNetBuyAuk >= FLOW_THRESHOLD_AUK) {
      setAlert('institution_buy', FLOW_THRESHOLD_AUK, `[${stockName}] 기관 자금 ${formatAmount(institutionNetBuyAuk)} 유입`, institutionNetBuyAuk);
    } else if (institutionNetBuyAuk <= -FLOW_THRESHOLD_AUK) {
      setAlert('institution_sell', FLOW_THRESHOLD_AUK, `[${stockName}] 기관 자금 ${formatAmount(institutionNetBuyAuk)} 유출`, institutionNetBuyAuk);
    }
  }

  // 5. 조건 미충족 알림 비활성화 → 신규/유지 알림만 Upsert
  //    2026-08-01 재설계: "조건 미충족 시 DELETE"가 재알림 버그의 원인이었음 — row를
  //    지워버리면 나중에 같은 임계값을 재돌파했을 때 유니크 인덱스 충돌이 없어 INSERT로
  //    처리되고, is_read가 payload에 없어 기본값(false)으로 "새 안읽음 알림"이 생겨버림
  //    (예: +10% 알림 → -7%로 회복 → +11%로 재돌파 시 재알림됨, 실측 확인된 버그).
  //    정책: 일 단위 리셋 유지(오늘 안엔 같은 임계값 재알림 안 함, 자정 이후엔 다시 알림) —
  //    DELETE 대신 is_active=false로 "오늘 이 임계값은 이미 알렸음"을 표시만 하고 row는
  //    보존한다. is_active=false row는 그 다음 사이클에 조건을 다시 만족해도 upsert
  //    대상에서 제외해 재활성화하지 않는다(= 재알림 안 함). /api/notifications의 목록
  //    조회는 이미 is_active=true만 걸러서 보여주므로(변경 없음), 화면에서 "꺼진" 알림이
  //    다시 보이는 일도 없다 — 예전 DELETE가 자동으로 숨겨주던 것과 동일한 결과.
  const alerts = [...alertMap.values()];
  console.log(`[STOCK-ALERTS] 알림 대상: ${alerts.length}건 — ${alerts.map(a => `${a.stock_code}/${a.type}/${a.threshold}`).join(', ')}`);
  let upserted = 0;
  let errors = 0;
  let telegramSent = 0;
  let telegramFailed = 0;

  if (alerts.length > 0) {
    const affectedUserIds = [...new Set(alerts.map(a => a.user_id))];
    const affectedStocks  = [...new Set(alerts.map(a => a.stock_code))];
    const stillValidKeys  = new Set(alerts.map(a => `${a.user_id}:${a.stock_code}:${a.type}:${a.threshold}`));

    // 오늘자 기존 row를 (is_active 여부까지) 조회 — 5-1(비활성화 대상 판별)과
    // 5-2(신규/재활성화 여부 판별)가 같은 조회 결과를 공유한다.
    const { data: existingRows, error: selErr } = await supabase
      .from('notifications')
      .select('id, user_id, stock_code, type, threshold, is_active')
      .in('user_id', affectedUserIds)
      .in('stock_code', affectedStocks)
      .eq('notif_date', notifDate);

    if (selErr) {
      console.error('[STOCK-ALERTS] 기존 알림 조회 실패:', selErr.message);
      errors++;
    } else {
      const rows = existingRows ?? [];
      const existingByKey = new Map(
        rows.map(row => [`${row.user_id}:${row.stock_code}:${row.type}:${row.threshold}`, row]),
      );

      // 5-1. 더 이상 조건을 충족하지 않는 (user, stock, type, threshold)의 "오늘 활성" 알림을
      //      비활성화(is_active=false) — 이미 비활성인 row는 건드릴 필요 없음.
      //      (예: 10분 전엔 -10%였다가 지금은 -7%로 회복 → -10% 티어는 비활성화, -5%는 유지/갱신)
      const staleIds = rows
        .filter(row => row.is_active && !stillValidKeys.has(`${row.user_id}:${row.stock_code}:${row.type}:${row.threshold}`))
        .map(row => row.id);

      if (staleIds.length > 0) {
        const { error: deactErr } = await supabase.from('notifications').update({ is_active: false }).in('id', staleIds);
        if (deactErr) {
          console.error('[STOCK-ALERTS] 조건 미충족 알림 비활성화 실패:', deactErr.message);
          errors++;
        } else {
          console.log(`[STOCK-ALERTS] 조건 미충족 알림 ${staleIds.length}건 비활성화`);
        }
      }

      // 5-2. Upsert 대상 필터링 — 오늘 해당 키로 이미 비활성화된 row가 있으면(= 오늘 한 번
      //      알렸다가 조건 미충족으로 꺼진 뒤 재돌파한 경우) upsert에서 제외해 재알림/재활성화를
      //      막는다. 대상: (a) 오늘 처음 돌파(기존 row 없음) → INSERT, (b) 오늘 계속 활성 상태로
      //      유지 중(is_active=true) → 가격·시각만 갱신(is_read는 건드리지 않음 — 이미 읽은
      //      알림이 조건 유지 중 매 사이클 다시 안읽음으로 리셋되는 것 방지).
      const toUpsert = alerts.filter(alert => {
        const existing = existingByKey.get(`${alert.user_id}:${alert.stock_code}:${alert.type}:${alert.threshold}`);
        return !existing || existing.is_active;
      });
      const skipped = alerts.length - toUpsert.length;
      if (skipped > 0) {
        console.log(`[STOCK-ALERTS] 오늘 이미 알린 뒤 비활성화된 임계값 재돌파 ${skipped}건 — 재알림 생략(일 단위 리셋 정책)`);
      }

      if (toUpsert.length > 0) {
        const { data: upsertData, error: upsertErr } = await supabase
          .from('notifications')
          .upsert(
            toUpsert.map(alert => ({
              user_id:       alert.user_id,
              stock_code:    alert.stock_code,
              stock_name:    alert.stock_name,
              type:          alert.type,
              message:       alert.message,
              threshold:     alert.threshold,
              current_value: alert.current_value,
              is_active:     true,
              notif_date:    notifDate,
              created_at:    new Date().toISOString(),
            })),
            { onConflict: 'user_id,stock_code,type,threshold,notif_date', ignoreDuplicates: false },
          )
          .select('id');

        if (upsertErr) {
          console.error('[STOCK-ALERTS] upsert 실패:', upsertErr.message);
          errors++;
        } else {
          upserted = upsertData?.length ?? toUpsert.length;
          console.log(`[STOCK-ALERTS] ✓ upsert 완료: ${upserted}건`);
        }
      }

      // 5-3. 텔레그램 발송 — toUpsert(오늘 새로 발생/유지 중인 알림)만 대상으로, 그 중
      //      텔레그램이 연동된 유저에게만 같은 메시지를 병행 발송한다. notifications
      //      upsert 성패와 무관하게 독립 시도(기존 저장/이메일 경로는 그대로 두고 "그
      //      옆에" 발송경로만 추가). 유저 단위로 격리해 한 명 실패가 나머지를 막지 않는다.
      const telegramTargets = toUpsert.filter(alert => telegramChatIdByUser.has(alert.user_id));
      if (telegramTargets.length > 0) {
        const results = await Promise.allSettled(
          telegramTargets.map(async (alert) => {
            const chatId = telegramChatIdByUser.get(alert.user_id)!;
            const result = await sendTelegramMessage(chatId, alert.message);
            if (!result.ok) {
              if (isBlockedByUser(result)) {
                // 유저가 봇을 차단/삭제한 경우 — 매 사이클 조용히 실패만 쌓이지 않도록
                // 연동을 자동 해제한다(마이페이지에서 다시 연동하면 복구됨).
                console.warn(`[STOCK-ALERTS] 텔레그램 전송 거부(차단 추정) — 연동 해제: user=${alert.user_id}`);
                await supabase.from('users').update({ telegram_chat_id: null, telegram_linked_at: null }).eq('id', alert.user_id);
              } else {
                console.warn(`[STOCK-ALERTS] 텔레그램 전송 실패: user=${alert.user_id} ${result.description}`);
              }
              throw new Error(result.description ?? 'telegram send failed');
            }
          }),
        );
        telegramSent = results.filter(r => r.status === 'fulfilled').length;
        telegramFailed = results.length - telegramSent;
        console.log(`[STOCK-ALERTS] 텔레그램 발송 — 성공 ${telegramSent}건, 실패 ${telegramFailed}건 (대상 ${telegramTargets.length}건)`);
      }
    }
  }

  console.log(`[STOCK-ALERTS] 완료 — upsert: ${upserted}, 오류: ${errors}, 텔레그램: ${telegramSent}/${telegramSent + telegramFailed}, 대상: ${alerts.length}건`);
  return NextResponse.json({ ok: true, upserted, errors, telegramSent, telegramFailed, total: alerts.length });
}
