// 2026-09-01 리포트 재편 — "매입 비중 vs 현재 비중" 드리프트 카드와 종목별 위치 한 줄 요약의
// 숫자가 수기 계산과 일치하는지. 서버 사실 블록·세 화면이 전부 이 함수를 쓰므로 여기서 틀리면
// 리포트 전체가 틀린다.
import { describe, it, expect } from 'vitest';
import { computeWeightDrift, computePnlSums, buildHoldingPositionSummary, formatHoldingPositionLine, resolveHoldingTags } from './portfolio-position';

// 종근당 100,000×40 → 62,000×40 / S-Oil 140,000×25 → 153,600×25 / 삼성전자 250,000×15 → 259,000×15
const H = [
  { ticker: '185750', name: '종근당',   invested: 4_000_000, value: 2_480_000, profit: -1_520_000, profitRate: -38.0 },
  { ticker: '010950', name: 'S-Oil',    invested: 3_500_000, value: 3_840_000, profit:   340_000, profitRate:   9.71 },
  { ticker: '005930', name: '삼성전자', invested: 3_750_000, value: 3_885_000, profit:   135_000, profitRate:   3.6 },
];
// Σinvested 11,250,000 / Σvalue 10,205,000

describe('computeWeightDrift', () => {
  const rows = computeWeightDrift(H);
  it('매입 비중·현재 비중·차이(%p)를 수기 계산과 같게 낸다', () => {
    const j = rows.find(r => r.ticker === '185750')!;
    expect(j.buyWeight).toBe(35.6);      // 4,000,000/11,250,000 = 35.56
    expect(j.currentWeight).toBe(24.3);  // 2,480,000/10,205,000 = 24.30
    expect(j.deltaPp).toBe(-11.3);
    const s = rows.find(r => r.ticker === '010950')!;
    expect(s.buyWeight).toBe(31.1); expect(s.currentWeight).toBe(37.6); expect(s.deltaPp).toBe(6.5);
  });
  it('현재 비중 내림차순 정렬, 비중 합은 100 근처', () => {
    expect(rows.map(r => r.name)).toEqual(['삼성전자', 'S-Oil', '종근당']);
    expect(Math.abs(rows.reduce((a, r) => a + r.currentWeight, 0) - 100)).toBeLessThan(0.2);
    expect(Math.abs(rows.reduce((a, r) => a + r.buyWeight, 0) - 100)).toBeLessThan(0.2);
  });
  it('빈 배열/총액 0이면 빈 배열', () => {
    expect(computeWeightDrift([])).toEqual([]);
    expect(computeWeightDrift([{ ticker: 'X', name: 'X', invested: 0, value: 0 }])).toEqual([]);
  });
});

describe('buildHoldingPositionSummary / formatHoldingPositionLine', () => {
  const pnl = computePnlSums(H); // lossSum -1,520,000 / gainSum 475,000
  const ctx = { totalValue: 10_205_000, pnl, riskByTicker: new Map([['185750', 61.2], ['010950', 20.1]]) };
  it('손실 종목은 전체 손실 대비, 이익 종목은 전체 이익 대비 비율을 낸다', () => {
    const j = buildHoldingPositionSummary(H[0], ctx);
    expect(j).toEqual({ weightPct: 24.3, pnlSharePct: 100, pnlShareKind: 'loss', riskPct: 61.2 });
    const s = buildHoldingPositionSummary(H[1], ctx);
    expect(s.pnlShareKind).toBe('gain'); expect(s.pnlSharePct).toBe(71.6); // 340,000/475,000
  });
  it('한 줄 문구 — 없는 항목(변동성 기여 미계산)은 생략', () => {
    expect(formatHoldingPositionLine(buildHoldingPositionSummary(H[0], ctx))).toBe('포트폴리오 비중 24.3% · 전체 손실의 100.0% · 변동성 기여 61.2%');
    expect(formatHoldingPositionLine(buildHoldingPositionSummary(H[2], ctx))).toBe('포트폴리오 비중 38.1% · 전체 이익의 28.4%');
  });
  it('손익 0인 종목은 손익 기여 항목이 빠진다', () => {
    const z = buildHoldingPositionSummary({ ticker: 'Z', value: 1_000_000, profit: 0 }, ctx);
    expect(z.pnlSharePct).toBeNull();
    expect(formatHoldingPositionLine(z)).toBe('포트폴리오 비중 9.8%');
  });
});

// 2026-09-03 최종 다듬기 — "종목별 개별 이슈" 카드를 대체하는 종목별 성격 태그의 종목명→티커 해석.
describe('resolveHoldingTags — AI {name, tag} → {ticker, name, tag}', () => {
  const nameMap = { '185750': '종근당', '000660': 'SK하이닉스', '375500': 'DL이앤씨', '010950': 'S-Oil' };
  it('종목명 정확 일치 → 티커로 해석, 순서 유지', () => {
    expect(resolveHoldingTags([{ name: '종근당', tag: 'risk' }, { name: 'S-Oil', tag: 'positive' }], nameMap)).toEqual([
      { ticker: '185750', name: '종근당', tag: 'risk' },
      { ticker: '010950', name: 'S-Oil', tag: 'positive' },
    ]);
  });
  it('띄어쓰기·접미사·대소문자 차이는 포함 관계로 흡수한다', () => {
    expect(resolveHoldingTags([{ name: 'SK 하이닉스(주)', tag: 'risk' }, { name: 's-oil', tag: 'positive' }], nameMap).map((t) => t.ticker)).toEqual(['000660', '010950']);
  });
  it('해석 안 되는 종목명·잘못된 tag·비객체 항목은 버리고, 같은 종목은 먼저 나온 태그 하나만 남긴다', () => {
    expect(resolveHoldingTags([
      { name: '삼성전자', tag: 'risk' },        // 보유하지 않은 종목
      { name: '종근당', tag: 'neutral' },       // 잘못된 tag
      '종근당', null,                            // 비객체
      { name: '종근당', tag: 'positive' },
      { name: '종근당', tag: 'risk' },          // 중복 — 무시
    ], nameMap)).toEqual([{ ticker: '185750', name: '종근당', tag: 'positive' }]);
  });
  it('배열이 아니면 빈 배열', () => {
    expect(resolveHoldingTags(undefined, nameMap)).toEqual([]);
    expect(resolveHoldingTags({ name: '종근당', tag: 'risk' }, nameMap)).toEqual([]);
  });
});
