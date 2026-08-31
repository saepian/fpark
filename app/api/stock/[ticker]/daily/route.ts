import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken, acquireKisRateSlot } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

function headers(token: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=UTF-8',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: 'FHKST01010400',
    custtype: 'P',
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const token = await getAccessToken();

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const mktCode of ['J', 'Q']) {
      const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price`);
      url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
      url.searchParams.set('FID_INPUT_ISCD', ticker);
      url.searchParams.set('FID_PERIOD_DIV_CODE', 'D');
      url.searchParams.set('FID_ORG_ADJ_PRC', '0');

      try {
        // 2026-08-31 트래픽 점검: investors 라우트와 같은 이유로 전역 KIS 레이트리미터
        // 게이트 추가(직접 fetch라 게이트를 우회하고 있었음).
        await acquireKisRateSlot();
        const res = await fetch(url.toString(), {
          headers: headers(token),
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) continue;

        const data = await res.json();
        if (data.rt_cd !== '0' || !Array.isArray(data.output) || data.output.length === 0) continue;

        const result = data.output.slice(0, 5).map((d: any) => ({
          date: d.stck_bsop_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
          open: Number(d.stck_oprc),
          high: Number(d.stck_hgpr),
          low: Number(d.stck_lwpr),
          close: Number(d.stck_clpr),
          volume: Number(d.acml_vol),
          changeRate: Number(d.prdy_ctrt),
        }));

        return NextResponse.json(result);
      } catch {
        continue;
      }
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
  }

  return NextResponse.json({ error: '일별 시세 조회 실패' }, { status: 502 });
}
