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

// rank는 정렬 후 i+1로 부여
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

async function fetchFluctuation(token: string, blngClsCode: string) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE: '20171',
    FID_INPUT_ISCD: '0001',
    FID_DIV_CLS_CODE: '0',
    FID_BLNG_CLS_CODE: blngClsCode,
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
  return res.json();
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
    // ── 거래대금순 ────────────────────────────────────────────────
    if (tab === '거래대금순') {
      const data = await fetchFluctuation(token, '0');
      const rows: any[] = data.output ?? [];
      // KIS API 정렬이 신뢰되지 않으므로 서버에서 거래대금 내림차순 정렬
      rows.sort((a, b) => Number(b.acml_tr_pbmn) - Number(a.acml_tr_pbmn));
      console.log('[ranking] 거래대금순 TOP3:', rows.slice(0, 3).map((x: any) => ({ name: x.hts_kor_isnm, val: x.acml_tr_pbmn })));
      return Response.json(rows.slice(0, 50).map(mapRow));
    }

    // ── 거래량순 ──────────────────────────────────────────────────
    if (tab === '거래량순') {
      const data = await fetchFluctuation(token, '1');
      const rows: any[] = data.output ?? [];
      // 서버에서 거래량 내림차순 정렬
      rows.sort((a, b) => Number(b.acml_vol) - Number(a.acml_vol));
      console.log('[ranking] 거래량순 TOP3:', rows.slice(0, 3).map((x: any) => ({ name: x.hts_kor_isnm, vol: x.acml_vol })));
      return Response.json(rows.slice(0, 50).map(mapRow));
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
      const rows: any[] = data.output ?? [];
      // 급등: 등락률 내림차순, 급락: 오름차순
      rows.sort((a, b) =>
        tab === '급등'
          ? Number(b.prdy_ctrt) - Number(a.prdy_ctrt)
          : Number(a.prdy_ctrt) - Number(b.prdy_ctrt),
      );
      return Response.json(rows.slice(0, 50).map(mapRow));
    }

    return Response.json([]);
  } catch (err) {
    console.error('[ranking]', err);
    return Response.json({ error: '조회 실패' }, { status: 500 });
  }
}
