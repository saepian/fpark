export interface StockPrice {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
  volume: number;
  tradingValue: string;
  sector: string;
}

export interface StockInfo {
  ticker: string;
  week52High: number;
  week52Low: number;
  marketCap: string;
  per: number;
  pbr: number;
}

export interface ChartDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketIndexData {
  value: number;
  change: number;
  changeRate: number;
}

export interface MarketResponse {
  KOSPI: MarketIndexData;
  KOSDAQ: MarketIndexData;
  USD_KRW: MarketIndexData | null;
  NASDAQ: MarketIndexData | null;
  isCached?: boolean;
  cachedAt?: string | null;
}

export interface SearchResult {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
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
}
