import { load } from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { getAccessToken } from './kis-api';
import type { ChartDataPoint } from './types';

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
  sector?:          string;
  isCached?:        boolean;
  cachedAt?:        string;
}

type KisPriceResult = {
  currentPrice: number; stockName: string; per: number; pbr: number; eps: number;
  week52High: number; week52Low: number; week52Position: number; volume: number;
  sector: string; isCached?: boolean; cachedAt?: string;
};

// 휴장일 등으로 실시간 시세 조회가 실패했을 때 대체할 "마지막 성공 응답" 캐시.
// app/api/stock/[ticker]/info/route.ts의 market_cache 패턴과 동일 (키만 분리해 충돌 방지).
const priceCacheKey = (ticker: string) => `stock_analysis_price_${ticker}`;

async function loadPriceCache(ticker: string): Promise<{ data: KisPriceResult; updatedAt: string } | null> {
  try {
    const { data: cache } = await getSb()
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', priceCacheKey(ticker))
      .single();
    if (!cache?.data) return null;
    return { data: cache.data as KisPriceResult, updatedAt: cache.updated_at as string };
  } catch {
    return null;
  }
}

function savePriceCache(ticker: string, data: KisPriceResult) {
  getSb()
    .from('market_cache')
    .upsert({ key: priceCacheKey(ticker), data, updated_at: new Date().toISOString() })
    .then(({ error }) => {
      if (error) console.warn(`[ANALYSIS] ${ticker} 시세 캐시 저장 실패:`, error.message);
    });
}

async function fetchKisPrice(ticker: string, fallbackName: string): Promise<KisPriceResult | null> {
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
      const result: KisPriceResult = {
        currentPrice:   cur,
        stockName:      (o.hts_kor_isnm || o.prdt_abrv_name || fallbackName).trim() || fallbackName,
        per:            parseFloat(o.per)  || 0,
        pbr:            parseFloat(o.pbr)  || 0,
        eps:            parseInt(o.eps || '0', 10) || 0,
        week52High:     high,
        week52Low:      low,
        week52Position: pos,
        volume:         parseInt(o.acml_vol, 10) || 0,
        sector:         (o.bstp_kor_isnm ?? '').trim(),
      };
      savePriceCache(ticker, result);
      return result;
    }
    console.log('[ANALYSIS] fetchKisPrice 모든 시장 실패 — 캐시 폴백 시도');
  } catch (e) {
    console.error('[ANALYSIS] fetchKisPrice 예외:', e, '— 캐시 폴백 시도');
  }

  // 휴장일 등으로 실시간 조회 실패 — 마지막 성공 응답(마지막 거래일 종가·52주 고저가)으로 대체
  const cached = await loadPriceCache(ticker);
  if (cached) {
    console.log(`[ANALYSIS] fetchKisPrice 캐시 폴백 성공 — ${ticker} (${cached.updatedAt} 기준)`);
    return { ...cached.data, isCached: true, cachedAt: cached.updatedAt };
  }
  console.log('[ANALYSIS] fetchKisPrice 캐시도 없음 —', ticker);
  return null;
}

export async function fetchInvestorTrend(ticker: string): Promise<{ latest: InvestorFlow | null; trend: InvestorDay[] }> {
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
      signal: AbortSignal.timeout(5000),
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

export async function fetchDBNews(
  name: string,
  ticker: string,
  sector?: string,
): Promise<{ title: string; summary?: string; date?: string; url?: string }[]> {
  try {
    console.log('[ANALYSIS] fetchDBNews 시작', { name, ticker, sector });
    const sb = getSb();

    // 종목명/종목코드/업종 키워드 쿼리를 분리하여 JSONB 구문 오류 방지
    const queries = [
      sb.from('articles')
        .select('title, summary, published_at, original_url')
        .ilike('title', `%${name}%`)
        .order('published_at', { ascending: false })
        .limit(5),
      sb.from('articles')
        .select('title, summary, published_at, original_url')
        .contains('stocks', [{ code: ticker }])
        .order('published_at', { ascending: false })
        .limit(5),
    ];
    // 업종명(2글자 이상)으로도 관련 뉴스 후보를 넓힘 — 관련도 랭킹은 pickRelevantNews()에서 처리
    if (sector && sector.trim().length >= 2) {
      queries.push(
        sb.from('articles')
          .select('title, summary, published_at, original_url')
          .ilike('title', `%${sector.trim()}%`)
          .order('published_at', { ascending: false })
          .limit(5),
      );
    }

    const results = await Promise.allSettled(queries);

    const seen  = new Set<string>();
    const items: { title: string; summary?: string; date?: string; url?: string }[] = [];

    const merge = (rows: { title: string; summary: string | null; published_at: string | null; original_url?: string | null }[]) => {
      for (const a of rows) {
        if (seen.has(a.title)) continue;
        seen.add(a.title);
        items.push({
          title:   a.title,
          summary: a.summary ?? undefined,
          date:    a.published_at ? new Date(a.published_at).toLocaleDateString('ko-KR') : undefined,
          url:     a.original_url ?? undefined,
        });
      }
    };

    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.data) merge(r.value.data);
      else if (r.status === 'rejected') console.error(`[ANALYSIS] fetchDBNews 쿼리${i} 실패:`, r.reason);
    });

    console.log('[ANALYSIS] fetchDBNews 완료, 건수:', items.length);
    return items.slice(0, 10);
  } catch (e) {
    console.error('[ANALYSIS] fetchDBNews 예외:', e);
    return [];
  }
}

// 시장 전체(개별 종목이 아닌 코스피/코스닥/금리/환율 등 매크로) 뉴스 조회.
// 영어권 기사(Wall Street, Nasdaq 등)도 국내 반도체 급락 등과 직결되는 경우가 있어 영문 키워드도 포함.
const MARKET_KEYWORDS = [
  '코스피', '코스닥', '금리', '환율', '연준', 'FOMC', '물가', '중동',
  'Wall Street', 'Nasdaq', 'S&P', 'Dow', 'Fed',
];

export async function fetchMarketNews(
  sinceIso: string,
  limit = 5,
): Promise<{ title: string; summary?: string; date?: string; url?: string }[]> {
  try {
    const sb = getSb();
    const queries = MARKET_KEYWORDS.map((kw) =>
      sb.from('articles')
        .select('title, summary, published_at, original_url')
        .ilike('title', `%${kw}%`)
        .gte('published_at', sinceIso)
        .order('published_at', { ascending: false })
        .limit(3),
    );
    const results = await Promise.allSettled(queries);

    const seen = new Set<string>();
    const items: { title: string; summary?: string; publishedAt: string; url?: string }[] = [];
    const merge = (rows: { title: string; summary: string | null; published_at: string | null; original_url?: string | null }[]) => {
      for (const a of rows) {
        if (seen.has(a.title) || !a.published_at) continue;
        seen.add(a.title);
        items.push({ title: a.title, summary: a.summary ?? undefined, publishedAt: a.published_at, url: a.original_url ?? undefined });
      }
    };
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.data) merge(r.value.data);
      else if (r.status === 'rejected') console.error(`[ANALYSIS] fetchMarketNews 쿼리${i} 실패:`, r.reason);
    });

    // 최신순 정렬 후 상위 N개만, 표시용 날짜로 변환
    items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    console.log('[ANALYSIS] fetchMarketNews 완료, 건수:', items.length);
    return items.slice(0, limit).map((a) => ({
      title: a.title, summary: a.summary, url: a.url,
      date: new Date(a.publishedAt).toLocaleDateString('ko-KR'),
    }));
  } catch (e) {
    console.error('[ANALYSIS] fetchMarketNews 예외:', e);
    return [];
  }
}

export async function collectStockAnalysisData(
  ticker: string,
  name: string,
): Promise<StockAnalysisData> {
  console.log('[ANALYSIS] collectStockAnalysisData 시작', { ticker, name });

  // 가격(+업종) 조회 후 그 결과(sector)를 뉴스 검색 키워드로 활용 — 나머지는 독립적으로 병렬 진행
  const pricePromise = fetchKisPrice(ticker, name);
  const invPromise   = fetchInvestorTrend(ticker);
  const navPromise   = fetchNaverFinancials(ticker);

  const priceRes = await pricePromise.then(
    (v) => ({ status: 'fulfilled' as const, value: v }),
    (e) => ({ status: 'rejected' as const, reason: e }),
  );
  const price = priceRes.status === 'fulfilled' ? priceRes.value : null;

  const [invRes, navRes, newsRes] = await Promise.allSettled([
    invPromise,
    navPromise,
    fetchDBNews(name, ticker, price?.sector),
  ]);

  console.log('[ANALYSIS] collectStockAnalysisData 결과', {
    price: priceRes.status, inv: invRes.status, naver: navRes.status, news: newsRes.status,
    priceErr: priceRes.status === 'rejected' ? String(priceRes.reason) : null,
    invErr:   invRes.status   === 'rejected' ? String(invRes.reason)   : null,
    naverErr: navRes.status   === 'rejected' ? String(navRes.reason)   : null,
    newsErr:  newsRes.status  === 'rejected' ? String(newsRes.reason)  : null,
  });

  const inv  = invRes.status === 'fulfilled' ? invRes.value : { latest: null, trend: [] };
  const nav  = navRes.status === 'fulfilled' ? navRes.value : {};
  const news = newsRes.status === 'fulfilled' ? newsRes.value : [];

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
    sector:          price?.sector,
    isCached:        price?.isCached,
    cachedAt:        price?.cachedAt,
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
    const sign = (v: number) => v >= 0 ? '자금 유입' : '자금 유출';
    lines.push('');
    lines.push(`최근 수급: 외국인 ${foreign.amount >= 0 ? '+' : ''}${foreign.amount}억원 ${sign(foreign.amount)}, 기관 ${institution.amount >= 0 ? '+' : ''}${institution.amount}억원 ${sign(institution.amount)}, 개인 ${individual.amount >= 0 ? '+' : ''}${individual.amount}억원 ${sign(individual.amount)}`);
  }

  return lines.join('\n');
}

export function buildNewsBlock(news: { title: string; summary?: string; date?: string }[]): string {
  if (!news.length) return '관련 뉴스 없음';
  return news.slice(0, 3).map((n, i) => {
    const datePart = n.date ? `[${n.date}] ` : '';
    const descPart = n.summary ? ` — ${n.summary}` : '';
    return `${i + 1}. ${datePart}${n.title}${descPart}`;
  }).join('\n');
}

// 종목명/업종 키워드 기반 간단 관련도 스코어링 — 정확도보다는 "관련 뉴스 있음/없음" 구분이 목적
export function pickRelevantNews<T extends { title: string; summary?: string }>(
  candidates: T[],
  stockName: string,
  sector?: string,
  limit = 3,
): T[] {
  const nameLower   = stockName.trim().toLowerCase();
  const sectorLower = (sector ?? '').trim().toLowerCase();

  const seen = new Set<string>();
  const scored = candidates
    .filter((n) => {
      if (seen.has(n.title)) return false;
      seen.add(n.title);
      return true;
    })
    .map((n) => {
      const title   = n.title.toLowerCase();
      const summary = (n.summary ?? '').toLowerCase();
      let score = 0;
      if (nameLower && title.includes(nameLower))                    score += 3;
      if (nameLower && summary.includes(nameLower))                  score += 1;
      if (sectorLower.length >= 2 && title.includes(sectorLower))     score += 2;
      if (sectorLower.length >= 2 && summary.includes(sectorLower))   score += 1;
      return { item: n, score };
    });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}

// 일별 종가 배열 → 최대낙폭(MDD)·일별 변동성(표준편차) — 판단 없이 관측된 수치만 산출
export function computeRiskMetrics(closes: number[]): { mdd: number; volatility: number } | null {
  const valid = closes.filter((c) => c > 0);
  if (valid.length < 2) return null;

  let peak = valid[0];
  let maxDrawdown = 0; // <= 0
  const returns: number[] = [];

  valid.forEach((c, i) => {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
    if (i > 0 && valid[i - 1] > 0) returns.push((c - valid[i - 1]) / valid[i - 1]);
  });

  const mean     = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length || 1);
  const volatility = Math.sqrt(variance) * 100;

  return {
    mdd:        parseFloat((maxDrawdown * 100).toFixed(2)), // 음수(%)
    volatility: parseFloat(volatility.toFixed(2)),          // 일별 표준편차(%)
  };
}

export interface SurgeHistoryResult {
  hasMatches: boolean;
  threshold: number;
  matches: {
    date: string;
    changeRate: number;
    afterReturns: { d3?: number; d5?: number; d10?: number };
  }[];
}

// 일별 차트(최근 최대 100거래일, 오늘 포함 마지막 행) → 오늘과 비슷한 규모의 과거 급등/급락 이력과
// 그 이후 N일 수익률 — 판단 없이 관측된 수치만 산출
export function computeSurgeHistory(chart: ChartDataPoint[]): SurgeHistoryResult | null {
  const closes = chart.map((d) => d.close).filter((c) => c > 0);
  if (closes.length < 2) return null;

  const dailyChangeRate: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    dailyChangeRate[i] = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
  }

  const todayIdx = closes.length - 1;
  const todayChangeRate = dailyChangeRate[todayIdx];
  if (todayChangeRate === undefined) return null;

  const threshold = Math.min(Math.max(15, Math.abs(todayChangeRate) * 0.6), 25);

  const matches: SurgeHistoryResult['matches'] = [];
  for (let i = 1; i < todayIdx; i++) {
    if (Math.abs(dailyChangeRate[i]) < threshold) continue;

    const afterReturns: { d3?: number; d5?: number; d10?: number } = {};
    for (const [key, n] of [['d3', 3], ['d5', 5], ['d10', 10]] as const) {
      const target = i + n;
      if (target < closes.length) {
        afterReturns[key] = parseFloat((((closes[target] - closes[i]) / closes[i]) * 100).toFixed(2));
      }
    }

    matches.push({
      date: chart[i].date,
      changeRate: parseFloat(dailyChangeRate[i].toFixed(2)),
      afterReturns,
    });
  }

  return {
    hasMatches: matches.length > 0,
    threshold: parseFloat(threshold.toFixed(2)),
    matches,
  };
}

export interface TradingValueMultipleResult {
  valid: boolean;
  todayValue: number;
  avg20d: number;
  multiple: number;
}

// 일별 차트(오늘 포함 마지막 행) → 오늘 거래대금이 최근 20거래일 평균 대비 몇 배인지 — 순수 계산
export function computeTradingValueMultiple(chart: ChartDataPoint[]): TradingValueMultipleResult | null {
  if (chart.length < 21) return { valid: false, todayValue: 0, avg20d: 0, multiple: 0 };

  const todayValue = chart[chart.length - 1].tradingValue;
  const prior20 = chart.slice(chart.length - 21, chart.length - 1)
    .map((d) => d.tradingValue)
    .filter((v): v is number => typeof v === 'number' && v > 0);

  if (!todayValue || prior20.length < 20) return { valid: false, todayValue: 0, avg20d: 0, multiple: 0 };

  const avg20d = prior20.reduce((s, v) => s + v, 0) / prior20.length;
  if (avg20d <= 0) return { valid: false, todayValue: 0, avg20d: 0, multiple: 0 };

  return {
    valid: true,
    todayValue,
    avg20d: Math.round(avg20d),
    multiple: parseFloat((todayValue / avg20d).toFixed(2)),
  };
}

export function buildSurgeHistoryBlock(s: SurgeHistoryResult | null): string {
  if (!s) return '데이터 없음';
  if (!s.hasMatches) {
    return `최근 약 5개월 내 오늘과 비슷한 규모(등락률 ${s.threshold}% 이상)의 급등/급락 이력 없음`;
  }
  return s.matches.map((m) => {
    const parts: string[] = [];
    if (m.afterReturns.d3 !== undefined)  parts.push(`3일 후 ${m.afterReturns.d3 >= 0 ? '+' : ''}${m.afterReturns.d3}%`);
    if (m.afterReturns.d5 !== undefined)  parts.push(`5일 후 ${m.afterReturns.d5 >= 0 ? '+' : ''}${m.afterReturns.d5}%`);
    if (m.afterReturns.d10 !== undefined) parts.push(`10일 후 ${m.afterReturns.d10 >= 0 ? '+' : ''}${m.afterReturns.d10}%`);
    const afterText = parts.length ? parts.join(', ') : '이후 데이터 부족';
    return `- ${m.date}: ${m.changeRate >= 0 ? '+' : ''}${m.changeRate}% 변동 → ${afterText}`;
  }).join('\n');
}

export function buildTradingValueBlock(t: TradingValueMultipleResult | null): string {
  if (!t || !t.valid) return '데이터 없음';
  return `오늘 거래대금은 최근 20거래일 평균 대비 ${t.multiple}배`;
}
