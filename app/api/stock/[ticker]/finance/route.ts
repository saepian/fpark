import { NextRequest } from 'next/server';
import { getAccessToken } from '@/lib/kis-api';

// 캐시 없음(cache: 'no-store') — 요청마다 KIS를 실시간 호출한다.
// 이 라우트는 의도적으로 "최근 3개 연도의 확정 연간 실적"만 반환한다(annualRows 필터).
// 분기 실적이나 "잠정실적"(장 마감 후 공시되는 속보성 실적, DART/거래소 공시 기반)은
// 애초에 다루지 않는다 — KIS의 financial-ratio/balance-sheet TR 자체가 정식 재무제표
// 기준이라 잠정실적 공시와는 별개의 파이프라인이고(2026-07-08 삼성전자 2분기 잠정실적
// 미반영 문의로 확인: 이 시점 KIS 데이터의 최신 분기 행도 202603(1분기)까지만 존재),
// 여기서 분기 데이터를 노출하려면 완전히 다른 데이터 소스(DART 공시 API 등) 연동이 필요하다.
export const dynamic = 'force-dynamic';

const KIS = 'https://openapi.koreainvestment.com:9443';

function kisHeaders(token: string, trId: string) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
  };
}

async function fetchApi(token: string, trId: string, endpoint: string, ticker: string) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: ticker,
    FID_DIV_CLS_CODE: '0', // 연간
  });
  const res = await fetch(`${KIS}/uapi/domestic-stock/v1/finance/${endpoint}?${params}`, {
    headers: kisHeaders(token, trId),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${trId} HTTP ${res.status}`);
  const d = await res.json();
  if (d.rt_cd !== '0') throw new Error(d.msg1);
  return (d.output ?? []) as any[];
}

function isAnnual(stacYymm: string): boolean {
  // Annual rows: stac_yymm ends in a year-end month
  // For FID_DIV_CLS_CODE='0', non-partial rows are annual reports
  // Detect by finding rows with 12-month intervals between entries
  // Simplest: accept rows whose month == '12' OR rows that skip quarters
  // We'll filter after collecting all rows
  return true; // handled in caller
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

  try {
    const token = await getAccessToken();

    const [ratioRows, bsRows] = await Promise.all([
      fetchApi(token, 'FHKST66430200', 'financial-ratio', ticker),
      fetchApi(token, 'FHKST66430300', 'balance-sheet', ticker),
    ]);

    // Build ROE map by stac_yymm
    const roeMap = new Map<string, number>();
    for (const r of bsRows) {
      const v = parseFloat(r.roe_val);
      if (!isNaN(v) && v !== 99.99) roeMap.set(r.stac_yymm, v);
    }

    // FID_DIV_CLS_CODE='0' gives annual + current partial-year rows.
    // Annual rows have 12-month gaps; detect the most common year-end month.
    const months = ratioRows.slice(1).map((r: any) => r.stac_yymm.slice(4));
    const monthCount: Record<string, number> = {};
    for (const m of months) monthCount[m] = (monthCount[m] ?? 0) + 1;
    const yearEndMonth = Object.entries(monthCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '12';

    // Filter to annual rows only (those with year-end month), take 3 most recent
    const annualRows = ratioRows
      .filter((r: any) => r.stac_yymm.slice(4) === yearEndMonth)
      .slice(0, 3);

    const result = annualRows.map((r: any) => {
      const revenue = parseFloat(r.sale_account);
      const opProfit = parseFloat(r.bsop_prti);
      const netIncome = parseFloat(r.thtr_ntin);
      return {
        year: r.stac_yymm.slice(0, 4),
        revenue: isNaN(revenue) || revenue === 99.99 ? null : Math.round(revenue),
        operatingProfit: isNaN(opProfit) || opProfit === 99.99 ? null : Math.round(opProfit),
        netIncome: isNaN(netIncome) || netIncome === 99.99 ? null : Math.round(netIncome),
        roe: roeMap.get(r.stac_yymm) ?? null,
      };
    });

    return Response.json(result);
  } catch (err) {
    console.error(`[finance] ${ticker}:`, err);
    return Response.json([]);
  }
}
