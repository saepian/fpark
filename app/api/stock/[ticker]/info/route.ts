import { NextRequest, NextResponse, after } from 'next/server';
import { fetchStockInfo } from '../../../../../lib/kis-api';
import { supabase } from '../../../../../lib/supabase';
import type { StockInfo } from '../../../../../lib/types';

export const dynamic = 'force-dynamic';

const cacheKey = (ticker: string) => `stock_info_${ticker}`;

async function loadCache(ticker: string): Promise<{ data: StockInfo; updatedAt: string } | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', cacheKey(ticker))
      .single();
    if (!cache?.data) return null;
    return { data: cache.data as StockInfo, updatedAt: cache.updated_at };
  } catch {
    return null;
  }
}

// await 없이 던지면 응답 직후 실행 컨텍스트가 얼어붙어 fetch가 중간에 끊길 수 있어
// after()로 등록 — 응답은 즉시 나가되 이 저장은 런타임이 끝까지 살려서 완료시킨다.
function saveCache(ticker: string, data: StockInfo) {
  after(async () => {
    const { error } = await supabase
      .from('market_cache')
      .upsert({ key: cacheKey(ticker), data, updated_at: new Date().toISOString() });
    if (error) console.warn(`[INFO] ${ticker} 캐시 저장 실패:`, error.message);
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await fetchStockInfo(ticker);
      saveCache(ticker, data);
      return NextResponse.json({ ...data, isCached: false });
    } catch (e) {
      lastErr = e;
      console.warn(`[INFO] ${ticker} 조회 ${attempt + 1}차 시도 실패:`, e instanceof Error ? e.message : e);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : '알 수 없는 오류';

  // 재시도까지 실패 — 캐시된 최근 데이터로 대체 (사용자 화면 공백 방지)
  const cached = await loadCache(ticker);
  if (cached) {
    console.error(`[INFO] ${ticker} 조회 최종 실패, 캐시로 대체 반환:`, message);
    return NextResponse.json({ ...cached.data, isCached: true, cachedAt: cached.updatedAt });
  }

  console.error(`[INFO] ${ticker} 조회 최종 실패, 캐시도 없음:`, message);
  return NextResponse.json({ error: message }, { status: 500 });
}
