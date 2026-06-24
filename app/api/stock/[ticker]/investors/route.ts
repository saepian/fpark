import { getAccessToken } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

const KIS = 'https://openapi.koreainvestment.com:9443';

function kisHeaders(token: string, trId: string) {
  return {
    'content-type': 'application/json; charset=UTF-8',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
  };
}

async function kisGet(token: string, trId: string, path: string) {
  const res = await fetch(`${KIS}${path}`, {
    headers: kisHeaders(token, trId),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${trId} HTTP ${res.status}`);
  return res.json();
}

// 백만원 → 억원
const toAuk = (v: string | number | undefined) => Math.round(Number(v || 0) / 100);
// 원 → 억원
const wonToAuk = (v: string | number | undefined) => Math.round(Number(v || 0) / 1_0000_0000);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return Response.json({ error: '인증 실패' }, { status: 500 });
  }

  // KST 오늘 날짜
  const today = new Date();
  const kst = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kst.toISOString().split('T')[0].replace(/-/g, '');

  const [investorRes, shortSellRes, priceRes, kospiRes] = await Promise.allSettled([
    // 1. 투자자별 (외국인/기관/개인)
    kisGet(token, 'FHKST01010900',
      `/uapi/domestic-stock/v1/quotations/inquire-investor?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${ticker}`),
    // 2. 공매도
    kisGet(token, 'FHKST130010C0',
      `/uapi/domestic-stock/v1/quotations/inquire-short-sale?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${ticker}&FID_INPUT_DATE_1=${todayStr}&FID_INPUT_DATE_2=${todayStr}&FID_PERIOD_DIV_CODE=D`),
    // 3. 종목 현재가 (당일 누적거래대금 – 원 단위)
    kisGet(token, 'FHKST01010100',
      `/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${ticker}`),
    // 4. KOSPI 업종 차트 (당일 누적거래대금 – 백만원 단위, output1)
    kisGet(token, 'FHKUP03500100',
      `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=0001&FID_INPUT_DATE_1=${todayStr}&FID_INPUT_DATE_2=${todayStr}&FID_PERIOD_DIV_CODE=D`),
  ]);

  // ── 1. 투자자별 매매 동향 ──────────────────────────────────────
  if (investorRes.status === 'rejected') {
    return Response.json({ error: '투자자 데이터 없음' }, { status: 404 });
  }

  const invOutput: Record<string, string>[] = investorRes.value?.output ?? [];
  // 오늘 날짜 데이터 우선, 없으면 가장 최신 유효 데이터
  const todayRow = invOutput.find((d) => d.stck_bsop_date === todayStr && d.frgn_ntby_tr_pbmn !== '');
  const recent   = todayRow ?? invOutput.find((d) => d.frgn_ntby_tr_pbmn !== '');

  if (!recent) {
    return Response.json({ error: '데이터 없음' }, { status: 404 });
  }

  const dataDate = recent.stck_bsop_date || todayStr;
  const date = `${dataDate.slice(0, 4)}.${dataDate.slice(4, 6)}.${dataDate.slice(6, 8)}`;

  const foreign     = { qty: Number(recent.frgn_ntby_qty || 0), amount: toAuk(recent.frgn_ntby_tr_pbmn) };
  const institution = { qty: Number(recent.orgn_ntby_qty || 0), amount: toAuk(recent.orgn_ntby_tr_pbmn) };
  const individual  = { qty: Number(recent.prsn_ntby_qty || 0), amount: toAuk(recent.prsn_ntby_tr_pbmn) };

  // ── 2. 프로그램 매매 ──────────────────────────────────────────
  // investor API에서 먼저 시도, 없으면 별도 API 호출
  let program: { buy: number; sell: number; net: number; amount: number } | null = null;

  const prgmNet = toAuk(recent.prgm_ntby_tr_pbmn);
  const prgmBuy = toAuk(recent.prgm_shnu_tr_pbmn);
  const prgmSell = toAuk(recent.prgm_seln_tr_pbmn);

  if (prgmBuy !== 0 || prgmSell !== 0 || prgmNet !== 0) {
    program = { buy: prgmBuy, sell: prgmSell, net: prgmNet, amount: Math.abs(prgmNet) };
  } else {
    // 별도 프로그램 매매 API 시도
    try {
      const pgData = await kisGet(token, 'FHPPG04650100',
        `/uapi/domestic-stock/v1/quotations/inquire-program-trade-by-stock?FID_INPUT_ISCD=${ticker}&FID_INPUT_DATE_1=${todayStr}&FID_INPUT_DATE_2=${todayStr}&FID_PERIOD_DIV_CODE=D`);

      const pgOut = pgData?.output ?? pgData?.output1 ?? [];
      const pgRow: Record<string, string> = Array.isArray(pgOut) ? pgOut[0] : pgOut;

      if (pgRow) {
        const pgBuy  = toAuk(pgRow.pgms_buy_tr_pbmn  ?? pgRow.shnu_tr_pbmn  ?? pgRow.buy_tr_pbmn);
        const pgSell = toAuk(pgRow.pgms_sell_tr_pbmn ?? pgRow.seln_tr_pbmn  ?? pgRow.sell_tr_pbmn);
        const pgNet  = toAuk(pgRow.pgms_ntby_tr_pbmn ?? pgRow.ntby_tr_pbmn  ?? pgRow.net_tr_pbmn);
        if (pgBuy !== 0 || pgSell !== 0 || pgNet !== 0) {
          program = { buy: pgBuy, sell: pgSell, net: pgNet, amount: Math.abs(pgNet) };
        }
      }
    } catch { /* 프로그램 매매 실패 → null 유지 */ }
  }

  // ── 3. 공매도 현황 ────────────────────────────────────────────
  let shortSell: { qty: number; amount: number; ratio: number } | null = null;
  if (shortSellRes.status === 'fulfilled') {
    try {
      const ssOut = shortSellRes.value?.output ?? shortSellRes.value?.output1 ?? [];
      const row: Record<string, string> = Array.isArray(ssOut) ? ssOut[0] : ssOut;
      if (row) {
        const ssts      = Number(row.ssts_cnt || 0);
        const totalSell = Number(row.stck_total_sell_qty || 0);
        const ratio     = totalSell > 0 ? parseFloat(((ssts / totalSell) * 100).toFixed(2)) : 0;
        if (ssts > 0 || ratio > 0) {
          shortSell = { qty: ssts, amount: toAuk(row.ssts_tr_pbmn), ratio };
        }
      }
    } catch { /* 공매도 실패 → null 유지 */ }
  }

  // ── 4. 거래대금 비중 ──────────────────────────────────────────
  let marketShare: { stockAmount: number; marketAmount: number; ratio: number } | null = null;
  try {
    const stockAmount = priceRes.status === 'fulfilled'
      ? wonToAuk(priceRes.value?.output?.acml_tr_pbmn)
      : 0;

    const marketAmount = kospiRes.status === 'fulfilled'
      ? toAuk(kospiRes.value?.output1?.acml_tr_pbmn)
      : 0;

    if (stockAmount > 0 && marketAmount > 0) {
      marketShare = {
        stockAmount,
        marketAmount,
        ratio: parseFloat(((stockAmount / marketAmount) * 100).toFixed(2)),
      };
    }
  } catch { /* 비중 실패 → null 유지 */ }

  return Response.json({ date, foreign, institution, individual, program, shortSell, marketShare });
}
