import { load } from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { getAccessToken } from './kis-api';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

let _sb: ReturnType<typeof createClient> | null = null;
function getSb() {
  if (!_sb) _sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return _sb;
}

function kisHdr(token: string, trId: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=UTF-8',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
  };
}

// KIS 수급 API 단위: 백만원 → 억원
const toAuk = (v: string | number | undefined) => Math.round(Number(v || 0) / 100);

export interface InvestorFlow {
  foreign:     { qty: number; amount: number };
  institution: { qty: number; amount: number };
  individual:  { qty: number; amount: number };
}

export interface InvestorDay {
  date:        string;
  foreign:     number;
  institution: number;
  individual:  number;
}

export interface StockAnalysisData {
  currentPrice:    number;
  stockName:       string;
  per:             number;
  pbr:             number;
  eps:             number;
  week52High:      number;
  week52Low:       number;
  week52Position:  number;
  volume:          number;
  operatingProfit?: string;
  revenue?:         string;
  investorLatest:   InvestorFlow | null;
  investorTrend:    InvestorDay[];
  news:             { title: string; summary?: string; date?: string; url?: string }[];
}

async function fetchKisPrice(ticker: string, fallbackName: string): Promise<{
  currentPrice: number; stockName: string; per: number; pbr: number; eps: number;
  week52High: number; week52Low: number; week52Position: number; volume: number;
} | null> {
  try {
    console.log('[ANALYSIS] fetchKisPrice 시작', ticker);
    const token = await getAccessToken();
    for (const mkt of ['J', 'Q']) {
      const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
      url.searchParams.set('FID_COND_MRKT_DIV_CODE', mkt);
      url.searchParams.set('FID_INPUT_ISCD', ticker);
      const res = await fetch(url.toString(), {
        headers: kisHdr(token, 'FHKST01010100'),
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) { console.log(`[ANALYSIS] fetchKisPrice ${mkt} HTTP ${res.status}`); continue; }
      const data = await res.json();
      if (data.rt_cd !== '0') { console.log(`[ANALYSIS] fetchKisPrice ${mkt} rt_cd=${data.rt_cd}`); continue; }
      const o   = data.output;
      const cur  = parseInt(o.stck_prpr, 10) || 0;
      const high = parseInt(o.w52_hgpr,  10) || 0;
      const low  = parseInt(o.w52_lwpr,  10) || 0;
      const pos  = (high > low && cur > 0)
        ? Math.min(100, Math.max(0, Math.round((cur - low) / (high - low) * 100)))
        : 50;
      console.log(`[ANALYSIS] fetchKisPrice 성공 ${mkt}`, { cur, per: o.per, pbr: o.pbr });
      return {
        currentPrice:   cur,
        stockName:      (o.hts_kor_isnm || o.prdt_abrv_name || fallbackName).trim() || fallbackName,
        per:            parseFloat(o.per)  || 0,
        pbr:            parseFloat(o.pbr)  || 0,
        eps:            parseInt(o.eps || '0', 10) || 0,
        week52High:     high,
        week52Low:      low,
        week52Position: pos,
        volume:         parseInt(o.acml_vol, 10) || 0,
      };
    }
    console.log('[ANALYSIS] fetchKisPrice 모든 시장 실패');
  } catch (e) { console.error('[ANALYSIS] fetchKisPrice 예외:', e); }
  return null;
}

async function fetchInvestorTrend(ticker: string): Promise<{ latest: InvestorFlow | null; trend: InvestorDay[] }> {
  try {
    console.log('[ANALYSIS] fetchInvestorTrend 시작', ticker);
    const token    = await getAccessToken();
    const kst      = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = kst.toISOString().split('T')[0].replace(/-/g, '');

    const res = await fetch(
      `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-investor?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${ticker}`,
      { headers: kisHdr(token, 'FHKST01010900'), cache: 'no-store', signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) {
      console.log('[ANALYSIS] fetchInvestorTrend HTTP', res.status);
      return { latest: null, trend: [] };
    }

    const data   = await res.json();
    const output: Record<string, string>[] = data?.output ?? [];
    const valid  = output.filter(d => d.stck_bsop_date && d.frgn_ntby_tr_pbmn !== '');
    if (!valid.length) {
      console.log('[ANALYSIS] fetchInvestorTrend 유효 데이터 없음, rt_cd=', data?.rt_cd);
      return { latest: null, trend: [] };
    }

    const today = valid.find(d => d.stck_bsop_date === todayStr) ?? valid[0];
    console.log('[ANALYSIS] fetchInvestorTrend 성공, 데이터 수:', valid.length);
    return {
      latest: {
        foreign:     { qty: Number(today.frgn_ntby_qty || 0), amount: toAuk(today.frgn_ntby_tr_pbmn) },
        institution: { qty: Number(today.orgn_ntby_qty || 0), amount: toAuk(today.orgn_ntby_tr_pbmn) },
        individual:  { qty: Number(today.prsn_ntby_qty || 0), amount: toAuk(today.prsn_ntby_tr_pbmn) },
      },
      trend: valid.slice(0, 5).map(d => ({
        date:        `${d.stck_bsop_date.slice(0,4)}-${d.stck_bsop_date.slice(4,6)}-${d.stck_bsop_date.slice(6,8)}`,
        foreign:     toAuk(d.frgn_ntby_tr_pbmn),
        institution: toAuk(d.orgn_ntby_tr_pbmn),
        individual:  toAuk(d.prsn_ntby_tr_pbmn),
      })),
    };
  } catch (e) {
    console.error('[ANALYSIS] fetchInvestorTrend 예외:', e);
    return { latest: null, trend: [] };
  }
}

async function fetchNaverFinancials(ticker: string): Promise<{ operatingProfit?: string; revenue?: string }> {
  try {
    console.log('[ANALYSIS] fetchNaverFinancials 시작', ticker);
    const res = await fetch(`https://finance.naver.com/item/main.naver?code=${ticker}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://finance.naver.com/',
      },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.log('[ANALYSIS] fetchNaverFinancials HTTP', res.status);
      return {};
    }

    const html = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
    const $    = load(html);

    let revenue: string | undefined;
    let operatingProfit: string | undefined;

    $('table tr').each((_, tr) => {
      if (revenue && operatingProfit) return;
      const $tr = $(tr);
      const th  = $tr.find('th').first().text().trim();
      if (!th) return;

      let firstVal = '';
      $tr.find('td').each((_, td) => {
        if (firstVal) return;
        const v = $(td).text().trim().replace(/[,\s]/g, '');
        if (v && v !== '-' && /^\d/.test(v)) firstVal = v;
      });
      if (!firstVal) return;

      const n = Number(firstVal);
      if (isNaN(n)) return;
      const label = n.toLocaleString('ko-KR') + '억원';

      if (!revenue && (th.includes('매출액') || th === '매출'))             revenue = label;
      if (!operatingProfit && (th.includes('영업이익') || th.includes('영업손익'))) operatingProfit = label;
    });

    console.log('[ANALYSIS] fetchNaverFinancials 완료', { revenue, operatingProfit });
    return { revenue, operatingProfit };
  } catch (e) {
    console.error('[ANALYSIS] fetchNaverFinancials 예외:', e);
    return {};
  }
}

async function fetchDBNews(name: string, ticker: string): Promise<{ title: string; summary?: string; date?: string; url?: string }[]> {
  try {
    console.log('[ANALYSIS] fetchDBNews 시작', { name, ticker });
    const sb = getSb();

    // 두 쿼리를 분리하여 JSONB 구문 오류 방지
    const [byTitle, byTicker] = await Promise.allSettled([
      sb.from('articles')
        .select('title, summary, published_at, url')
        .ilike('title', `%${name}%`)
        .order('published_at', { ascending: false })
        .limit(5),
      sb.from('articles')
        .select('title, summary, published_at, url')
        .contains('stocks', [{ code: ticker }])
        .order('published_at', { ascending: false })
        .limit(5),
    ]);

    const seen  = new Set<string>();
    const items: { title: string; summary?: string; date?: string; url?: string }[] = [];

    const merge = (rows: { title: string; summary: string | null; published_at: string | null; url?: string | null }[]) => {
      for (const a of rows) {
        if (seen.has(a.title)) continue;
        seen.add(a.title);
        items.push({
          title:   a.title,
          summary: a.summary ?? undefined,
          date:    a.published_at ? new Date(a.published_at).toLocaleDateString('ko-KR') : undefined,
          url:     a.url ?? undefined,
        });
      }
    };

    if (byTitle.status === 'fulfilled' && byTitle.value.data) merge(byTitle.value.data);
    if (byTicker.status === 'fulfilled' && byTicker.value.data) merge(byTicker.value.data);

    if (byTitle.status  === 'rejected') console.error('[ANALYSIS] fetchDBNews byTitle 실패:', byTitle.reason);
    if (byTicker.status === 'rejected') console.error('[ANALYSIS] fetchDBNews byTicker 실패:', byTicker.reason);

    console.log('[ANALYSIS] fetchDBNews 완료, 건수:', items.length);
    return items.slice(0, 5);
  } catch (e) {
    console.error('[ANALYSIS] fetchDBNews 예외:', e);
    return [];
  }
}

export async function collectStockAnalysisData(
  ticker: string,
  name: string,
): Promise<StockAnalysisData> {
  console.log('[ANALYSIS] collectStockAnalysisData 시작', { ticker, name });
  const [priceRes, invRes, naverRes, newsRes] = await Promise.allSettled([
    fetchKisPrice(ticker, name),
    fetchInvestorTrend(ticker),
    fetchNaverFinancials(ticker),
    fetchDBNews(name, ticker),
  ]);

  console.log('[ANALYSIS] collectStockAnalysisData 결과', {
    price: priceRes.status, inv: invRes.status, naver: naverRes.status, news: newsRes.status,
    priceErr: priceRes.status === 'rejected' ? String(priceRes.reason) : null,
    invErr:   invRes.status   === 'rejected' ? String(invRes.reason)   : null,
    naverErr: naverRes.status === 'rejected' ? String(naverRes.reason) : null,
    newsErr:  newsRes.status  === 'rejected' ? String(newsRes.reason)  : null,
  });

  const price = priceRes.status === 'fulfilled' ? priceRes.value : null;
  const inv   = invRes.status   === 'fulfilled' ? invRes.value   : { latest: null, trend: [] };
  const nav   = naverRes.status === 'fulfilled' ? naverRes.value : {};
  const news  = newsRes.status  === 'fulfilled' ? newsRes.value  : [];

  return {
    currentPrice:    price?.currentPrice    ?? 0,
    stockName:       price?.stockName       ?? name,
    per:             price?.per             ?? 0,
    pbr:             price?.pbr             ?? 0,
    eps:             price?.eps             ?? 0,
    week52High:      price?.week52High      ?? 0,
    week52Low:       price?.week52Low       ?? 0,
    week52Position:  price?.week52Position  ?? 50,
    volume:          price?.volume          ?? 0,
    operatingProfit: nav.operatingProfit,
    revenue:         nav.revenue,
    investorLatest:  inv.latest,
    investorTrend:   inv.trend,
    news,
  };
}

// ── 공통 프롬프트 빌더 ────────────────────────────────────────────────────────

export function buildTechnicalBlock(ad: StockAnalysisData): string {
  const { week52High, week52Low, week52Position, per, pbr, eps, volume,
          operatingProfit, revenue } = ad;
  const lines: string[] = [];

  if (week52High > 0) {
    lines.push(`52주 고가: ${week52High.toLocaleString()}원 / 저가: ${week52Low.toLocaleString()}원`);
    lines.push(`52주 위치: ${week52Position}% (저가=0%, 고가=100%)`);
  }
  if (volume > 0) lines.push(`당일 거래량: ${volume.toLocaleString()}주`);
  if (per > 0)    lines.push(`PER: ${per.toFixed(1)}배`);
  if (pbr > 0)    lines.push(`PBR: ${pbr.toFixed(2)}배`);
  if (eps > 0)    lines.push(`EPS: ${eps.toLocaleString()}원`);
  if (operatingProfit) lines.push(`최근 분기 영업이익: ${operatingProfit}`);
  if (revenue)         lines.push(`최근 분기 매출액: ${revenue}`);

  return lines.map(l => `- ${l}`).join('\n') || '- 데이터 없음';
}

export function buildInvestorBlock(ad: StockAnalysisData): string {
  const { investorLatest, investorTrend } = ad;
  if (!investorLatest && !investorTrend.length) return '데이터 없음';

  const lines: string[] = [];

  if (investorTrend.length > 0) {
    lines.push('| 날짜 | 외국인(억원) | 기관(억원) | 개인(억원) |');
    lines.push('|------|------------|----------|----------|');
    for (const d of investorTrend) {
      const fmt = (v: number) => (v >= 0 ? `+${v.toLocaleString()}` : v.toLocaleString());
      lines.push(`| ${d.date} | ${fmt(d.foreign)} | ${fmt(d.institution)} | ${fmt(d.individual)} |`);
    }
  }

  if (investorLatest) {
    const { foreign, institution, individual } = investorLatest;
    const sign = (v: number) => v >= 0 ? '순매수' : '순매도';
    lines.push('');
    lines.push(`최근 수급: 외국인 ${foreign.amount >= 0 ? '+' : ''}${foreign.amount}억원 ${sign(foreign.amount)}, 기관 ${institution.amount >= 0 ? '+' : ''}${institution.amount}억원 ${sign(institution.amount)}, 개인 ${individual.amount >= 0 ? '+' : ''}${individual.amount}억원 ${sign(individual.amount)}`);
  }

  return lines.join('\n');
}

export function buildNewsBlock(dbNews: { title: string; summary?: string; date?: string }[], naverNews?: { title: string; description: string }[]): string {
  const allNews: { title: string; desc?: string; date?: string }[] = [];

  for (const n of dbNews) {
    allNews.push({ title: n.title, desc: n.summary, date: n.date });
  }
  if (naverNews) {
    for (const n of naverNews) {
      if (!allNews.some(a => a.title === n.title)) {
        allNews.push({ title: n.title, desc: n.description });
      }
    }
  }

  if (!allNews.length) return '관련 뉴스 없음';
  return allNews.slice(0, 7).map((n, i) => {
    const datePart = n.date ? `[${n.date}] ` : '';
    const descPart = n.desc ? ` — ${n.desc}` : '';
    return `${i + 1}. ${datePart}${n.title}${descPart}`;
  }).join('\n');
}
