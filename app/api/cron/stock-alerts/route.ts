import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchStockPrice, getAccessToken } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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

  const todayStr  = getKstTodayStr();
  const notifDate = `${todayStr.slice(0, 4)}-${todayStr.slice(4, 6)}-${todayStr.slice(6, 8)}`;
  const todayStart = kstMidnightIso(todayStr);

  // 1. Pro 구독자 목록
  const { data: proUsers, error: usersError } = await supabase
    .from('users')
    .select('id')
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
  console.log(`[STOCK-ALERTS] Pro 구독자: ${userIds.length}명 — ${userIds.join(', ')}`);

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

    // 주가 변동 — 임계값 오름차순 순회, Map에 덮어쓰므로 가장 높은 임계값이 최종 저장됨
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
      setAlert('foreign_buy', FLOW_THRESHOLD_AUK, `[${stockName}] 외국인 ${formatAmount(foreignNetBuyAuk)} 순매수`, foreignNetBuyAuk);
    } else if (foreignNetBuyAuk <= -FLOW_THRESHOLD_AUK) {
      setAlert('foreign_sell', FLOW_THRESHOLD_AUK, `[${stockName}] 외국인 ${formatAmount(foreignNetBuyAuk)} 순매도`, foreignNetBuyAuk);
    }

    // 기관 수급
    if (institutionNetBuyAuk >= FLOW_THRESHOLD_AUK) {
      setAlert('institution_buy', FLOW_THRESHOLD_AUK, `[${stockName}] 기관 ${formatAmount(institutionNetBuyAuk)} 순매수`, institutionNetBuyAuk);
    } else if (institutionNetBuyAuk <= -FLOW_THRESHOLD_AUK) {
      setAlert('institution_sell', FLOW_THRESHOLD_AUK, `[${stockName}] 기관 ${formatAmount(institutionNetBuyAuk)} 순매도`, institutionNetBuyAuk);
    }
  }

  // 5. 조건 미충족 알림 정리 → Upsert (읽은 알림도 같은 조건 재충족 시 갱신)
  //    예전엔 "읽은 알림 보존" 때문에 unique index와 충돌해 배치 전체가 롤백되는 버그가 있었음.
  //    이제는 upsert로 동일 알림(user+stock+type+threshold+날짜)은 갱신, 새 임계값 돌파는 새 row로 처리.
  const alerts = [...alertMap.values()];
  console.log(`[STOCK-ALERTS] 알림 대상: ${alerts.length}건 — ${alerts.map(a => `${a.stock_code}/${a.type}/${a.threshold}`).join(', ')}`);
  let upserted = 0;
  let errors = 0;

  if (alerts.length > 0) {
    const affectedUserIds = [...new Set(alerts.map(a => a.user_id))];
    const affectedStocks  = [...new Set(alerts.map(a => a.stock_code))];
    const stillValidKeys  = new Set(alerts.map(a => `${a.user_id}:${a.stock_code}:${a.type}:${a.threshold}`));

    // 5-1. 더 이상 조건을 충족하지 않는 (user, stock, type, threshold) 오늘자 알림 정리
    //      (예: 10분 전엔 -10%였다가 지금은 -7%로 회복 → -10% 티어 알림은 제거, -5%는 유지/갱신)
    const { data: existingRows, error: selErr } = await supabase
      .from('notifications')
      .select('id, user_id, stock_code, type, threshold')
      .in('user_id', affectedUserIds)
      .in('stock_code', affectedStocks)
      .eq('notif_date', notifDate);

    if (selErr) {
      console.error('[STOCK-ALERTS] 기존 알림 조회 실패:', selErr.message);
      errors++;
    } else {
      const staleIds = (existingRows ?? [])
        .filter(row => !stillValidKeys.has(`${row.user_id}:${row.stock_code}:${row.type}:${row.threshold}`))
        .map(row => row.id);

      if (staleIds.length > 0) {
        const { error: delErr } = await supabase.from('notifications').delete().in('id', staleIds);
        if (delErr) {
          console.error('[STOCK-ALERTS] 조건 미충족 알림 삭제 실패:', delErr.message);
          errors++;
        } else {
          console.log(`[STOCK-ALERTS] 조건 미충족 알림 ${staleIds.length}건 정리`);
        }
      }
    }

    // 5-2. Upsert: 같은 알림(동일 threshold)이면 가격·등락률·발생시각만 갱신 (is_read는 건드리지 않음 —
    //      이미 읽은 알림이 같은 조건으로 계속 유지될 때 매 사이클 다시 안읽음으로 리셋되는 것을 방지).
    //      새 임계값을 처음 돌파한 경우는 유니크 인덱스(threshold 포함)상 충돌이 없어 INSERT되며,
    //      is_read를 payload에 넣지 않으므로 컬럼 기본값(false)으로 자연히 안읽음 생성됨.
    const { data: upsertData, error: upsertErr } = await supabase
      .from('notifications')
      .upsert(
        alerts.map(alert => ({
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
      upserted = upsertData?.length ?? alerts.length;
      console.log(`[STOCK-ALERTS] ✓ upsert 완료: ${upserted}건`);
    }
  }

  console.log(`[STOCK-ALERTS] 완료 — upsert: ${upserted}, 오류: ${errors}, 대상: ${alerts.length}건`);
  return NextResponse.json({ ok: true, upserted, errors, total: alerts.length });
}
