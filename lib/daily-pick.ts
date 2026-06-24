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

type Mover = { ticker: string; name: string; price: number; changeRate: number };

const FALLBACK_TICKERS = [
  '005930', // 삼성전자
  '000660', // SK하이닉스
  '035420', // NAVER
  '035720', // 카카오
  '005380', // 현대차
  '068270', // 셀트리온
  '051910', // LG화학
  '006400', // 삼성SDI
  '373220', // LG에너지솔루션
  '207940', // 삼성바이오로직스
  '003550', // LG
  '096770', // SK이노베이션
  '034730', // SK
  '028260', // 삼성물산
  '066570', // LG전자
];

async function hasNews(supabase: ReturnType<typeof getDailyPickSupabase>, name: string): Promise<boolean> {
  const { data } = await supabase
    .from('articles')
    .select('id')
    .ilike('title', `%${name}%`)
    .limit(1);
  return (data?.length ?? 0) > 0;
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
    console.error('[DAILY-PICK] daily_picks 테이블이 없습니다.');
    throw new Error('daily_picks 테이블 없음');
  }
  if (existing) return existing;

  const token = await getAccessToken();

  // 오늘 급등 종목 조회
  let movers: Mover[] = [];
  try {
    const raw = await fetchFluctuation('up', 30);
    movers = raw
      .filter((m) => m.price > 0 && m.name)
      .map((m) => ({ ticker: m.ticker, name: m.name, price: m.price, changeRate: m.changeRate }));
  } catch (e) {
    console.error('[DAILY-PICK] 급등 종목 조회 실패:', e);
  }

  // 3일 연속 상승 종목 확인
  const risingCandidates: Mover[] = [];
  for (const mover of movers.slice(0, 20)) {
    try {
      const days = await fetchDailyPrices(mover.ticker, token);
      if (days.length >= 3 && days.every((d) => d.changeRate > 0)) {
        risingCandidates.push(mover);
      }
    } catch { /* skip */ }
    await new Promise((r) => setTimeout(r, 120));
  }

  // 5순위 폴백용: 최근 7일 선정 종목 조회
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data: recentPicksData } = await supabase
    .from('daily_picks')
    .select('ticker')
    .gte('date', sevenDaysAgo);
  const recentTickers = recentPicksData?.map((p) => p.ticker) ?? [];

  // 우선순위별 종목 선정
  let selected: Mover | null = null;

  // 1순위: 3일 연속 상승 + 뉴스
  for (const c of risingCandidates) {
    if (await hasNews(supabase, c.name)) {
      selected = c;
      console.log(`[DAILY-PICK] 1순위 선정 (3일상승+뉴스): ${c.name}`);
      break;
    }
  }

  // 2순위: 3일 연속 상승 (뉴스 없어도)
  if (!selected && risingCandidates.length > 0) {
    selected = risingCandidates[0];
    console.log(`[DAILY-PICK] 2순위 선정 (3일상승): ${selected.name}`);
  }

  // 3순위: 오늘 급등 종목 중 뉴스 있는 종목
  if (!selected) {
    for (const m of movers.slice(0, 10)) {
      if (await hasNews(supabase, m.name)) {
        selected = m;
        console.log(`[DAILY-PICK] 3순위 선정 (급등+뉴스): ${m.name}`);
        break;
      }
    }
  }

  // 4순위: 오늘 급등 종목 상위 (뉴스 없어도)
  if (!selected && movers.length > 0) {
    selected = movers[0];
    console.log(`[DAILY-PICK] 4순위 선정 (급등): ${selected.name}`);
  }

  // 5순위: FALLBACK_TICKERS에서 최근 7일 미선정 종목 랜덤
  if (!selected) {
    const available = FALLBACK_TICKERS.filter((t) => !recentTickers.includes(t));
    const pool = available.length > 0 ? available : FALLBACK_TICKERS;
    const randomTicker = pool[Math.floor(Math.random() * pool.length)];
    const detail = await fetchStockDetail(randomTicker, token);
    selected = {
      ticker: randomTicker,
      name: STOCK_NAMES[randomTicker] ?? randomTicker,
      price: detail?.currentPrice ?? 0,
      changeRate: detail?.changeRate ?? 0,
    };
    console.log(`[DAILY-PICK] 5순위 선정 (랜덤폴백): ${selected.name}`);
  }

  if (!selected) return null;

  // 관련 뉴스 최신 5건
  const { data: news } = await supabase
    .from('articles')
    .select('title, summary, published_at, source')
    .ilike('title', `%${selected.name}%`)
    .order('published_at', { ascending: false })
    .limit(5);

  // 종목 상세 정보
  const detail = await fetchStockDetail(selected.ticker, token);

  // Claude 심층 분석
  const newsText = (news ?? []).length > 0
    ? (news ?? []).map((n, i) =>
        `${i + 1}. [${n.source}] ${n.title}\n   요약: ${n.summary || '없음'}\n   날짜: ${new Date(n.published_at).toLocaleDateString('ko-KR')}`
      ).join('\n\n')
    : '관련 뉴스 없음';

  const prompt = `당신은 국내 최고의 주식 애널리스트입니다. ${selected.name}(${selected.ticker})에 대한 심층 분석을 작성해주세요.

## 종목 정보
- 종목명: ${selected.name} (${selected.ticker})
- 현재가: ${selected.price.toLocaleString()}원
- 오늘 등락률: ${selected.changeRate}%
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
    summary: `${selected.name} 주목`,
    analysis: '현재 분석 데이터를 준비 중입니다.',
    catalysts: ['모멘텀 지속'],
    risks: ['시장 변동성'],
    keywords: [selected.name],
    sentiment: 'neutral',
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

  // DB 저장
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
