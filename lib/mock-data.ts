// lib/mock-data.ts

export interface StockData {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
  volume: number;
  marketCap: string;
  per: number;
  pbr: number;
  week52High: number;
  week52Low: number;
  value: string;
  sector: string;
}

export interface ChartDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  time: string;
  imageUrl: string;
  tags?: string[];
  type?: 'positive' | 'negative' | 'neutral';
}

export interface MarketIndex {
  name: string;
  value: number;
  change: number;
  changeRate: number;
}

// Global List of Stocks
export const mockStocks: Record<string, StockData> = {
  '005930': {
    ticker: '005930',
    name: '삼성전자',
    price: 59800,
    change: 800,
    changeRate: 1.35,
    volume: 12450230,
    marketCap: '356.5T',
    per: 12.4,
    pbr: 1.2,
    week52High: 88000,
    week52Low: 54200,
    value: '745.2B',
    sector: '반도체',
  },
  '000660': {
    ticker: '000660',
    name: 'SK하이닉스',
    price: 184200,
    change: 8100,
    changeRate: 4.52,
    volume: 4120000,
    marketCap: '134.1T',
    per: 19.8,
    pbr: 1.8,
    week52High: 240000,
    week52Low: 112000,
    value: '761.6B',
    sector: '반도체',
  },
  '086520': {
    ticker: '086520',
    name: '에코프로',
    price: 102400,
    change: -2250,
    changeRate: -2.15,
    volume: 980000,
    marketCap: '27.2T',
    per: 45.4,
    pbr: 4.5,
    week52High: 150000,
    week52Low: 85000,
    value: '100.5B',
    sector: '이차전지',
  },
  '005490': {
    ticker: '005490',
    name: '포스코홀딩스',
    price: 412000,
    change: 7500,
    changeRate: 1.85,
    volume: 245000,
    marketCap: '34.8T',
    per: 15.2,
    pbr: 0.65,
    week52High: 460000,
    week52Low: 320000,
    value: '101.3B',
    sector: '철강',
  },
  '005380': {
    ticker: '005380',
    name: '현대차',
    price: 241500,
    change: -1500,
    changeRate: -0.62,
    volume: 540000,
    marketCap: '51.3T',
    per: 5.4,
    pbr: 0.55,
    week52High: 285000,
    week52Low: 190000,
    value: '130.4B',
    sector: '자동차',
  },
  '035720': {
    ticker: '035720',
    name: '카카오',
    price: 48200,
    change: 60,
    changeRate: 0.12,
    volume: 1200000,
    marketCap: '21.4T',
    per: 22.4,
    pbr: 1.1,
    week52High: 65000,
    week52Low: 38000,
    value: '57.8B',
    sector: 'IT/플랫폼',
  },
  '035420': {
    ticker: '035420',
    name: 'NAVER',
    price: 172500,
    change: 3400,
    changeRate: 2.01,
    volume: 850000,
    marketCap: '28.1T',
    per: 14.5,
    pbr: 1.15,
    week52High: 230000,
    week52Low: 155000,
    value: '146.6B',
    sector: 'IT/플랫폼',
  },
  '000990': {
    ticker: '000990',
    name: 'DB하이텍',
    price: 41250,
    change: -350,
    changeRate: -0.85,
    volume: 320000,
    marketCap: '1.83T',
    per: 8.5,
    pbr: 0.95,
    week52High: 62000,
    week52Low: 36000,
    value: '13.2B',
    sector: '반도체',
  },
  '042700': {
    ticker: '042700',
    name: '한미반도체',
    price: 98100,
    change: 3880,
    changeRate: 4.12,
    volume: 1150000,
    marketCap: '9.5T',
    per: 32.1,
    pbr: 3.4,
    week52High: 180000,
    week52Low: 52000,
    value: '112.8B',
    sector: '반도체',
  },
};

// Market Indices
export const mockIndices: Record<string, MarketIndex> = {
  KOSPI: { name: 'KOSPI', value: 2542.15, change: 31.22, changeRate: 1.25 },
  KOSDAQ: { name: 'KOSDAQ', value: 840.12, change: -4.25, changeRate: -0.50 },
  USD_KRW: { name: 'USD/KRW', value: 1320.50, change: 3.90, changeRate: 0.30 },
};

// Market News
export const mockNews: NewsItem[] = [
  {
    id: 'n1',
    title: '금리 인하 기대감에 증시 활기... 전문가들의 제언',
    summary: '미 연준의 완화적 발언 이후 국내 증시로 외국인 자금 유입 가속화. 전문가들은 실적 개선이 뚜렷한 대형주 중심의 대응을 주문하고 있습니다.',
    source: 'FPARK 뉴스',
    time: '2시간 전',
    imageUrl: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=600&auto=format&fit=crop&q=60',
    tags: ['코스피', '기준금리'],
    type: 'positive',
  },
  {
    id: 'n2',
    title: '수도권 3기 신도시 조기 공급... 부동산 시장 향방은?',
    summary: '국토부, 주택 공급 확대 위해 인허가 절차 대폭 단축 예고. 무주택자들의 기대감이 높아지는 가운데 대출 규제 완화 여부가 관건이 될 전망.',
    source: 'FPARK 뉴스',
    time: '4시간 전',
    imageUrl: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&auto=format&fit=crop&q=60',
    tags: ['부동산', '공급대책'],
    type: 'neutral',
  },
  {
    id: 'n3',
    title: '엔비디아 시총 1위 탈환... 국내 AI 반도체 밸류체인 동반 급등',
    summary: '엔비디아 주가 폭등에 힘입어 SK하이닉스 및 한미반도체 등 핵심 연관 기업 실적 개선 기대 수급 집중.',
    source: 'FPARK 뉴스',
    time: '5시간 전',
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=60',
    tags: ['반도체', '엔비디아'],
    type: 'positive',
  },
  {
    id: 'n4',
    title: '국제 유가 공급 과잉 우려에 3% 하락... 정유주 일제히 약세',
    summary: '글로벌 정유 수요 위축 우려와 이란 공급 증가 관측에 유가 지속 타격, 에쓰오일 등 약세.',
    source: 'FPARK 뉴스',
    time: '6시간 전',
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=60',
    tags: ['유가', '정유주'],
    type: 'negative',
  },
  // Specific Stock Related News for Samsung Electronics (005930)
  {
    id: 's1',
    title: '삼성전자, HBM3E 품질 테스트 통과 임박',
    summary: 'HBM3E 5세대 고대역폭 메모리의 엔비디아 테스트 인증 획득이 가시화되면서 기관 투자수급 집중 유입 유력.',
    source: 'Financial Times',
    time: '2시간 전',
    imageUrl: 'https://images.unsplash.com/photo-1591453089816-0fbb971b454c?w=600&auto=format&fit=crop&q=60',
    tags: ['삼성전자', 'HBM3E'],
    type: 'positive',
  },
  {
    id: 's2',
    title: '반도체 업황 회복 시그널... 외국인 매수세 유입',
    summary: '글로벌 PC 및 서버 제조사들의 D램 재고 소진과 판가 인상 트렌드로 4분기 실적 개선세 가속화 관측.',
    source: 'Reuters',
    time: '4시간 전',
    imageUrl: 'https://images.unsplash.com/photo-1611095777215-685b3061dd21?w=600&auto=format&fit=crop&q=60',
    tags: ['반도체', '외국인'],
    type: 'positive',
  },
  {
    id: 's3',
    title: '엔비디아 발 훈풍, 국내 반도체 대장주 일제히 반등',
    summary: '미국 테크주 실적 호조가 국내 정보기술 대형주에 대한 저가 매수 심리를 자극해 반등 주도.',
    source: 'K-Economic',
    time: '6시간 전',
    imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&auto=format&fit=crop&q=60',
    tags: ['엔비디아', '반체'],
    type: 'positive',
  },
  {
    id: 's4',
    title: '삼성전자 노사 분규 극적 타결... 생산 차질 우려 해소',
    summary: '임금 단체협상 긴급 잠정합의안 가결로 평택 및 기흥 전 전공정 수율 타격 및 다운타임 우려 최종 불식.',
    source: 'Nikkei Asia',
    time: '8시간 전',
    imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&auto=format&fit=crop&q=60',
    tags: ['삼성전자', '노사합의'],
    type: 'neutral',
  },
];

// Chart Data Generator
export const generateMockChartData = (basePrice: number, points: number, type: 'up' | 'down'): ChartDataPoint[] => {
  const data: ChartDataPoint[] = [];
  let currentPrice = basePrice - (type === 'up' ? basePrice * 0.05 : -basePrice * 0.05);
  
  const now = new Date();
  
  for (let i = points - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    
    const changePercent = (Math.random() - (type === 'up' ? 0.45 : 0.55)) * 0.03; // bias based on trend
    const dailyChange = currentPrice * changePercent;
    
    const open = Math.round(currentPrice);
    const close = Math.round(currentPrice + dailyChange);
    const high = Math.round(Math.max(open, close) + Math.random() * (basePrice * 0.01));
    const low = Math.round(Math.min(open, close) - Math.random() * (basePrice * 0.01));
    const volume = Math.round(500000 + Math.random() * 2000000);
    
    data.push({
      date: dateStr,
      open,
      high,
      low,
      close,
      volume,
    });
    
    currentPrice = close;
  }
  
  // ensure final price matches or is close to basePrice
  data[data.length - 1].close = basePrice;
  return data;
};

// AI Insights/Analyses
export const mockAiAnalysis: Record<string, {
  timestamp: string;
  summary: string;
  tags: string[];
  content: string;
}> = {
  '005930': {
    timestamp: '2026.06.21 10:30 기준',
    summary: '삼성전자는 3분기 어닝 서프라이즈 이후 HBM3 공급 본격화로 반도체 부문의 수익성 개선이 가속화될 것으로 전망됩니다. 특히 AI 서버향 수요 증가가 실적 성장의 핵심 동력입니다.',
    tags: ['HBM3E', '반도체', '어닝서프라이즈'],
    content: `삼성전자의 반도체(DS) 부문은 HBM3E 8단 및 12단 제품의 주요 고객사향 공급 진입이 본격화되면서 마진 스프레드가 급격히 확대되고 있습니다. 전세대 공정 수율 극대화와 레거시 노드의 탄력적 감산 전략이 주효하여 영업이익률이 업종 최고 수준으로 회귀하고 있으며, 특히 주요 AI 탑티어 CSP(클라우드 공급자)들의 인프라 신규 설비 투자 집행률 상향에 따른 기업향 SSD 및 HBM의 타이트한 공급 구도가 장기 지속될 전망입니다.`,
  },
  '000660': {
    timestamp: '2026.06.21 11:00 기준',
    summary: 'SK하이닉스는 HBM3/3E 부문의 선도적 점유율을 견지하며, 고대역폭 메모리 수요 폭증에 최선호 수혜주 지위를 공고히 유지하는 중입니다.',
    tags: ['HBM3E', '엔비디아', 'D램독점'],
    content: `SK하이닉스는 1b 나노미터 공정 안정화와 선제적인 초고대역폭 메모리 설계 기술 리더십을 결합하여 고부가가치 D램 솔루션 중심의 영업 환경을 장악하고 있습니다. 엔비디아와의 장기 수급 계약(LTA) 기반 안정적 매출 확보에 이어, 차세대 12단 HBM3E 비중 증가를 통해 파운드리 협력을 강화하고 높은 레버리지 효과를 구가할 핵심 종목으로 분류됩니다.`,
  },
  '035420': {
    timestamp: '2026.06.21 14:15 기준',
    summary: 'Selli의 분석: 오늘의 핵심 유망주 - NAVER. 검색 인프라와 하이퍼클로바X AI 클라우드의 B2B 시너지가 4분기부터 가시화될 전망입니다.',
    tags: ['하이퍼클로바X', 'B2B클라우드', '저평가'],
    content: `네이버는 강력한 커머스 지배력과 스마트스토어 입점사 풀을 연계하는 인공지능 추천 제어 엔진 개선으로 ARPPU(사용자당평균결제율)를 상승시키는 중입니다. 특히 공공 및 유통 대기업군 대상 하이퍼클로바X 클라우드 구축 솔루션 계약 수주가 순조로워 차세대 성장 엔진으로 확고하게 편입될 것으로 기대되며, 글로벌 경쟁사 대비 역사적 하단에 도달한 PER 밸류에이티를 고려할 때 매수 관점 진입이 우수한 구간입니다.`,
  },
};

// API proxy functions to simulate data fetching
export const getStockData = async (ticker: string): Promise<StockData | null> => {
  return mockStocks[ticker] || null;
};

export const getChartData = async (ticker: string, period: '1W' | '1M' | '3M' | '1Y'): Promise<ChartDataPoint[]> => {
  const stock = mockStocks[ticker];
  if (!stock) return [];
  
  let points = 7;
  if (period === '1W') points = 7;
  else if (period === '1M') points = 30;
  else if (period === '3M') points = 90;
  else if (period === '1Y') points = 365;
  
  const trend = stock.changeRate >= 0 ? 'up' : 'down';
  return generateMockChartData(stock.price, points, trend);
};

export const getRelatedNews = async (ticker: string): Promise<NewsItem[]> => {
  if (ticker === '005930') {
    return mockNews.filter(n => n.tags?.includes('삼성전자') || n.id.startsWith('s'));
  }
  return mockNews.slice(0, 3);
};

export const getSectorRecommendation = async (sector: string, excludeTicker: string): Promise<StockData[]> => {
  return Object.values(mockStocks)
    .filter(s => s.sector === sector && s.ticker !== excludeTicker)
    .slice(0, 3);
};

export const searchTickers = async (query: string): Promise<StockData[]> => {
  if (!query) return [];
  const q = query.toLowerCase();
  return Object.values(mockStocks).filter(
    s => s.ticker.includes(q) || s.name.toLowerCase().includes(q)
  );
};
