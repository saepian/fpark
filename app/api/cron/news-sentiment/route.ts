import { NextRequest, NextResponse } from 'next/server';
import { adminClient as supabase } from '@/lib/supabase-admin';
import { CURATED_TICKERS_MKT, STOCK_NAMES, fetchStockPrice } from '@/lib/kis-api';
import { selectRelevantNews } from '@/lib/news-selection';
import { classifyNewsSentiment, computeSentimentScore } from '@/lib/news-sentiment';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// 2026-09-03: 뉴스 논조 추이 기능 완전 정지. SHOW_NEWS_SENTIMENT_CARD/SHOW_SECTOR_SENTIMENT_CARD가
// 이미 false라 카드는 안 보이는데 크론은 계속 KIS/Naver 호출 + DB upsert를 하고 있었다.
// vercel.json에서 스케줄은 뺐지만, 수동 트리거나 향후 스케줄 재등록 실수에도 이 가드가 막는다.
// 재개하려면: 아래 값을 false로 바꾸고 vercel.json의 crons 배열에 스케줄을 다시 추가할 것
// (git log에서 "news-sentiment" 관련 커밋 참고).
const NEWS_SENTIMENT_CRON_DISABLED = true;

// 2026-08-04 실측: fetchCuratedMovers(KIS 전용) 전례를 따라 10개씩 배치로 처음 돌렸더니
// 종목당 Naver 검색이 2회(이름+코드)라 배치당 동시 요청이 20건까지 몰려 Naver 뉴스 검색
// API가 HTTP 429를 대량 반환(100건 중 41건이 apiError로 빈 결과)했다 — KIS와 Naver의
// 레이트리밋이 다르다는 걸 실측으로 확인. 배치를 3개(동시 Naver 요청 6건)로 줄이고 간격도
// 넉넉히 둬서 재현 확인(아래 검증 기록 참고).
const BATCH_SIZE = 3;
const BATCH_GAP_MS = 800;

function kstDateStr(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function processTicker(ticker: string, todayStr: string) {
  const name = STOCK_NAMES[ticker] || ticker; // 미매핑 종목(현재 1개)은 코드로 폴백 — selectRelevantNews의 코드 검색은 이름 정확도와 무관하게 동작

  const [priceResult, newsResult] = await Promise.allSettled([
    fetchStockPrice(ticker, { priority: 'cron' }),
    selectRelevantNews(ticker, name),
  ]);

  const sector = priceResult.status === 'fulfilled' ? priceResult.value.sector : null;
  const articles = newsResult.status === 'fulfilled' ? newsResult.value.items : [];

  const counts = await classifyNewsSentiment(ticker, articles);
  const sentimentScore = computeSentimentScore(counts);

  const { error } = await supabase.from('news_sentiment_daily').upsert({
    ticker,
    date: todayStr,
    sector,
    article_count: articles.length,
    positive_count: counts.positive,
    negative_count: counts.negative,
    neutral_count: counts.neutral,
    sentiment_score: sentimentScore,
  }, { onConflict: 'ticker,date' });

  if (error) throw error;

  return { ticker, articleCount: articles.length, sentimentScore };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/news-sentiment] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/news-sentiment] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (NEWS_SENTIMENT_CRON_DISABLED) {
    console.log('[cron/news-sentiment] 정지 상태 — 실행 건너뜀 (재개하려면 NEWS_SENTIMENT_CRON_DISABLED 참고)');
    return NextResponse.json({ ok: true, skipped: true, reason: 'disabled' });
  }

  const todayStr = kstDateStr();
  const tickers = CURATED_TICKERS_MKT.map(([t]) => t);
  const results = { saved: 0, errors: 0, errorTickers: [] as string[] };

  const t0 = Date.now();
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((t) => processTicker(t, todayStr)));
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === 'fulfilled') {
        results.saved++;
      } else {
        results.errors++;
        results.errorTickers.push(batch[j]);
        console.error(`[cron/news-sentiment] ${batch[j]} 처리 실패:`, r.reason);
      }
    }
    if (i + BATCH_SIZE < tickers.length) await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
  }

  const elapsedMs = Date.now() - t0;
  console.log('[cron/news-sentiment] 완료', { date: todayStr, ...results, elapsedMs });

  return NextResponse.json({ ok: true, date: todayStr, ...results, elapsedMs });
}
