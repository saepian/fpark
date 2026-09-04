import { describe, it, expect } from 'vitest';
import { rankStockMaster, expandQueryVariants, isPreferredStock, isPureKoreanQuery, normalizeSearchText, type SearchWeights } from './stock-search';
import type { StockMasterEntry } from './krx-stock-master';

const L = (ticker: string, name: string, market: StockMasterEntry['market'] = 'KOSPI'): StockMasterEntry => ({ ticker, name, market });
const LIST = [
  L('000810', '삼성화재'), L('001360', '삼성제약'), L('005930', '삼성전자'), L('006660', '삼성공조'), L('009150', '삼성전기'),
  L('005935', '삼성전자우'), L('009155', '삼성전기우'), L('003720', '삼영'), L('005610', '삼립'), L('032280', '삼일'),
  L('000660', 'SK하이닉스'), L('034730', 'SK'), L('03473K', 'SK우'), L('017670', 'SK텔레콤'), L('011790', 'SKC'),
  L('035420', 'NAVER'), L('066570', 'LG전자'), L('066575', 'LG전자우'), L('005380', '현대차'), L('005387', '현대차2우B'),
];
// 2026-09-04 실측 캐시값(거래대금 원, 시총 억)
const W: SearchWeights = {
  '005930': { tradingValue: 1167873207500, marketCap: 14864163 }, '000810': { tradingValue: 47994681500, marketCap: 294673 },
  '001360': { tradingValue: 185596941, marketCap: 1241 }, '006660': { tradingValue: 736506295, marketCap: 999 },
  '009150': { tradingValue: 275914119000, marketCap: 1025544 }, '003720': { tradingValue: 323633720, marketCap: 2047 },
  '000660': { tradingValue: 1728830070500, marketCap: 11928940 }, '034730': { tradingValue: 18965200000, marketCap: 402390 },
  '011790': { tradingValue: 2165100900, marketCap: 41638 }, '035420': { tradingValue: 51477607250, marketCap: 323923 },
  '066570': { tradingValue: 33122041000, marketCap: 328213 }, '005380': { tradingValue: 60421307250, marketCap: 782175 },
};
const names = (q: string, w: SearchWeights = W) => rankStockMaster(LIST, q, w).map((s) => s.name);

describe('rankStockMaster — 매칭 단계·우선주·거래대금 가중', () => {
  it('정확일치는 항상 1위, 우선주는 본주 뒤', () => {
    expect(names('삼성전자')).toEqual(['삼성전자', '삼성전자우']);
    expect(names('005930')).toEqual(['삼성전자']);
    expect(names('LG전자')).toEqual(['LG전자', 'LG전자우']);
    expect(names('현대차')).toEqual(['현대차', '현대차2우B']);
  });
  it('부분 입력 동점은 거래대금순 — "삼성"은 삼성전자, "삼"도 삼성전자가 1위(이름 길이순이던 예전엔 삼영/삼성화재)', () => {
    expect(names('삼성').slice(0, 3)).toEqual(['삼성전자', '삼성전기', '삼성화재']);
    expect(names('삼')[0]).toBe('삼성전자');
    expect(names('SK').slice(0, 2)).toEqual(['SK', 'SK하이닉스']); // 정확일치 SK → 그다음 거래대금 최대 SK하이닉스
  });
  it('가중치가 없으면 예전 규칙(이름 길이→티커)으로 폴백', () => {
    expect(names('삼성', {}).slice(0, 2)).toEqual(['삼성화재', '삼성제약']);
    expect(names('삼', {})[0]).toBe('삼영');
  });
  it('우선주 후순위는 같은 매칭 단계 안에서만(정확일치 우선주 검색은 그대로 1위)', () => {
    expect(names('삼성전자우')).toEqual(['삼성전자우']);
    expect(names('삼성전')).toEqual(['삼성전자', '삼성전기', '삼성전자우', '삼성전기우']);
  });
});

describe('별칭·정규화', () => {
  it('별칭: 네이버→NAVER, 엘지전자→LG전자, 하이닉스/하닉→SK하이닉스(정확일치 승격)', () => {
    expect(names('네이버')).toEqual(['NAVER']);
    expect(names('엘지전자')).toEqual(['LG전자', 'LG전자우']);
    expect(names('하이닉스')[0]).toBe('SK하이닉스');
    expect(rankStockMaster(LIST, '하닉', W)[0]).toMatchObject({ name: 'SK하이닉스', score: 0 });
    expect(names('에스케이하이닉스')).toEqual(['SK하이닉스']);
  });
  it('NFKC: 전각 ＳＫ하이닉스, 대소문자, 공백', () => {
    expect(names('ＳＫ하이닉스')).toEqual(['SK하이닉스']);
    expect(names('sk하이닉스')).toEqual(['SK하이닉스']);
    expect(names('삼성 전자')).toEqual(['삼성전자', '삼성전자우']);
    expect(normalizeSearchText('ＳＫ')).toBe('sk');
  });
  it('expandQueryVariants / isPreferredStock / isPureKoreanQuery', () => {
    expect(expandQueryVariants('엘지전자')).toEqual(['엘지전자', 'lg전자']);
    expect(expandQueryVariants('  ')).toEqual([]);
    expect(isPreferredStock(L('005935', '삼성전자우'))).toBe(true);
    expect(isPreferredStock(L('03473K', 'SK우'))).toBe(true);
    expect(isPreferredStock(L('005930', '삼성전자'))).toBe(false);
    expect(isPureKoreanQuery('삼성전자')).toBe(true);
    expect(isPureKoreanQuery('삼성 전자')).toBe(true);
    expect(isPureKoreanQuery('ㅅㅅㅈㅈ')).toBe(true);
    expect(isPureKoreanQuery('SK하이닉스')).toBe(false);
    expect(isPureKoreanQuery('005930')).toBe(false);
    expect(isPureKoreanQuery('')).toBe(false);
  });
});
