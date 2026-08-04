import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { ChartDataPoint } from './types';

// 기업분석 "환율 상관관계" 카드용 — 종목의 최근 1년 일별 수익률과 원/달러 환율의 같은
// 기간 일별 수익률 사이 피어슨 상관계수를 계산한다. 환율 1년 시계열은 종목과 무관하게
// 모든 요청에서 완전히 동일하므로, 종목별이 아니라 이 값 하나를 공유 캐시 키로 저장한다
// (market_cache, 티커 무관 공유 키 — news-selection.ts/sector-news.ts와 같은 테이블·패턴
// 재사용, TTL만 다름).
const USDKRW_CACHE_KEY = 'usdkrw_1y_daily';
const USDKRW_TTL_MS = 12 * 60 * 60 * 1000; // 12시간 — 환율 시계열은 하루 몇 번씩 새로 받을 필요 없음
const MIN_SAMPLE_SIZE = 30;   // 이보다 교집합 표본이 적으면 상관계수를 신뢰하기 어려워 null
const WEAK_CORRELATION = 0.3; // |r| < 0.3이면 "약한 상관"으로 판단해 카드 자체 생략(호출부 책임)

let _sb: ReturnType<typeof createClient<Database>> | null = null;
function getSb() {
  if (!_sb) _sb = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return _sb;
}

export interface FxDailyPoint {
  date: string; // "YYYY-MM-DD"
  close: number;
}

async function loadFromCache(): Promise<FxDailyPoint[] | null> {
  try {
    const { data } = await getSb()
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', USDKRW_CACHE_KEY)
      .single();
    if (data?.data && Date.now() - new Date(data.updated_at as string).getTime() < USDKRW_TTL_MS) {
      return data.data as unknown as FxDailyPoint[];
    }
  } catch (e) {
    console.warn('[FX-CORRELATION] USD/KRW 캐시 조회 실패, 새로 조회:', e instanceof Error ? e.message : e);
  }
  return null;
}

async function saveToCache(points: FxDailyPoint[]): Promise<void> {
  try {
    await getSb().from('market_cache').upsert({
      key: USDKRW_CACHE_KEY,
      data: points as unknown as Database['public']['Tables']['market_cache']['Row']['data'],
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[FX-CORRELATION] USD/KRW 캐시 저장 실패(계속 진행):', e instanceof Error ? e.message : e);
  }
}

// USD/KRW 1년 일별 종가 — /api/market이 이미 쓰는 Yahoo Finance 소스 재사용(range만 1y로
// 확장). 티커 무관 공유 캐시라 diagnosis 요청이 몇 번이 오든 TTL당 실제 조회는 1회.
export async function fetchUsdKrwDaily1Y(): Promise<FxDailyPoint[]> {
  const cached = await loadFromCache();
  if (cached) return cached;

  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=1y';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fpark/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    const data = await res.json();
    const result = data.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];

    const points: FxDailyPoint[] = [];
    timestamps.forEach((t, i) => {
      const c = closes[i];
      if (c != null && isFinite(c)) {
        points.push({ date: new Date(t * 1000).toISOString().slice(0, 10), close: c });
      }
    });

    if (points.length > 0) await saveToCache(points);
    return points;
  } catch (e) {
    console.warn('[FX-CORRELATION] USD/KRW 조회 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

// 일별 종가 배열 → {날짜: 전일 대비 수익률} 맵. computeRiskMetrics(lib/stock-analysis-data.ts)와
// 같은 "종가 레벨이 아니라 일별 %변화율" 원칙 — 두 시계열 다 장기 추세가 있어 레벨끼리
// 상관계수를 내면 실제 일별 관계와 무관하게 허위로 높게 나올 수 있다(spurious correlation).
function toDailyReturns(points: { date: string; close: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].close;
    if (prev <= 0) continue;
    map.set(points[i].date, (points[i].close - prev) / prev);
  }
  return map;
}

// type(aliases)으로 선언 — interface는 암묵적 index signature가 없어 Json(Supabase) 타입에
// 대입 시 "Index signature for type 'string' is missing" 에러가 난다(AnnualFinancialRow·
// DartDisclosure 등 이 프로젝트의 다른 Json 저장 대상 타입들도 전부 이 이유로 interface 대신
// type을 씀 — 같은 관례 재사용).
export type FxCorrelationResult = {
  correlation: number; // -1~1, 소수 둘째 자리
  sampleSize: number;  // 상관계수 계산에 실제로 쓰인 날짜 교집합 개수
};

// 종목 일별 수익률 vs 환율 일별 수익률의 피어슨 상관계수. 날짜 교집합(inner join)만
// 사용하고, 표본이 MIN_SAMPLE_SIZE보다 적으면 신뢰할 수 없다고 보고 null. |r|이
// WEAK_CORRELATION(0.3) 미만인 "약한 상관"도 여기서는 그대로 반환하며(계산 자체는
// 유효한 결과), UI에 보여줄지 여부는 호출부가 이 임계값으로 판단한다.
export function computeFxCorrelation(
  stockChart: ChartDataPoint[],
  fxDaily: FxDailyPoint[],
): FxCorrelationResult | null {
  const stockReturns = toDailyReturns(stockChart);
  const fxReturns    = toDailyReturns(fxDaily);

  const matched: { stock: number; fx: number }[] = [];
  for (const [date, stockRet] of stockReturns) {
    const fxRet = fxReturns.get(date);
    if (fxRet !== undefined) matched.push({ stock: stockRet, fx: fxRet });
  }

  if (matched.length < MIN_SAMPLE_SIZE) return null;

  const n = matched.length;
  const meanStock = matched.reduce((s, m) => s + m.stock, 0) / n;
  const meanFx    = matched.reduce((s, m) => s + m.fx, 0) / n;

  let cov = 0, varStock = 0, varFx = 0;
  for (const m of matched) {
    const ds = m.stock - meanStock;
    const df = m.fx - meanFx;
    cov += ds * df;
    varStock += ds * ds;
    varFx += df * df;
  }
  if (varStock === 0 || varFx === 0) return null;

  const r = cov / Math.sqrt(varStock * varFx);
  return { correlation: parseFloat(r.toFixed(2)), sampleSize: n };
}

export function isFxCorrelationMeaningful(r: FxCorrelationResult | null): r is FxCorrelationResult {
  return r !== null && Math.abs(r.correlation) >= WEAK_CORRELATION;
}
