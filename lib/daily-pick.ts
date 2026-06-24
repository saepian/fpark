import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, fetchFluctuation, STOCK_NAMES } from '@/lib/kis-api';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

export function getDailyPickSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function kisHeaders(token: string, trId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
  };
}

async function fetchDailyPrices(ticker: string, token: string, days = 3) {
  for (const mktCode of ['J', 'Q']) {
    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
    url.searchParams.set('FID_INPUT_ISCD', ticker);
    url.searchParams.set('FID_PERIOD_DIV_CODE', 'D');
    url.searchParams.set('FID_ORG_ADJ_PRC', '0');
    try {
      const res = await fetch(url.toString(), {
        headers: kisHeaders(token, 'FHKST01010400'),
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.rt_cd !== '0' || !Array.isArray(data.output) || data.output.length === 0) continue;
      return data.output.slice(0, days).map((d: any) => ({
        changeRate: Number(d.prdy_ctrt),
      }));
    } catch { continue; }
  }
  return [];
}

async function fetchStockDetail(ticker: string, token: string) {
  for (const mktCode of ['J', 'Q']) {
    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
    url.searchParams.set('FID_INPUT_ISCD', ticker);
    try {
      const res = await fetch(url.toString(), {
        headers: kisHeaders(token, 'FHKST01010100'),
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.rt_cd !== '0') continue;
      const o = data.output;
      return {
        currentPrice: Number(o.stck_prpr),
        changeRate: parseFloat(o.prdy_ctrt) || 0,
        week52High: Number(o.w52_hgpr),
        week52Low: Number(o.w52_lwpr),
        marketCap: o.hts_avls ? `${Math.round(Number(o.hts_avls) / 100_000_000)}억` : '-',
        per: parseFloat(o.per) || 0,
        pbr: parseFloat(o.pbr) || 0,
      };
    } catch { continue; }
  }
  return null;
}

export async function generateAndSavePick(): Promise<{ ticker: string; name: string } | null> {
  const supabase = getDailyPickSupabase();
  const today = new Date().toISOString().split('T')[0];

  // 이미 선정된 종목 있으면 스킵
  const { data: existing, error: existErr } = await supabase
    .from('daily_picks')
    .select('ticker, name')
    .eq('date', today)
    .maybeSingle();
  if (existErr && (existErr.code === 'PGRST205' || existErr.message?.includes('daily_picks'))) {
    console.error('[DAILY-PICK] daily_picks 테이블이 없습니다. Supabase SQL Editor에서 생성해주세요.');
    throw new Error('daily_picks 테이블 없음');
  }
  if (existing) return existing;

  const token = await getAccessToken();

  // 1. KIS 급등 종목 top 30 조회 (장중) 또는 큐레이티드 목록 폴백 (장 마감)
  let movers: { ticker: string; name: string; price: number; changeRate: number }[] = [];
  try {
    const raw = await fetchFluctuation('up', 30);
    movers = raw
      .filter((m) => m.price > 0 && m.name)
      .map((m) => ({ ticker: m.ticker, name: m.name, price: m.price, changeRate: m.changeRate }));
  } catch (e) {
    console.error('[DAILY-PICK] 급등 종목 조회 실패:', e);
  }

  // 장 마감 후 급등 데이터 없으면 큐레이티드 종목에서 현재가 조회하여 선정
  if (movers.length === 0) {
    console.log('[DAILY-PICK] 급등 목록 없음 — 큐레이티드 종목 폴백');
    const FALLBACK_TICKERS = ['005930', '000660', '005380', '035420', '207940', '068270', '005490', '012330'];
    const fallbackResults = await Promise.allSettled(
      FALLBACK_TICKERS.map(async (ticker) => {
        const detail = await fetchStockDetail(ticker, token);
        if (!detail || !detail.currentPrice) return null;
        return {
          ticker,
          name: STOCK_NAMES[ticker] ?? ticker,
          price: detail.currentPrice,
          changeRate: detail.changeRate,
        };
      })
    );
    movers = fallbackResults
      .filter((r): r is PromiseFulfilledResult<NonNullable<typeof movers[number]>> =>
        r.status === 'fulfilled' && r.value !== null
      )
      .map((r) => r.value);
  }

  if (movers.length === 0) return null;

  // 2. 각 후보 3일 연속 상승 확인
  const candidates: typeof movers[number][] = [];
  for (const mover of movers.slice(0, 20)) {
    try {
      const days = await fetchDailyPrices(mover.ticker, token);
      if (days.length >= 3 && days.every((d) => d.changeRate > 0)) {
        candidates.push(mover);
      }
    } catch { /* skip */ }
    await new Promise((r) => setTimeout(r, 120));
  }

  const pool = candidates.length > 0 ? candidates : movers.slice(0, 3);

  // 3. 관련 뉴스가 있는 종목 우선 선정
  let selected = pool[0];
  for (const candidate of pool) {
    const { data: news } = await supabase
      .from('articles')
      .select('id')
      .ilike('title', `%${candidate.name}%`)
      .limit(1);
    if ((news?.length ?? 0) > 0) { selected = candidate; break; }
  }

  // 4. 관련 뉴스 최신 5건
  const { data: news } = await supabase
    .from('articles')
    .select('title, summary, published_at, source')
    .ilike('title', `%${selected.name}%`)
    .order('published_at', { ascending: false })
    .limit(5);

  // 5. 종목 상세 정보
  const detail = await fetchStockDetail(selected.ticker, token);

  // 6. Claude 심층 분석
  const newsText = (news ?? []).length > 0
    ? (news ?? []).map((n, i) =>
        `${i + 1}. [${n.source}] ${n.title}\n   요약: ${n.summary || '없음'}\n   날짜: ${new Date(n.published_at).toLocaleDateString('ko-KR')}`
      ).join('\n\n')
    : '관련 뉴스 없음';

  const prompt = `당신은 국내 최고의 주식 애널리스트입니다. ${selected.name}(${selected.ticker})에 대한 심층 분석을 작성해주세요.

## 종목 정보
- 종목명: ${selected.name} (${selected.ticker})
- 현재가: ${selected.price.toLocaleString()}원
- 오늘 등락률: +${selected.changeRate}%
- 최근 3거래일: 상승 모멘텀
- 52주 최고가: ${detail?.week52High?.toLocaleString() ?? '-'}원 / 최저가: ${detail?.week52Low?.toLocaleString() ?? '-'}원
- 시가총액: ${detail?.marketCap ?? '-'} | PER: ${detail?.per ?? '-'}배 | PBR: ${detail?.pbr ?? '-'}배

## 관련 뉴스 (${(news ?? []).length}건)
${newsText}

아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요.

{
  "summary": "한 줄 핵심 투자 포인트 (50자 이내)",
  "analysis": "뉴스와 주가 흐름을 연결한 상세 분석 (4-5문장)",
  "catalysts": ["상승 촉매 1", "상승 촉매 2", "상승 촉매 3"],
  "risks": ["리스크 요인 1", "리스크 요인 2"],
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4"],
  "sentiment": "bullish",
  "targetPrice": "단기 목표가 (예: 83,000원)"
}`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  let analysisResult: any = {
    summary: `${selected.name} 오늘 상승 모멘텀 지속`,
    analysis: '현재 분석 데이터를 준비 중입니다.',
    catalysts: ['상승 모멘텀 지속'],
    risks: ['시장 변동성'],
    keywords: [selected.name],
    sentiment: 'bullish',
    targetPrice: '-',
  };

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) analysisResult = JSON.parse(match[0]);
  } catch (e) {
    console.error('[DAILY-PICK] Claude 분석 실패:', e);
  }

  // 7. DB 저장
  const { error } = await supabase.from('daily_picks').upsert({
    ticker: selected.ticker,
    name: selected.name,
    date: today,
    analysis: analysisResult.analysis,
    summary: analysisResult.summary,
    catalysts: analysisResult.catalysts,
    risks: analysisResult.risks,
    keywords: analysisResult.keywords,
    sentiment: analysisResult.sentiment,
    target_price: analysisResult.targetPrice,
    news_used: news ?? [],
    price_at_pick: selected.price,
  }, { onConflict: 'date' });

  if (error) {
    console.error('[DAILY-PICK] DB 저장 실패:', error);
    return null;
  }

  console.log(`[DAILY-PICK] 완료: ${selected.name} (${selected.ticker})`);
  return { ticker: selected.ticker, name: selected.name };
}
