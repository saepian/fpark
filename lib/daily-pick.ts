import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, fetchStockPrice, STOCK_NAMES, CURATED_TICKERS_MKT } from '@/lib/kis-api';
import { fetchInvestorTrend } from '@/lib/stock-analysis-data';
import { COMPLIANCE_PRINCIPLE } from '@/lib/ai-compliance';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

// "대량 순매수"로 볼 단일 거래일 순매수 금액 기준 (억원)
const LARGE_NET_BUY_THRESHOLD_AUK = 100;

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

// ── 수급 스크리닝 ─────────────────────────────────────────────────────────────

interface FlowCandidate {
  ticker: string;
  name: string;
  foreignNetBuyAuk: number;          // 최근 거래일 외국인 순매수(억원)
  institutionNetBuyAuk: number;      // 최근 거래일 기관 순매수(억원)
  foreignCumulative5dAuk: number;    // 최근 5거래일 누적 외국인 순매수(억원)
  institutionCumulative5dAuk: number;
  foreignConsecutiveDays: number;    // 외국인 연속 순매수 일수(최대 5)
  institutionConsecutiveDays: number;
}

function countConsecutivePositive(amounts: number[]): number {
  let count = 0;
  for (const a of amounts) {
    if (a > 0) count++;
    else break;
  }
  return count;
}

function classifyPickReason(c: FlowCandidate): string | null {
  const bigForeign     = c.foreignNetBuyAuk >= LARGE_NET_BUY_THRESHOLD_AUK;
  const bigInstitution = c.institutionNetBuyAuk >= LARGE_NET_BUY_THRESHOLD_AUK;
  const streak5Foreign     = c.foreignConsecutiveDays >= 5;
  const streak5Institution = c.institutionConsecutiveDays >= 5;

  if ((bigForeign || streak5Foreign) && (bigInstitution || streak5Institution)) return '외국인·기관 동반 자금 유입';
  if (streak5Foreign) return '외국인 5일 연속 자금 유입';
  if (streak5Institution) return '기관 5일 연속 자금 유입';
  if (bigForeign) return '외국인 대량 자금 유입';
  if (bigInstitution) return '기관 대량 자금 유입';
  return null;
}

// 후보 유니버스(대형·중형주 약 90종목)를 순회하며 외국인·기관 수급 데이터 조회
async function scanFlowCandidates(): Promise<FlowCandidate[]> {
  const tickers = CURATED_TICKERS_MKT.map(([t]) => t);
  const results: FlowCandidate[] = [];

  for (let i = 0; i < tickers.length; i += 5) {
    const chunk = tickers.slice(i, i + 5);
    const settled = await Promise.allSettled(
      chunk.map(async (ticker): Promise<FlowCandidate | null> => {
        const { latest, trend } = await fetchInvestorTrend(ticker);
        if (!latest || trend.length === 0) return null;

        return {
          ticker,
          name: STOCK_NAMES[ticker] ?? ticker,
          foreignNetBuyAuk:     latest.foreign.amount,
          institutionNetBuyAuk: latest.institution.amount,
          foreignCumulative5dAuk:     trend.reduce((s, d) => s + d.foreign, 0),
          institutionCumulative5dAuk: trend.reduce((s, d) => s + d.institution, 0),
          foreignConsecutiveDays:     countConsecutivePositive(trend.map((d) => d.foreign)),
          institutionConsecutiveDays: countConsecutivePositive(trend.map((d) => d.institution)),
        };
      }),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
    if (i + 5 < tickers.length) await new Promise((r) => setTimeout(r, 200));
  }

  return results;
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

  // 1. 외국인·기관 수급 기준 스크리닝
  console.log('[DAILY-PICK] 수급 스크리닝 시작');
  const candidates = await scanFlowCandidates();
  console.log(`[DAILY-PICK] 스크리닝 완료 — ${candidates.length}/${CURATED_TICKERS_MKT.length}개 종목 조회`);

  const classified = candidates
    .map((c) => ({ ...c, reason: classifyPickReason(c) }))
    .filter((c): c is FlowCandidate & { reason: string } => c.reason !== null);

  console.log(
    `[DAILY-PICK] 조건 충족: ${classified.length}건 — ` +
    classified.map((c) => `${c.name}(${c.reason})`).join(', '),
  );

  // 조건을 충족하는 종목이 없으면 선정하지 않음 (가짜 사유로 억지 선정하지 않음)
  if (classified.length === 0) {
    console.log('[DAILY-PICK] 오늘 수급 조건 충족 종목 없음 — 선정 생략');
    return null;
  }

  // 우선순위: 동반 자금 유입 > 순매수 규모(외국인+기관 합산)
  classified.sort((a, b) => {
    const aBonus = a.reason === '외국인·기관 동반 자금 유입' ? 100000 : 0;
    const bBonus = b.reason === '외국인·기관 동반 자금 유입' ? 100000 : 0;
    const aScore = aBonus + a.foreignNetBuyAuk + a.institutionNetBuyAuk;
    const bScore = bBonus + b.foreignNetBuyAuk + b.institutionNetBuyAuk;
    return bScore - aScore;
  });
  const selected = classified[0];
  console.log(`[DAILY-PICK] 선정: ${selected.name}(${selected.ticker}) — ${selected.reason}`);

  const token = await getAccessToken();
  const detail = await fetchStockDetail(selected.ticker, token);
  const priceInfo = await fetchStockPrice(selected.ticker).catch(() => null);
  const currentPrice = priceInfo?.price ?? detail?.currentPrice ?? 0;
  const changeRate   = priceInfo?.changeRate ?? detail?.changeRate ?? 0;

  // 2. 참고용 뉴스 (수급이 핵심, 뉴스는 보조 정보)
  const { data: news } = await supabase
    .from('articles')
    .select('title, summary, published_at, source')
    .ilike('title', `%${selected.name}%`)
    .order('published_at', { ascending: false })
    .limit(5);

  const newsText = (news ?? []).length > 0
    ? (news ?? []).map((n, i) =>
        `${i + 1}. [${n.source}] ${n.title}\n   요약: ${n.summary || '없음'}\n   날짜: ${new Date(n.published_at).toLocaleDateString('ko-KR')}`
      ).join('\n\n')
    : '관련 뉴스 없음';

  // 3. Claude로 수급 데이터 관찰 서술 생성 (뉴스는 참고 정보로만 보조 배치)
  const prompt = `아래는 정량적 수급 기준(외국인·기관 자금 유입)으로 스크리닝된 종목입니다. 이 데이터를 관찰된 사실 위주로 정리하고 JSON만 출력하세요.

## 종목 정보
- 종목명: ${selected.name} (${selected.ticker})
- 현재가: ${currentPrice.toLocaleString()}원 (오늘 등락률 ${changeRate}%)
- 선정 사유: ${selected.reason}
- 전일 외국인 자금 유입: ${selected.foreignNetBuyAuk}억원 / 최근 5거래일 누적: ${selected.foreignCumulative5dAuk}억원 (연속 ${selected.foreignConsecutiveDays}일 유입)
- 전일 기관 자금 유입: ${selected.institutionNetBuyAuk}억원 / 최근 5거래일 누적: ${selected.institutionCumulative5dAuk}억원 (연속 ${selected.institutionConsecutiveDays}일 유입)
- 52주 최고가: ${detail?.week52High?.toLocaleString() ?? '-'}원 / 최저가: ${detail?.week52Low?.toLocaleString() ?? '-'}원
- 시가총액: ${detail?.marketCap ?? '-'} | PER: ${detail?.per ?? '-'}배 | PBR: ${detail?.pbr ?? '-'}배

## 참고 뉴스 (보조 정보, ${(news ?? []).length}건)
${newsText}

## 출력 형식 (JSON만)
{
  "summary": "수급 데이터 관찰 한줄 요약, 구체적 수치 포함 (예: '외국인 5거래일 연속 자금 유입, 누적 320억원 유입이 관찰됨') — 50자 이내, 지시형 표현 금지",
  "analysis": "수급 데이터를 중심으로 한 관찰 서술 (3-4문장). 뉴스는 참고 정보로만 보조적으로 언급",
  "reference_info": ["뉴스·실적 등 참고 정보 1-3개 (보조적 위치, 없으면 빈 배열)"],
  "risks": ["리스크 요인 1-2개"],
  "keywords": ["3~4개 핵심 키워드"]
}

규칙:
- ${COMPLIANCE_PRINCIPLE}
- summary·analysis는 수급 수치가 핵심 근거이며, 뉴스·실적은 참고 정보로만 보조적으로 다루세요
- "재도약 기대", "매력도를 높이는 핵심 요인", "권고", "정당화" 같은 결론형·권유형 표현을 쓰지 말고 "~관찰됩니다", "~라는 특징이 있습니다", "~라는 해석도 있습니다" 형태로 작성하세요
- 목표가·저항선·진입전략 관련 내용은 만들지 마세요 (52주 고점 대비 위치는 별도로 표시됩니다)
- summary·analysis·keywords 전부에서 "매수"/"매도"/"순매수"/"순매도" 단어를 쓰지 말고 "자금 유입"/"자금 유출"로 표현하세요 (예: "순매수 572억원" → "자금 유입 572억원", "순유출 상태" → "자금 유출 상태")
- JSON 키 순서 및 구조 변경 금지`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  let analysisResult: any = {
    summary: `${selected.name} — ${selected.reason} 관찰됨`,
    analysis: '수급 데이터 기반 관찰 정보를 준비 중입니다.',
    reference_info: [],
    risks: ['시장 변동성'],
    keywords: [selected.name],
  };

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: COMPLIANCE_PRINCIPLE,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) analysisResult = JSON.parse(match[0]);
  } catch (e) {
    console.error('[DAILY-PICK] Claude 분석 실패:', e);
  }

  // 4. DB 저장 — 실제 선정 사유(수치)를 그대로 기록
  const { error } = await supabase.from('daily_picks').upsert({
    ticker: selected.ticker,
    name: selected.name,
    date: today,
    analysis: analysisResult.analysis,
    summary: analysisResult.summary,
    catalysts: analysisResult.reference_info ?? [], // 참고 정보 (뉴스/실적 등, 보조적)
    risks: analysisResult.risks,
    keywords: analysisResult.keywords,
    target_price: null, // 목표가 개념 제거
    pick_reason: selected.reason,
    foreign_net_buy_auk: selected.foreignNetBuyAuk,
    institution_net_buy_auk: selected.institutionNetBuyAuk,
    foreign_consecutive_days: selected.foreignConsecutiveDays,
    institution_consecutive_days: selected.institutionConsecutiveDays,
    week52_high: detail?.week52High ?? null,
    week52_low: detail?.week52Low ?? null,
    news_used: news ?? [],
    price_at_pick: currentPrice,
  }, { onConflict: 'date' });

  if (error) {
    console.error('[DAILY-PICK] DB 저장 실패:', error);
    return null;
  }

  console.log(`[DAILY-PICK] 완료: ${selected.name} (${selected.ticker}) — ${selected.reason}`);
  return { ticker: selected.ticker, name: selected.name };
}
