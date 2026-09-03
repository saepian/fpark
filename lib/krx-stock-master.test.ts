// 2026-09-03 조사: stock_master 종목명 오래됨/누락 조사 후속 — 실측 대조(공공데이터포털
// 전체 목록 vs stock_master) 결과 이름 불일치·누락은 0건이었지만, upsert만 하고 delete는
// 안 해서 원천 소스에서 사라진 종목(상장폐지·거래정지 등)이 stock_master엔 "유령 종목"으로
// 계속 남아있는 걸 발견했다(실측: 082640/269620/471050/900140). pruneStaleTickers가
// 이걸 정리하되, 우선주(PREFERRED_STOCKS, 두 데이터소스 모두 원천적으로 안 내려줌)는
// 항상 보존하는지, 조회 실패 시 안전하게(삭제 생략) 동작하는지 검증한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState: {
  existingTickers: { ticker: string }[];
  selectError: unknown;
  deleteError: unknown;
  deletedCalls: { market: string; tickers: string[] }[];
} = { existingTickers: [], selectError: null, deleteError: null, deletedCalls: [] };

vi.mock('@/lib/supabase-admin', () => {
  const stockMasterChain: any = {
    select: () => stockMasterChain,
    eq: (_col: string, _val: string) => {
      // select().eq('market', market) 체인의 최종 resolve
      if (stockMasterChain.__mode === 'delete') {
        stockMasterChain.__deleteMarket = _val;
        return stockMasterChain;
      }
      return Promise.resolve({ data: mockState.existingTickers, error: mockState.selectError });
    },
    delete: () => { stockMasterChain.__mode = 'delete'; return stockMasterChain; },
    in: (_col: string, tickers: string[]) => {
      mockState.deletedCalls.push({ market: stockMasterChain.__deleteMarket, tickers });
      stockMasterChain.__mode = undefined;
      return Promise.resolve({ error: mockState.deleteError });
    },
  };
  return {
    adminClient: {
      from: (table: string) => {
        if (table === 'stock_master') return stockMasterChain;
        throw new Error(`unexpected table: ${table}`);
      },
    },
  };
});

import { pruneStaleTickers } from './krx-stock-master';

describe('pruneStaleTickers', () => {
  beforeEach(() => {
    mockState.existingTickers = [];
    mockState.selectError = null;
    mockState.deleteError = null;
    mockState.deletedCalls = [];
  });

  it('신선한 목록에 없는 종목(유령 종목)만 삭제한다', async () => {
    mockState.existingTickers = [{ ticker: '005930' }, { ticker: '082640' }, { ticker: '000660' }];
    const removed = await pruneStaleTickers('KOSPI', [
      { ticker: '005930', name: '삼성전자', market: 'KOSPI' },
      { ticker: '000660', name: 'SK하이닉스', market: 'KOSPI' },
    ]);
    expect(removed).toBe(1);
    expect(mockState.deletedCalls).toEqual([{ market: 'KOSPI', tickers: ['082640'] }]);
  });

  it('우선주(PREFERRED_STOCKS)는 신선한 목록에 없어도 삭제하지 않는다(실측: 삼성전자우 005935)', async () => {
    mockState.existingTickers = [{ ticker: '005930' }, { ticker: '005935' }]; // 005935 = 삼성전자우
    const removed = await pruneStaleTickers('KOSPI', [
      { ticker: '005930', name: '삼성전자', market: 'KOSPI' },
    ]);
    expect(removed).toBe(0);
    expect(mockState.deletedCalls).toHaveLength(0);
  });

  it('삭제할 유령 종목이 없으면 delete 자체를 호출하지 않는다', async () => {
    mockState.existingTickers = [{ ticker: '005930' }];
    const removed = await pruneStaleTickers('KOSPI', [{ ticker: '005930', name: '삼성전자', market: 'KOSPI' }]);
    expect(removed).toBe(0);
    expect(mockState.deletedCalls).toHaveLength(0);
  });

  it('기존 목록 조회 자체가 실패하면 안전하게 삭제를 생략한다(0건 반환)', async () => {
    mockState.selectError = new Error('DB 조회 실패');
    const removed = await pruneStaleTickers('KOSPI', [{ ticker: '005930', name: '삼성전자', market: 'KOSPI' }]);
    expect(removed).toBe(0);
    expect(mockState.deletedCalls).toHaveLength(0);
  });

  it('삭제 자체가 실패하면 0건으로 안전하게 보고한다(예외를 던지지 않음)', async () => {
    mockState.existingTickers = [{ ticker: '005930' }, { ticker: '082640' }];
    mockState.deleteError = new Error('DB 삭제 실패');
    const removed = await pruneStaleTickers('KOSPI', [{ ticker: '005930', name: '삼성전자', market: 'KOSPI' }]);
    expect(removed).toBe(0);
  });

  it('KOSDAQ 시장 종목은 KOSPI 우선주 목록과 섞이지 않는다(시장별 독립 정리)', async () => {
    mockState.existingTickers = [{ ticker: '032790' }]; // KOSDAQ, 우선주 아님
    const removed = await pruneStaleTickers('KOSDAQ', []);
    expect(removed).toBe(1);
    expect(mockState.deletedCalls).toEqual([{ market: 'KOSDAQ', tickers: ['032790'] }]);
  });
});
