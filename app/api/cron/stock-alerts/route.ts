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
const FLOW_THRESHOLD_AUK = 50;

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
  todayStr: string,
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
      // 오늘 날짜 데이터만 사용 (이전 거래일 데이터로 알림 발송 방지)
      const todayRow = output.find(
        (d) => d.stck_bsop_date === todayStr && d.frgn_ntby_tr_pbmn !== '',
      );
      if (!todayRow) return { foreignNetBuyAuk: 0, institutionNetBuyAuk: 0 };

      // frgn_ntby_tr_pbmn 단위: 백만원 → /100 = 억원
      const foreignNetBuyAuk     = Math.round(Number(todayRow.frgn_ntby_tr_pbmn || 0) / 100);
      const institutionNetBuyAuk = Math.round(Number(todayRow.orgn_ntby_tr_pbmn || 0) / 100);

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
  const { searchParams } = new URL(request.url);
  const secret     = searchParams.get('secret');
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isValid    =
    (cronSecret && secret === cronSecret) ||
    (cronSecret && authHeader === `Bearer ${cronSecret}`);
  if (!isValid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isMarketOpen()) {
    return NextResponse.json({ ok: true, skipped: 'market_closed' });
  }

  const todayStr = getKstTodayStr();
  const toInsert: Record<string, unknown>[] = [];
  let skipped = 0;

  // 1. Pro 구독자 목록
  const { data: proUsers, error: usersError } = await supabase
    .from('users')
    .select('id')
    .eq('subscription_plan', 'pro');

  if (usersError || !proUsers?.length) {
    console.log('[STOCK-ALERTS] Pro 구독자 없음');
    return NextResponse.json({ ok: true, inserted: 0, skipped: 0 });
  }

  const userIds = proUsers.map((u: { id: string }) => u.id);
  console.log(`[STOCK-ALERTS] Pro 구독자: ${userIds.length}명`);

  // 2. 관심종목 조회 (국내 주식만)
  const { data: watchlistItems } = await supabase
    .from('watchlist')
    .select('user_id, ticker, name')
    .in('user_id', userIds)
    .or('market.eq.kr,market.is.null');

  if (!watchlistItems?.length) {
    console.log('[STOCK-ALERTS] 관심종목 없음');
    return NextResponse.json({ ok: true, inserted: 0, skipped: 0 });
  }

  // 3. 오늘 이미 발송된 알림 조회 (중복 방지)
  const { data: todayNotifs } = await supabase
    .from('notifications')
    .select('user_id, stock_code, type, threshold')
    .in('user_id', userIds)
    .gte('created_at', kstMidnightIso(todayStr));

  const sentKeys = new Set<string>(
    (todayNotifs ?? []).map(
      (n: { user_id: string; stock_code: string; type: string; threshold: number }) =>
        `${n.user_id}:${n.stock_code}:${n.type}:${n.threshold}`,
    ),
  );

  // 4. 유니크 ticker 배치 조회
  const uniqueTickers = [...new Set(watchlistItems.map((w: { ticker: string }) => w.ticker))];
  console.log(`[STOCK-ALERTS] 조회 종목: ${uniqueTickers.length}개`);

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
        fetchInvestorFlow(ticker, token, todayStr),
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

      stockDataMap.set(ticker, { name, price, changeRate, ...flow });
    },
    3,
    300,
  );

  // 5. 알림 조건 체크 및 toInsert 구성
  for (const item of watchlistItems) {
    const { user_id, ticker, name: watchName } = item as { user_id: string; ticker: string; name: string };
    const data = stockDataMap.get(ticker);
    if (!data) continue;

    const { price, changeRate, foreignNetBuyAuk, institutionNetBuyAuk } = data;
    const stockName = data.name || watchName;

    const tryInsert = (
      type: string,
      threshold: number,
      message: string,
      currentValue: number,
    ) => {
      const key = `${user_id}:${ticker}:${type}:${threshold}`;
      if (sentKeys.has(key)) { skipped++; return; }
      sentKeys.add(key);
      toInsert.push({
        user_id,
        stock_code: ticker,
        stock_name: stockName,
        type,
        message,
        threshold,
        current_value: currentValue,
      });
    };

    // 주가 변동
    for (const thr of PRICE_THRESHOLDS) {
      if (changeRate >= thr) {
        tryInsert(
          'price_up', thr,
          `[${stockName}] +${thr}% 상승 | 현재가 ${price.toLocaleString()}원`,
          price,
        );
      }
      if (changeRate <= -thr) {
        tryInsert(
          'price_down', thr,
          `[${stockName}] -${thr}% 하락 | 현재가 ${price.toLocaleString()}원`,
          price,
        );
      }
    }

    // 외국인 수급
    if (foreignNetBuyAuk >= FLOW_THRESHOLD_AUK) {
      tryInsert(
        'foreign_buy', FLOW_THRESHOLD_AUK,
        `[${stockName}] 외국인 ${Math.abs(foreignNetBuyAuk)}억 순매수`,
        foreignNetBuyAuk,
      );
    } else if (foreignNetBuyAuk <= -FLOW_THRESHOLD_AUK) {
      tryInsert(
        'foreign_sell', FLOW_THRESHOLD_AUK,
        `[${stockName}] 외국인 ${Math.abs(foreignNetBuyAuk)}억 순매도`,
        foreignNetBuyAuk,
      );
    }

    // 기관 수급
    if (institutionNetBuyAuk >= FLOW_THRESHOLD_AUK) {
      tryInsert(
        'institution_buy', FLOW_THRESHOLD_AUK,
        `[${stockName}] 기관 ${Math.abs(institutionNetBuyAuk)}억 순매수`,
        institutionNetBuyAuk,
      );
    } else if (institutionNetBuyAuk <= -FLOW_THRESHOLD_AUK) {
      tryInsert(
        'institution_sell', FLOW_THRESHOLD_AUK,
        `[${stockName}] 기관 ${Math.abs(institutionNetBuyAuk)}억 순매도`,
        institutionNetBuyAuk,
      );
    }
  }

  // 6. 배치 insert
  let inserted = 0;
  let errors = 0;

  if (toInsert.length > 0) {
    const { error } = await supabase.from('notifications').insert(toInsert);
    if (error) {
      console.error('[STOCK-ALERTS] insert 실패:', error.message);
      errors = toInsert.length;
    } else {
      inserted = toInsert.length;
      console.log(`[STOCK-ALERTS] ${inserted}개 알림 저장`);
    }
  }

  return NextResponse.json({ ok: true, inserted, skipped, errors });
}
