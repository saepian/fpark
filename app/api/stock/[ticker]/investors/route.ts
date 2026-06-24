import { getAccessToken } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  try {
    const token = await getAccessToken();
    const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-investor?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${ticker}`;

    const res = await fetch(url, {
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: 'FHKST01010900',
        custtype: 'P',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return Response.json({ error: 'KIS API 오류' }, { status: 502 });
    }

    const data = await res.json();
    // 오늘 장중에는 값이 빈 문자열일 수 있으므로 유효한 값이 있는 가장 최근 날짜 사용
    const output: Record<string, string>[] = data.output ?? [];
    const recent = output.find((row) => row.frgn_ntby_tr_pbmn !== '');

    if (!recent) {
      return Response.json({ error: '데이터 없음' }, { status: 404 });
    }

    return Response.json({
      date:        recent.stck_bsop_date ?? '',
      foreign:     { qty: Number(recent.frgn_ntby_qty),  amount: Number(recent.frgn_ntby_tr_pbmn) },
      institution: { qty: Number(recent.orgn_ntby_qty),  amount: Number(recent.orgn_ntby_tr_pbmn) },
      individual:  { qty: Number(recent.prsn_ntby_qty),  amount: Number(recent.prsn_ntby_tr_pbmn) },
    });
  } catch (err) {
    console.error('[investors] error:', err);
    return Response.json({ error: '서버 오류' }, { status: 500 });
  }
}
