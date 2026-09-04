import { describe, it, expect } from 'vitest';
import { topWatchMovers, summarizeDashboard, stockHref } from './personal-strip';
import { pickNewsPlaceholder, isLegacyFallbackImage } from './news-placeholder';
import { isNewsFlagged, NEWS_RELEVANCE_MIN } from './summarize';

describe('personal-strip', () => {
  it('관심종목 등락률 절대값 상위 n개, 시세 실패(price 0) 제외', () => {
    const items = [
      { ticker: 'A', name: 'A', price: 100, changeRate: 1.2 },
      { ticker: 'B', name: 'B', price: 100, changeRate: -5.5 },
      { ticker: 'C', name: 'C', price: 0, changeRate: 99 },
      { ticker: 'D', name: 'D', price: 100, changeRate: 3.1 },
    ];
    expect(topWatchMovers(items, 2).map((w) => w.ticker)).toEqual(['B', 'D']);
    expect(topWatchMovers([], 5)).toEqual([]);
  });
  it('대시보드 요약: 숨김 제외 개수, 전일종가 역산 기반 오늘 평가 등락%', () => {
    const s = summarizeDashboard([
      { ticker: 'A', name: 'A', quantity: 10, currentPrice: 110, changeRate: 10 },   // 전일 100 → 1000 → 1100
      { ticker: 'B', name: 'B', quantity: 5,  currentPrice: 90,  changeRate: -10 },  // 전일 100 → 500 → 450
      { ticker: 'H', name: 'H', quantity: 1,  hidden: true, currentPrice: 999, changeRate: 50 },
      { ticker: 'F', name: 'F', quantity: 1,  currentPrice: null, changeRate: null, quoteFailed: true },
    ]);
    expect(s.count).toBe(3);
    expect(s.pricedCount).toBe(2);
    expect(s.todayChangePct).toBeCloseTo(((1550 - 1500) / 1500) * 100, 6);
    expect(summarizeDashboard([]).todayChangePct).toBeNull();
    expect(summarizeDashboard([{ ticker: 'F', name: 'F', quantity: 1, currentPrice: null, changeRate: null, quoteFailed: true }])).toMatchObject({ count: 1, todayChangePct: null });
  });
  it('종목 링크: 국내 /stock, 해외 /overseas', () => {
    expect(stockHref({ ticker: '005930' })).toBe('/stock/005930');
    expect(stockHref({ ticker: '005930', market: 'kr' })).toBe('/stock/005930');
    expect(stockHref({ ticker: 'AAPL', market: 'us' })).toBe('/overseas/us/AAPL');
  });
});

describe('news-placeholder', () => {
  it('예전 폴백 URL/빈 값은 이미지 없음으로', () => {
    expect(isLegacyFallbackImage(null)).toBe(true);
    expect(isLegacyFallbackImage('https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400')).toBe(true);
    expect(isLegacyFallbackImage('https://img.yna.co.kr/x.jpg')).toBe(false);
  });
  it('카테고리별 2종을 id로 결정적으로 분산', () => {
    const a = pickNewsPlaceholder('domestic', 'id-1'); const b = pickNewsPlaceholder('domestic', 'id-1');
    expect(a).toEqual(b);
    expect(a.key.startsWith('domestic')).toBe(true);
    expect(pickNewsPlaceholder('global', 'x').key.startsWith('global')).toBe(true);
    expect(pickNewsPlaceholder('macro', 'x').key.startsWith('other')).toBe(true);
    const keys = new Set(Array.from({ length: 40 }, (_, i) => pickNewsPlaceholder('domestic', `id-${i}`).key));
    expect(keys.size).toBe(2);
  });
});

describe('news flag rule', () => {
  it('홍보성이거나 관련성 미달이면 제외', () => {
    expect(isNewsFlagged({ relevance: 9, promotional: false })).toBe(false);
    expect(isNewsFlagged({ relevance: 9, promotional: true })).toBe(true);
    expect(isNewsFlagged({ relevance: NEWS_RELEVANCE_MIN - 1, promotional: false })).toBe(true);
    expect(isNewsFlagged({ relevance: NEWS_RELEVANCE_MIN, promotional: false })).toBe(false);
  });
});
