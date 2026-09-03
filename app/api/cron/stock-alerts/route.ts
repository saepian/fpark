import { NextRequest, NextResponse } from 'next/server';
import { adminClient as supabase } from '@/lib/supabase-admin';
import { fetchStockPrice, fetchDailyChart } from '@/lib/kis-api';
import { fetchInvestorTrend, computeFlowMultiple } from '@/lib/stock-analysis-data';
import { getDomesticMarketDayContext } from '@/lib/market-day-context';
import { sendTelegramMessage, isBlockedByUser } from '@/lib/telegram';
import { computeShardCount, hashUserIdToShard, getCurrentShardIndex } from '@/lib/cron-sharding';

export const dynamic = 'force-dynamic';
// 2026-08-31 트래픽 점검: 유니크 관심종목 수에 비례해 KIS 호출(종목당 시세 1 + 수급 1~2)이
// 늘어나는데 전역 레이트리미터가 초당 15건이라, 60초 예산으로는 유니크 종목 약 100개
// (Pro 유저 수십 명 수준)부터 크론이 중간에 잘려 뒷부분 종목의 알림이 통째로 누락된다.
// daily-alert-email/morning-briefing과 동일하게 300초로 상향(vercel.json도 함께) —
// 10분 주기 실행이라 겹칠 일은 없다. 근본적인 확장(유저 샤딩 등)은 별도 설계.
export const maxDuration = 300;

const PRICE_THRESHOLDS = [5, 10, 20, 30];

// 2026-09-03 재설계 — 기관/외국인 수급 알림이 절대금액(1,000억원) 기준이라 삼성전자·
// SK하이닉스에만 항상 걸리고 다른 종목(대형주 포함)은 사실상 못 걸리는 구조적 편향이
// 있었다(실측: 워치리스트 15종목 중 두 종목만 임계값의 300~1000%, 나머지는 대형주
// 포함 전부 18% 미만). lib/daily-pick.ts가 2026-07-13에 이미 겪고 고친 것과 동일한
// 문제라(그때는 "종목 선정이 매일 삼성전자로 고정" 형태로 나타남) 같은 해법 — "오늘
// 순매수가 그 종목의 최근 20거래일 평균 흐름 대비 몇 배인가"로 전환한다. 절대금액
// 하한(FLOW_MIN_ABS_TODAY_AUK)은 daily-pick과 동일한 값으로 시작 — 순수 배수만 보면
// "평소 0.1억→오늘 0.5억=5배"처럼 무의미한 금액도 걸릴 수 있어 이를 막는다.
const FLOW_MIN_ABS_TODAY_AUK = 20;        // 오늘 순매수 절대금액이 이 정도는 돼야 "이례적"으로 취급
const FLOW_UNUSUAL_MULTIPLE_THRESHOLD = 2.5; // 오늘 순매수가 평소 흐름의 이 배수 이상이면 알림

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
  const anchorChart = await fetchDailyChart('005930', '1W', { priority: 'cron' }).catch(() => []);
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

  // 1-1. 유저 샤딩 — 위 주석 참고. shardCount=1(현재 규모)이면 전원이 그대로 유일한
  // 샤드에 속해 필터링 효과가 없다(회귀 없음).
  const shardCount = computeShardCount(proUsers.length);
  const shardIndex = getCurrentShardIndex(shardCount);
  const shardedProUsers = shardCount > 1
    ? proUsers.filter((u: { id: string }) => hashUserIdToShard(u.id, shardCount) === shardIndex)
    : proUsers;
  if (shardCount > 1) {
    console.log(`[STOCK-ALERTS] 샤딩 적용: Pro ${proUsers.length}명 → ${shardCount}개 그룹, 이번 실행은 그룹 ${shardIndex}(유저 ${shardedProUsers.length}명) 처리`);
  }

  const userIds = shardedProUsers.map((u: { id: string }) => u.id);
  const telegramChatIdByUser = new Map(
    shardedProUsers
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

  type StockData = {
    name: string;
    price: number;
    changeRate: number;
    foreignNetBuyAuk: number;
    institutionNetBuyAuk: number;
    // 오늘 순매수가 최근 20거래일 평균 흐름의 몇 배인지 — null이면 배수를 신뢰할 수
    // 없는 상태(데이터 부족/평소 흐름 자체가 미미함, computeFlowMultiple 참고)라
    // 알림 트리거에서 제외한다.
    foreignMultiple: number | null;
    institutionMultiple: number | null;
  };
  const stockDataMap = new Map<string, StockData>();

  await fetchInChunks(
    uniqueTickers,
    async (ticker) => {
      // days=21 — trend[0]이 오늘(latest와 동일 거래일), trend[1..]이 20일 평균
      // 베이스라인용(lib/daily-pick.ts의 scanFlowCandidates와 동일 패턴).
      const [priceRes, flowRes] = await Promise.allSettled([
        fetchStockPrice(ticker, { priority: 'cron' }),
        fetchInvestorTrend(ticker, 21, { priority: 'cron' }),
      ]);

      if (priceRes.status !== 'fulfilled') {
        console.warn(`[STOCK-ALERTS] ${ticker} 가격 조회 실패`);
        return;
      }

      const { name, price, changeRate } = priceRes.value;

      let foreignNetBuyAuk = 0;
      let institutionNetBuyAuk = 0;
      let foreignMultiple: number | null = null;
      let institutionMultiple: number | null = null;

      if (flowRes.status === 'fulfilled' && !flowRes.value.apiError && flowRes.value.latest) {
        const { latest, trend } = flowRes.value;
        foreignNetBuyAuk     = latest.foreign.amount;
        institutionNetBuyAuk = latest.institution.amount;
        const priorForeign     = trend.slice(1).map((d) => d.foreign);
        const priorInstitution = trend.slice(1).map((d) => d.institution);
        foreignMultiple     = computeFlowMultiple(foreignNetBuyAuk, priorForeign).multiple;
        institutionMultiple = computeFlowMultiple(institutionNetBuyAuk, priorInstitution).multiple;
      }

      console.log(
        `[STOCK-ALERTS] ${ticker}(${name}) 현재가=${price.toLocaleString()}원 등락률=${changeRate}% ` +
        `외국인=${foreignNetBuyAuk}억(${foreignMultiple ?? 'N/A'}배) 기관=${institutionNetBuyAuk}억(${institutionMultiple ?? 'N/A'}배)`,
      );
      stockDataMap.set(ticker, { name, price, changeRate, foreignNetBuyAuk, institutionNetBuyAuk, foreignMultiple, institutionMultiple });
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

    const { price, changeRate, foreignNetBuyAuk, institutionNetBuyAuk, foreignMultiple, institutionMultiple } = data;
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

    // 외국인 수급 — 절대금액이 아니라 "오늘이 그 종목 평소(최근 20거래일 평균) 흐름의
    // 몇 배인가"로 이례적 여부를 판단(2026-09-03 재설계, 파일 상단 주석 참고). multiple은
    // computeFlowMultiple이 평소 흐름(항상 양수)으로 나눈 값이라 오늘 순매수의 부호를
    // 그대로 물려받는다 — 양수면 매수 쪽, 음수면 매도 쪽 이례치.
    if (foreignMultiple !== null && Math.abs(foreignNetBuyAuk) >= FLOW_MIN_ABS_TODAY_AUK) {
      if (foreignMultiple >= FLOW_UNUSUAL_MULTIPLE_THRESHOLD) {
        setAlert('foreign_buy', FLOW_UNUSUAL_MULTIPLE_THRESHOLD, `[${stockName}] 외국인 자금 ${formatAmount(foreignNetBuyAuk)} 유입 (평소 대비 ${foreignMultiple.toFixed(1)}배)`, foreignNetBuyAuk);
      } else if (foreignMultiple <= -FLOW_UNUSUAL_MULTIPLE_THRESHOLD) {
        setAlert('foreign_sell', FLOW_UNUSUAL_MULTIPLE_THRESHOLD, `[${stockName}] 외국인 자금 ${formatAmount(foreignNetBuyAuk)} 유출 (평소 대비 ${Math.abs(foreignMultiple).toFixed(1)}배)`, foreignNetBuyAuk);
      }
    }

    // 기관 수급 — 위와 동일한 배수 기준.
    if (institutionMultiple !== null && Math.abs(institutionNetBuyAuk) >= FLOW_MIN_ABS_TODAY_AUK) {
      if (institutionMultiple >= FLOW_UNUSUAL_MULTIPLE_THRESHOLD) {
        setAlert('institution_buy', FLOW_UNUSUAL_MULTIPLE_THRESHOLD, `[${stockName}] 기관 자금 ${formatAmount(institutionNetBuyAuk)} 유입 (평소 대비 ${institutionMultiple.toFixed(1)}배)`, institutionNetBuyAuk);
      } else if (institutionMultiple <= -FLOW_UNUSUAL_MULTIPLE_THRESHOLD) {
        setAlert('institution_sell', FLOW_UNUSUAL_MULTIPLE_THRESHOLD, `[${stockName}] 기관 자금 ${formatAmount(institutionNetBuyAuk)} 유출 (평소 대비 ${Math.abs(institutionMultiple).toFixed(1)}배)`, institutionNetBuyAuk);
      }
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

    // 5-1. 더 이상 조건을 충족하지 않는 (user, stock, type, threshold)의 "오늘 활성" 알림을
    //      비활성화(is_active=false) — 이 판단은 아래 5-2의 버그와 무관해 구조를 그대로
    //      유지한다(예: 10분 전엔 -10%였다가 지금은 -7%로 회복 → -10% 티어는 비활성화,
    //      -5%는 유지/갱신).
    const { data: activeRows, error: selErr } = await supabase
      .from('notifications')
      .select('id, user_id, stock_code, type, threshold')
      .in('user_id', affectedUserIds)
      .in('stock_code', affectedStocks)
      .eq('notif_date', notifDate)
      .eq('is_active', true);

    if (selErr) {
      console.error('[STOCK-ALERTS] 활성 알림 조회 실패:', selErr.message);
      errors++;
    } else {
      const staleIds = (activeRows ?? [])
        .filter(row => !stillValidKeys.has(`${row.user_id}:${row.stock_code}:${row.type}:${row.threshold}`))
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
    }

    // 5-2. 원자적 upsert — "오늘 새로 발생했는가"를 SELECT로 기존 행을 조회해 메모리
    //      Map(existingByKey)과 대조한 뒤 판단하던 2단계 구조(신규 트리거만 걸러
    //      newlyTriggered)를 걷어냈다. 2026-08-31 실측에서 이 구조가 실제로 신규였던
    //      알림 3건(앱클론/대우건설/다날 price_down 5%)을 "이미 존재"로 오분류해 텔레그램
    //      발송이 통째로 스킵되는 문제가 있었음(사이트 알림 자체는 정상 upsert됨 — 정확한
    //      결함 라인은 특정 못했지만 "판단 시점(SELECT)"과 "쓰기 시점(UPSERT)"이 분리된
    //      구조 자체가 근본 원인으로 보임). upsert_stock_alert RPC(SQL migration
    //      20260831_notifications_atomic_upsert.sql)가 INSERT ... ON CONFLICT ... DO
    //      UPDATE ... RETURNING (xmax = 0)로 "이번 호출이 실제 INSERT였는지"를 하나의
    //      원자적 SQL 문 안에서 바로 알려주므로, 판단과 쓰기가 어긋날 여지 자체가 없다.
    //      "오늘 이미 알린 뒤 비활성화된 임계값 재돌파는 재알림 생략"(일 단위 리셋 정책,
    //      2026-08-01 재설계)도 RPC 안의 EXISTS 체크로 원자적으로 처리 — 호출부(여기)엔
    //      더 이상 별도 SELECT/Map이 없다.
    const upsertResults: { alert: AlertItem; id: string; isNew: boolean; skipped: boolean; telegramSentAt: string | null }[] = [];
    const upsertFailures: { alert: AlertItem; message: string }[] = [];

    for (let i = 0; i < alerts.length; i += 3) {
      const chunk = alerts.slice(i, i + 3);
      const settled = await Promise.allSettled(
        chunk.map(async (alert) => {
          const { data, error } = await supabase.rpc('upsert_stock_alert', {
            p_user_id:       alert.user_id,
            p_stock_code:    alert.stock_code,
            p_stock_name:    alert.stock_name,
            p_type:          alert.type,
            p_message:       alert.message,
            p_threshold:     alert.threshold,
            p_current_value: alert.current_value,
            p_notif_date:    notifDate,
          });
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : data;
          if (!row) throw new Error('upsert_stock_alert가 빈 결과를 반환함');
          return row;
        }),
      );
      settled.forEach((r, idx) => {
        const alert = chunk[idx];
        if (r.status === 'fulfilled') {
          upsertResults.push({
            alert, id: r.value.id, isNew: r.value.is_new, skipped: r.value.skipped,
            telegramSentAt: r.value.telegram_sent_at,
          });
        } else {
          upsertFailures.push({ alert, message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
        }
      });
      if (i + 3 < alerts.length) await new Promise(res => setTimeout(res, 300));
    }

    for (const f of upsertFailures) {
      console.error(`[STOCK-ALERTS] upsert 실패: ${f.alert.stock_code}/${f.alert.type}/${f.alert.threshold} — ${f.message}`);
    }
    errors += upsertFailures.length;

    const skippedCount = upsertResults.filter(r => r.skipped).length;
    if (skippedCount > 0) {
      console.log(`[STOCK-ALERTS] 오늘 이미 알린 뒤 비활성화된 임계값 재돌파 ${skippedCount}건 — 재알림 생략(일 단위 리셋 정책)`);
    }

    upserted = upsertResults.filter(r => !r.skipped).length;
    console.log(`[STOCK-ALERTS] ✓ upsert 완료: ${upserted}건`);

    // 5-3. 텔레그램 발송 — 2026-08-31 오후 긴급 수정: 대상 판단을 is_new(=진짜 신규
    //      삽입이었는가)가 아니라 telegramSentAt(=텔레그램이 실제로 성공한 적이 있는가)
    //      기준으로 바꿨다. is_new만 보면 "최초 삽입 시점에 텔레그램이 실패하거나 아예
    //      시도 못 한" 행이 그 뒤로 영원히 재시도되지 않는 문제가 있었다(실측: 오전
    //      09:50 생성된 6건이 이후 여러 사이클 동안 계속 조건을 유지했는데도 텔레그램만
    //      한 번도 안 감 — is_new가 최초 사이클 이후 계속 false였기 때문). skipped(오늘
    //      이미 알렸다가 조건 미충족으로 꺼진 뒤 재돌파한 것 — 일부러 재알림 안 함)는
    //      여전히 제외한다.
    const telegramEligible = upsertResults.filter(r => !r.skipped && !r.telegramSentAt);
    const telegramTargets = telegramEligible.filter(r => telegramChatIdByUser.has(r.alert.user_id));
    if (telegramTargets.length > 0) {
      const results = await Promise.allSettled(
        telegramTargets.map(async (target) => {
          const { alert, id } = target;
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
          // telegram_sent_at을 성공 직후 바로 기록 — 이걸 안 하면 다음 사이클에도
          // telegramSentAt이 계속 null이라 조건이 유지되는 한 매번 중복 발송된다.
          const { error: markErr } = await supabase
            .from('notifications')
            .update({ telegram_sent_at: new Date().toISOString() })
            .eq('id', id);
          if (markErr) {
            console.error(`[STOCK-ALERTS] telegram_sent_at 기록 실패(발송은 성공) — id=${id}:`, markErr.message);
          }
        }),
      );
      telegramSent = results.filter(r => r.status === 'fulfilled').length;
      telegramFailed = results.length - telegramSent;
      console.log(`[STOCK-ALERTS] 텔레그램 발송 — 성공 ${telegramSent}건, 실패 ${telegramFailed}건 (대상 ${telegramTargets.length}건)`);
    }
  }

  console.log(`[STOCK-ALERTS] 완료 — upsert: ${upserted}, 오류: ${errors}, 텔레그램: ${telegramSent}/${telegramSent + telegramFailed}, 대상: ${alerts.length}건`);
  return NextResponse.json({ ok: true, upserted, errors, telegramSent, telegramFailed, total: alerts.length });
}
