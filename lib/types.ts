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

export interface MarketIndexData {
  value: number;
  change: number;
  changeRate: number;
  sparkline?: number[];
}

export interface MarketResponse {
  KOSPI: MarketIndexData | null;
  KOSDAQ: MarketIndexData | null;
  USD_KRW: MarketIndexData | null;
  NASDAQ: MarketIndexData | null;
  SP500: MarketIndexData | null;
  DOW: MarketIndexData | null;
  NIKKEI: MarketIndexData | null;
  HANGSENG: MarketIndexData | null;
  SHANGHAI: MarketIndexData | null;
  SHENZHEN: MarketIndexData | null;
  USDJPY: MarketIndexData | null;
  EURJPY: MarketIndexData | null;
  USDHKD: MarketIndexData | null;
  CNYHKD: MarketIndexData | null;
  USDCNY: MarketIndexData | null;
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
