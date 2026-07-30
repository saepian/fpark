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

// 2026-07-30 발견: KIS inquire-investor는 당일 데이터가 아직 없으면 관련 필드를 전부
// 빈 문자열("")로 주지만, 드물게는 수량(qty) 필드만 실측치로 먼저 채워지고 금액
// (tr_pbmn) 필드는 아직 "0" placeholder로 남는 중간 상태로도 응답한다 — 기존에는
// frgn_ntby_tr_pbmn 하나만 빈 문자열인지 확인해서 이 "0" placeholder를 정상 데이터로
// 오인, 위젯에 "수량은 정상, 금액은 0원"으로 표시되는 버그가 있었다. 종가(stck_clpr)로
// 그 행이 실제 거래일 데이터인지 먼저 확인하고, 세 주체 수량·금액 필드가 전부 채워져
// 있는지, 그리고 수량이 0이 아닌데 금액이 정확히 0인(현실적으로 불가능 — 0주가 아닌
// 순매매가 정확히 0원일 수 없음) 조합이 없는지까지 교차 검증한다.
const INVESTOR_ENTITY_FIELDS = [
  ['frgn_ntby_qty', 'frgn_ntby_tr_pbmn'],
  ['orgn_ntby_qty', 'orgn_ntby_tr_pbmn'],
  ['prsn_ntby_qty', 'prsn_ntby_tr_pbmn'],
] as const;

function isUsableInvestorRow(d: Record<string, string>): boolean {
  if (!d.stck_clpr) return false; // 종가 없음 — 실제 거래일 데이터가 아님
  for (const [qtyKey, amtKey] of INVESTOR_ENTITY_FIELDS) {
    if (d[qtyKey] === '' || d[qtyKey] === undefined) return false;
    if (d[amtKey] === '' || d[amtKey] === undefined) return false;
    // 수량은 0이 아닌데 금액이 정확히 0이면 금액이 아직 집계 안 된 placeholder일
    // 가능성이 높다 — 이 행 전체를 무효 처리하고 이전 유효 행으로 폴백시킨다.
    if (Number(d[qtyKey]) !== 0 && Number(d[amtKey]) === 0) return false;
  }
  return true;
}

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
  // 오늘 날짜 데이터 우선, 없으면 가장 최신 유효 데이터 — isUsableInvestorRow로 "값이
  // 있음"과 "값이 실제로 집계 완료됨"을 구분한다(위 주석 참고).
  const todayRow = invOutput.find((d) => d.stck_bsop_date === todayStr && isUsableInvestorRow(d));
  const recent   = todayRow ?? invOutput.find(isUsableInvestorRow);

  if (!recent) {
    return Response.json({ error: '데이터 없음' }, { status: 404 });
  }

  const dataDate = recent.stck_bsop_date || todayStr;
  const date = `${dataDate.slice(0, 4)}.${dataDate.slice(4, 6)}.${dataDate.slice(6, 8)}`;

  // 2026-07-30 발견: toAuk가 억원 단위로 반올림하다 보니 저가·소형주(하루 순매매가
  // 50백만원 미만인 경우, 예 012860)는 실제 값이 있어도 전부 "0"으로 뭉개져 위젯에
  // "0원"으로 표시됐다(실측 — 모베이스전자 -9/+2/+7백만원이 전부 0억원으로 반올림).
  // amount(억원, 반올림)는 대형주 표시 그대로 유지하되, 클라이언트가 "반올림으로 0"과
  // "진짜 무변동 0"을 구분할 수 있도록 원본(백만원, 미반올림) 값을 amountRaw로 같이
  // 내려준다 — KIS 필드 자체가 이미 백만원 단위라 별도 변환 없이 그대로 전달.
  const foreign     = { qty: Number(recent.frgn_ntby_qty || 0), amount: toAuk(recent.frgn_ntby_tr_pbmn), amountRaw: Number(recent.frgn_ntby_tr_pbmn || 0) };
  const institution = { qty: Number(recent.orgn_ntby_qty || 0), amount: toAuk(recent.orgn_ntby_tr_pbmn), amountRaw: Number(recent.orgn_ntby_tr_pbmn || 0) };
  const individual  = { qty: Number(recent.prsn_ntby_qty || 0), amount: toAuk(recent.prsn_ntby_tr_pbmn), amountRaw: Number(recent.prsn_ntby_tr_pbmn || 0) };

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

    // 2026-07-30 발견: 여기서 kospiRes에 썼던 toAuk(백만원 가정, ÷100)는 단위가
    // 틀렸다 — kospiRes도 stockAmount와 동일한 inquire-daily-itemchartprice 계열
    // 엔드포인트(FID_COND_MRKT_DIV_CODE=U로 지수 조회)라서 acml_tr_pbmn이 원 단위다
    // (lib/kis-api.ts의 formatTradingValue/fetchDailyChart가 이미 이 필드를 원 단위로
    // 다루고 있음 — 같은 tr_id·같은 필드라 종목 조회든 지수 조회든 단위가 같다).
    // 실측: 라이브로 확인한 값 기준 이전 코드는 marketAmount를 약 100만 배 부풀려
    // "KOSPI 대비" 비율이 실제보다 훨씬 작게(극단적으로는 0.00%까지) 나오는 문제가 있었다.
    const marketAmount = kospiRes.status === 'fulfilled'
      ? wonToAuk(kospiRes.value?.output1?.acml_tr_pbmn)
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
