import { getAccessToken } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

const kisHeaders = (token: string, trId: string) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
  appkey: process.env.KIS_APP_KEY!,
  appsecret: process.env.KIS_APP_SECRET!,
  tr_id: trId,
  custtype: 'P',
});

function mapRow(item: any, i: number) {
  return {
    rank: i + 1,
    ticker: item.stck_shrn_iscd || item.mksc_shrn_iscd || '',
    name: item.hts_kor_isnm,
    price: Number(item.stck_prpr),
    changeRate: Number(item.prdy_ctrt),
    change: Number(item.prdy_vrss),
    volume: Number(item.acml_vol),
    tradingValue: Math.round(Number(item.acml_tr_pbmn) / 1_000_000), // 원 → 백만원
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get('tab') || '거래대금순';

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return Response.json({ error: '인증 실패' }, { status: 500 });
  }

  try {
    // ── 거래대금순 / 거래량순 ────────────────────────────────────
    // FHPST01710000: /ranking/fluctuation + FID_COND_SCR_DIV_CODE=20171
    if (tab === '거래대금순' || tab === '거래량순') {
      const params = new URLSearchParams({
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_COND_SCR_DIV_CODE: '20171',
        FID_INPUT_ISCD: '0001',
        FID_DIV_CLS_CODE: '0',
        FID_BLNG_CLS_CODE: '0',
        FID_TRGT_CLS_CODE: '111111111',
        FID_TRGT_EXLS_CLS_CODE: '000000',
        FID_INPUT_PRICE_1: '0',
        FID_INPUT_PRICE_2: '9999999',
        FID_VOL_CNT: '0',
        FID_INPUT_DATE_1: '',
      });
      const res = await fetch(
        `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation?${params}`,
        { headers: kisHeaders(token, 'FHPST01710000'), cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`FHPST01710000 HTTP ${res.status}`);
      const data = await res.json();
      return Response.json((data.output ?? []).slice(0, 30).map(mapRow));
    }

    // ── 급등 / 급락 ──────────────────────────────────────────────
    if (tab === '급등' || tab === '급락') {
      const params = new URLSearchParams({
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_COND_SCR_DIV_CODE: '170',
        FID_INPUT_ISCD: '0001',
        FID_RANK_SORT_CLS_CODE: tab === '급등' ? '0' : '1',
        FID_INPUT_CNT_1: '0',
        FID_PRC_CLS_CODE: '0',
        FID_INPUT_PRICE_1: '',
        FID_INPUT_PRICE_2: '',
        FID_VOL_CNT: '',
        FID_TRGT_CLS_CODE: '111111111',
        FID_TRGT_EXLS_CLS_CODE: '000000',
        FID_DIV_CLS_CODE: '0',
        FID_INPUT_DATE_1: '',
        FID_RSFL_RATE1: '',
        FID_RSFL_RATE2: '',
        FID_RST_CLB_CODE: '',
      });
      const res = await fetch(
        `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation?${params}`,
        { headers: kisHeaders(token, 'FHPST01700000'), cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`FHPST01700000 HTTP ${res.status}`);
      const data = await res.json();
      if (data.rt_cd !== '0') throw new Error(`FHPST01700000 ${data.msg1}`);
      return Response.json((data.output ?? []).slice(0, 30).map(mapRow));
    }

    // ── 52주 신고가 / 신저가 ──────────────────────────────────────
    // Primary: KIS FHPST01400000 /ranking/high-price
    // Fallback: Supabase cache saved by alerts/route.ts
    try {
      const params = new URLSearchParams({
        FID_COND_MRK_DIV_CODE: 'J',
        FID_COND_SCR_DIV_CODE: '140',
        FID_INPUT_ISCD: '0001',
        FID_RANK_SORT_CLS_CODE: tab === '52주신고가' ? '1' : '2',
        FID_INPUT_CNT_1: '20',
        FID_PRC_CLS_CODE: '1',
        FID_INPUT_PRICE_1: '0',
        FID_INPUT_PRICE_2: '9999999',
        FID_VOL_CNT: '0',
        FID_INPUT_DATE_1: '',
      });
      const res = await fetch(
        `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/high-price?${params}`,
        { headers: kisHeaders(token, 'FHPST01400000'), cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`FHPST01400000 HTTP ${res.status}`);
      const data = await res.json();
      if (data.rt_cd !== '0') throw new Error(`FHPST01400000 ${data.msg1}`);
      return Response.json((data.output ?? []).slice(0, 30).map(mapRow));
    } catch {
      return Response.json([]);
    }
  } catch (err) {
    console.error('[ranking]', err);
    return Response.json({ error: '조회 실패' }, { status: 500 });
  }
}
