-- news_sentiment_daily: 종목별 일별 뉴스 논조(긍정/부정/중립) 누적 — 크론(app/api/cron/news-sentiment)이
-- 매일 CURATED_TICKERS_MKT(100종목)에 대해 채운다. market_cache와 동일하게 서비스 롤(adminClient)로만
-- 쓰고 읽으므로 RLS 없음. 이번 단계는 데이터 적재만 — 기업분석 미니 스파크라인·포트폴리오진단 섹터
-- 집계 UI 노출은 데이터가 어느 정도 쌓인 뒤 별도 단계에서 진행 예정.
CREATE TABLE IF NOT EXISTS public.news_sentiment_daily (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker          TEXT        NOT NULL,
  date            TEXT        NOT NULL, -- "YYYY-MM-DD" (stock_diagnosis.report_date와 동일 관례)
  sector          TEXT,                 -- KIS bstp_kor_isnm, 포트폴리오진단 섹터 집계용(다음 단계)
  article_count   INT         NOT NULL DEFAULT 0,
  positive_count  INT         NOT NULL DEFAULT 0,
  negative_count  INT         NOT NULL DEFAULT 0,
  neutral_count   INT         NOT NULL DEFAULT 0,
  sentiment_score NUMERIC,              -- (positive-negative)/article_count, -1~1, article_count=0이면 NULL
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, date)
);

CREATE INDEX IF NOT EXISTS news_sentiment_daily_ticker_idx ON public.news_sentiment_daily(ticker, date DESC);
CREATE INDEX IF NOT EXISTS news_sentiment_daily_date_idx   ON public.news_sentiment_daily(date);
