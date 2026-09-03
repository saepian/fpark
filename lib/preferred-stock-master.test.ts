// 2026-09-03 우선주 검색 커버리지 확대(3차 우선주·알파벳 접미사·KOSDAQ) 검증.
// 실제 KIS 조회는 이 정적 테이블을 만드는 scripts/generate-preferred-stock-list.ts
// 쪽에서 이미 수행했으므로(모든 신규 항목이 fetchNameFromKisSearch로 확정됨), 여기서는
// 데이터 무결성(중복 없음·형식·기존 183건 회귀 없음)만 검증한다.
import { describe, it, expect } from 'vitest';
import { PREFERRED_STOCKS } from './preferred-stock-master';

describe('PREFERRED_STOCKS', () => {
  it('총 216건(기존 183 + 신규 33: KOSPI 30 + KOSDAQ 3)', () => {
    expect(PREFERRED_STOCKS).toHaveLength(216);
  });

  it('ticker 중복 없음', () => {
    const tickers = PREFERRED_STOCKS.map((s) => s.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
  });

  it('모든 항목의 market은 KOSPI 또는 KOSDAQ', () => {
    for (const s of PREFERRED_STOCKS) {
      expect(['KOSPI', 'KOSDAQ']).toContain(s.market);
    }
  });

  it('모든 ticker는 6자리(숫자 또는 마지막 자리 영숫자)', () => {
    for (const s of PREFERRED_STOCKS) {
      expect(s.ticker).toMatch(/^[0-9]{5}[0-9A-Za-z]$/);
    }
  });

  it('모든 name에 "우"가 포함됨(우선주 표기 관례)', () => {
    for (const s of PREFERRED_STOCKS) {
      expect(s.name).toContain('우');
    }
  });

  // 2026-08-28 확정분 회귀 확인 — 대표적으로 자주 검색될 대형주 우선주 몇 건.
  it('기존 183건 중 대표 종목 회귀 없음(삼성전자우·현대차우·LG화학우)', () => {
    const byTicker = new Map(PREFERRED_STOCKS.map((s) => [s.ticker, s]));
    expect(byTicker.get('005935')?.name).toBe('삼성전자우');
    expect(byTicker.get('005385')?.name).toBe('현대차우');
    expect(byTicker.get('051915')?.name).toBe('LG화학우');
  });

  // 2026-09-03 신규 발견 — 3차 우선주(숫자 접미사 9), 알파벳 접미사, KOSDAQ 각각 대표 1건씩.
  it('신규: 3차 우선주(숫자 접미사 9) — 현대차3우B', () => {
    const entry = PREFERRED_STOCKS.find((s) => s.ticker === '005389');
    expect(entry).toEqual({ ticker: '005389', name: '현대차3우B', market: 'KOSPI' });
  });

  it('신규: 알파벳 접미사 — CJ4우(전환) 00104K', () => {
    const entry = PREFERRED_STOCKS.find((s) => s.ticker === '00104K');
    expect(entry).toEqual({ ticker: '00104K', name: 'CJ4우(전환)', market: 'KOSPI' });
  });

  it('신규: KOSDAQ 우선주 3건 모두 market이 KOSDAQ', () => {
    const kosdaqTickers = ['021045', '032685', '03481K'];
    for (const t of kosdaqTickers) {
      const entry = PREFERRED_STOCKS.find((s) => s.ticker === t);
      expect(entry?.market).toBe('KOSDAQ');
    }
    expect(PREFERRED_STOCKS.filter((s) => s.market === 'KOSDAQ')).toHaveLength(3);
  });
});
