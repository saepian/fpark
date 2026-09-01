export interface StockPrice {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
  volume: number;
  tradingValue: string;
  sector: string;
  market: 'KOSPI' | 'KOSDAQ';
  isCached?: boolean;  // 휴장일 등 KIS 조회 실패 시 마지막 거래일 기준 값
  cachedAt?: string;
  isPartial?: boolean; // Yahoo 폴백 등으로 거래량/거래대금을 확인할 수 없는 경우
}

export interface StockInfo {
  ticker: string;
  week52High: number;
  week52Low: number;
  marketCap: string;
  per: number;
  pbr: number;
  sector: string;
  isCached?: boolean;
  cachedAt?: string;
}

export interface ChartDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradingValue?: number;
}

export interface PriceChangeBadge {
  label: '1년 전' | '6개월 전' | '1개월 전' | '1주일 전';
  pastDate: string;   // 실제 매칭된 거래일(YYYY-MM-DD), 휴장일 보정으로 목표일과 다를 수 있음
  pastClose: number;
  changeRate: number; // (currentPrice - pastClose) / pastClose * 100
  periodHigh: number; // pastDate~오늘 구간의 최고가
  periodLow: number;  // pastDate~오늘 구간의 최저가
}

export interface PortfolioPeriodChange {
  label: PriceChangeBadge['label'];
  pastValue: number;         // Σ(그 시점 종가를 찾은 종목의 quantity × 종가)
  changeRate: number;        // (currentTotalValue - pastValue) / pastValue * 100
  missingTickers: string[];  // 그 시점 종가를 못 찾은 종목(ticker) — 조회 실패/상장 전 등
  periodHigh: number;        // 기간 중(목표일~오늘) 포트폴리오 평가금액 시계열의 최고치
  periodLow: number;         // 기간 중(목표일~오늘) 포트폴리오 평가금액 시계열의 최저치
}

export interface MarketIndexData {
  value: number;
  change: number;
  changeRate: number;
  sparkline?: number[];
}

// 2026-09-01: 해외증시 지원 범위를 미국으로 한정 — 일본(NIKKEI)·홍콩(HANGSENG)·
// 중국(SHANGHAI/SHENZHEN) 지수와 그 환율(USDJPY/EURJPY/USDHKD/CNYHKD/USDCNY) 필드를 제거.
export interface MarketResponse {
  KOSPI: MarketIndexData | null;
  KOSDAQ: MarketIndexData | null;
  USD_KRW: MarketIndexData | null;
  NASDAQ: MarketIndexData | null;
  SP500: MarketIndexData | null;
  DOW: MarketIndexData | null;
  BOND_3Y?: MarketIndexData | null;
  isCached?: boolean;
  cachedAt?: string | null;
  isPrevDay?: boolean;
  prevDateLabel?: string;
}

export interface SearchResult {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  isOverseas?: boolean;
  market?: string;
  currency?: string;
}

export interface StockTag {
  code: string;
  name: string;
  reason?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  category: string;
  sub_category: string | null;
  original_url: string;
  summary: string;
  stocks: StockTag[] | string[] | null;
  image_url: string | null;
  published_at: string;
  created_at: string;
}

export interface TopNewsResponse {
  hero: NewsItem | null;
  top: NewsItem[];
}

export interface NewsListResponse {
  news: NewsItem[];
  total: number;
}

export interface AlertStock {
  name: string;
  ticker: string;
  price: number;
  high52w?: number;
  low52w?: number;
}

export interface AlertResponse {
  highAlerts: AlertStock[];
  lowAlerts: AlertStock[];
  total: number;
  isCached?: boolean;
  cachedAt?: string | null;
}

export interface StockNotification {
  id: string;
  user_id: string;
  stock_code: string;
  stock_name: string;
  type: 'price_up' | 'price_down' | 'foreign_buy' | 'foreign_sell' | 'institution_buy' | 'institution_sell';
  message: string;
  threshold: number;
  current_value: number;
  is_read: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationsResponse {
  notifications: StockNotification[];
  unreadCount: number;
  isPro: boolean;
}

export interface MoverStock {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  isEmpty?: boolean;
}

export interface MoversResponse {
  gainers: MoverStock[];
  losers: MoverStock[];
  isCached?: boolean;
  cachedAt?: string | null;
  isPrevDay?: boolean;
  prevDateLabel?: string; // "MM/DD" 형식
}
