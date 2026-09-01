import { describe, it, expect } from 'vitest';
import { deriveQuarterlyRows, detectYearEndMonth } from './kis-api';

// 2026-09-01 실측 삼성전자(005930) FID_DIV_CLS_CODE='1' 원본 — 회계연도 누적치.
const samsung = [
  { stac_yymm: '202606', sale_account: '3053729.00', bsop_prti: '1467252.00', thtr_ntin: '1188497.00' },
  { stac_yymm: '202603', sale_account: '1338734.00', bsop_prti: '572328.00',  thtr_ntin: '472253.00' },
  { stac_yymm: '202512', sale_account: '3336059.00', bsop_prti: '436011.00',  thtr_ntin: '452068.00' },
  { stac_yymm: '202509', sale_account: '2397686.00', bsop_prti: '235274.00',  thtr_ntin: '255651.00' },
  { stac_yymm: '202506', sale_account: '1537068.00', bsop_prti: '113613.00',  thtr_ntin: '133393.00' },
  { stac_yymm: '202503', sale_account: '791405.00',  bsop_prti: '66853.00',   thtr_ntin: '82229.00' },
  { stac_yymm: '202412', sale_account: '3008709.00', bsop_prti: '327260.00',  thtr_ntin: '344514.00' },
  { stac_yymm: '202409', sale_account: '2250826.00', bsop_prti: '262333.00',  thtr_ntin: '266970.00' },
  { stac_yymm: '202406', sale_account: '1459839.00', bsop_prti: '170499.00',  thtr_ntin: '165961.00' },
  { stac_yymm: '202403', sale_account: '719156.00',  bsop_prti: '66060.00',   thtr_ntin: '67547.00' },
];

describe('deriveQuarterlyRows', () => {
  it('누적치를 같은 회계연도 직전 분기와 빼서 단독 분기값을 만들고 전년동기비를 붙인다(12월 결산)', () => {
    const rows = deriveQuarterlyRows(samsung, '12', 6);
    expect(rows.map((r) => r.label)).toEqual(['2026년 2Q', '2026년 1Q', '2025년 4Q', '2025년 3Q', '2025년 2Q', '2025년 1Q']);
    const q2 = rows[0];
    expect(q2.revenue).toBe(3053729 - 1338734);
    expect(q2.operatingProfit).toBe(1467252 - 572328);
    // 전년 동기(2025 2Q 단독) = 1537068-791405 = 745,663 → yoy
    expect(q2.revenueYoy).toBeCloseTo(((3053729 - 1338734) - 745663) / 745663 * 100, 0);
    expect(q2.operatingProfitYoy).not.toBeNull();
    // 1Q는 누적 = 단독
    expect(rows[1].revenue).toBe(1338734);
    expect(rows[1].revenueYoy).toBeCloseTo((1338734 - 791405) / 791405 * 100, 0);
    // 4Q = 연간 − 3Q 누적
    expect(rows[2].revenue).toBe(3336059 - 2397686);
  });

  it('11월 결산이면 2·5·8·11월을 1~4Q로 매기고 12월 시작 회계연도 기준으로 뺀다', () => {
    const rows = deriveQuarterlyRows([
      { stac_yymm: '202605', sale_account: '200', bsop_prti: '20', thtr_ntin: '10' },
      { stac_yymm: '202602', sale_account: '90',  bsop_prti: '9',  thtr_ntin: '4' },
      { stac_yymm: '202511', sale_account: '400', bsop_prti: '40', thtr_ntin: '20' },
      { stac_yymm: '202508', sale_account: '290', bsop_prti: '30', thtr_ntin: '15' },
      { stac_yymm: '202505', sale_account: '180', bsop_prti: '15', thtr_ntin: '8' },
      { stac_yymm: '202502', sale_account: '80',  bsop_prti: '5',  thtr_ntin: '3' },
    ], '11');
    expect(rows.map((r) => r.label)).toEqual(['2026년 2Q', '2026년 1Q', '2025년 4Q', '2025년 3Q', '2025년 2Q', '2025년 1Q']);
    expect(rows[0].revenue).toBe(110);   // 200-90
    expect(rows[0].revenueYoy).toBe(10); // 전년 2Q 단독 100(180-80)
    expect(rows[2].revenue).toBe(110);   // 400-290
    expect(rows[1].revenue).toBe(90);    // 1Q = 누적
  });

  it('전부 0.00인 행(11월 결산 결측 케이스)은 버리고, 직전 분기가 없으면 단독값을 만들지 않는다', () => {
    const rows = deriveQuarterlyRows([
      { stac_yymm: '202606', sale_account: '0.00', bsop_prti: '0.00', thtr_ntin: '0.00' },
      { stac_yymm: '202603', sale_account: '0.00', bsop_prti: '0.00', thtr_ntin: '0.00' },
    ], '12');
    expect(rows).toEqual([]);
    const partial = deriveQuarterlyRows([{ stac_yymm: '202609', sale_account: '300', bsop_prti: '30', thtr_ntin: '10' }], '12');
    expect(partial).toEqual([]); // 3Q인데 2Q 누적이 없어 단독값 불가 → 행 자체 생략
  });

  it('영업이익 흑자↔적자 전환은 %가 아니라 라벨로 표시한다', () => {
    const rows = deriveQuarterlyRows([
      { stac_yymm: '202603', sale_account: '100', bsop_prti: '5',   thtr_ntin: '1' },
      { stac_yymm: '202503', sale_account: '100', bsop_prti: '-5',  thtr_ntin: '-1' },
      { stac_yymm: '202403', sale_account: '100', bsop_prti: '3',   thtr_ntin: '1' },
    ], '12');
    expect(rows[0].operatingProfitYoy).toBeNull();
    expect(rows[0].operatingProfitTurn).toBe('흑자전환');
    expect(rows[1].operatingProfitTurn).toBe('적자전환');
  });

  it('detectYearEndMonth는 연간 행 중 가장 흔한 월을 고른다', () => {
    expect(detectYearEndMonth([{ stac_yymm: '202606' }, { stac_yymm: '202512' }, { stac_yymm: '202412' }, { stac_yymm: '202312' }])).toBe('12');
    expect(detectYearEndMonth([{ stac_yymm: '202605' }, { stac_yymm: '202511' }, { stac_yymm: '202411' }])).toBe('11');
  });
});
