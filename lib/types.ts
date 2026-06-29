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
}
