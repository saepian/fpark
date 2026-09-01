// 2026-09-01 포트폴리오분석 AI 종합평가 "구조 중심" 재설계 — Stage 2 프롬프트에 주입하는
// [포트폴리오 구조 데이터] 블록이 서버 계산값을 빠짐없이·정확한 비율로 담는지 검증한다.
// AI는 이 숫자를 그대로 인용만 하므로, 여기서 숫자가 틀리면 리포트 본문이 통째로 틀린다.
import { describe, it, expect } from 'vitest';
import { buildPortfolioStructureFacts, type StructureFactsInput } from './portfolio-structure-facts';
import { scanComplianceViolations } from './ai-compliance';

const SAMPLE: StructureFactsInput = {
  holdings: [
    { ticker: '005930', name: '삼성전자',   value: 45_000_000, invested: 50_000_000, profit: -5_000_000, profitRate: -10.0, volatility: 2.1 },
    { ticker: '000660', name: 'SK하이닉스', value: 20_000_000, invested: 22_000_000, profit: -2_000_000, profitRate: -9.09, volatility: 3.0 },
    { ticker: '005380', name: '현대차',     value: 25_000_000, invested: 20_000_000, profit:  5_000_000, profitRate: 25.0,  volatility: 1.5 },
    { ticker: '035420', name: 'NAVER',      value: 10_000_000, invested: 11_000_000, profit: -1_000_000, profitRate: -9.09, volatility: 1.8 },
  ],
  totalValue: 100_000_000,
  totalInvested: 103_000_000,
  totalProfit: -3_000_000,
  sectors: [
    { name: '반도체', tickers: ['005930', '000660'], weight: 65 },
    { name: '자동차', tickers: ['005380'], weight: 25 },
    { name: 'IT 서비스', tickers: ['035420'], weight: 10 },
  ],
  sectorConcentration: { hhi: 0.495, effectiveCount: 2.0, grade: '고집중' },
  riskContribution: [
    { ticker: '000660', name: 'SK하이닉스', pct: 34.1 },
    { ticker: '005930', name: '삼성전자',   pct: 30.9 },
    { ticker: '005380', name: '현대차',     pct: 24.7 },
    { ticker: '035420', name: 'NAVER',      pct: 10.3 },
  ],
  correlation: { correlation: 0.72, sampleSize: 88, bucket: '강한 동조화' },
};

describe('buildPortfolioStructureFacts', () => {
  const text = buildPortfolioStructureFacts(SAMPLE);

  it('종목별 비중·손익·변동성 기여도를 평가금액 비중 순으로 나열한다', () => {
    const lines = text.split('\n');
    const idx = (name: string) => lines.findIndex(l => l.includes(`· ${name}`));
    expect(idx('삼성전자')).toBeLessThan(idx('현대차'));
    expect(idx('현대차')).toBeLessThan(idx('SK하이닉스'));
    expect(text).toContain('삼성전자(반도체): 비중 45.0% | 매입가 대비 -10.00% (-5,000,000원) | 변동성 기여도 30.9%');
    expect(text).toContain('현대차(자동차): 비중 25.0% | 매입가 대비 +25.00% (+5,000,000원)');
  });

  it('섹터 비중·HHI·실효 업종 수·상관계수·변동성 기여도 섹터 합산을 담는다', () => {
    expect(text).toContain('반도체 65.0% (삼성전자, SK하이닉스)');
    expect(text).toContain('HHI 0.495, 실효 업종 수 2개');
    expect(text).toContain("등급 '고집중'");
    expect(text).toContain('상관계수: 0.72 (강한 동조화, 최근 88거래일');
    expect(text).toContain('상위 1종목 SK하이닉스 34.1%');
    expect(text).toContain('섹터별 합산 반도체 65.0%'); // 34.1 + 30.9
  });

  it('손익 구조 — 손실/이익 종목 수, 그룹 합산, 그룹 내 비율, 섹터별 누적 손익을 계산한다', () => {
    expect(text).toContain('손실 종목 3/4개(평가금액 기준 75.0%), 이익 종목 1개');
    expect(text).toContain('손실 종목 합산 -8,000,000원, 이익 종목 합산 +5,000,000원, 전체 -3,000,000원');
    expect(text).toContain('전체 손실 중 종목별 비율: 삼성전자 62.5%, SK하이닉스 25.0%, NAVER 12.5%');
    expect(text).toContain('전체 이익 중 종목별 비율: 현대차 100.0%');
    expect(text).toContain('반도체 -7,000,000원 (전체 손실의 87.5%)');
    expect(text).toContain('자동차 +5,000,000원 (전체 이익의 100.0%)');
  });

  it('비중 1위와 손익 절대액 1위의 일치 여부를 판정한다', () => {
    expect(text).toContain('비중 1위 삼성전자(45.0%) vs 손익 절대액 1위 삼성전자(-5,000,000원) → 일치');
    const swapped = buildPortfolioStructureFacts({
      ...SAMPLE,
      holdings: SAMPLE.holdings.map(h => h.ticker === '005380' ? { ...h, profit: 9_000_000 } : h),
    });
    expect(swapped).toContain('→ 불일치');
  });

  it('1종목(정량 지표 없음)이어도 깨지지 않고 "계산 안 함"으로 표시한다', () => {
    const one = buildPortfolioStructureFacts({
      holdings: [SAMPLE.holdings[0]], totalValue: 45_000_000, totalInvested: 50_000_000, totalProfit: -5_000_000,
      sectors: [{ name: '반도체', tickers: ['005930'], weight: 100 }], sectorConcentration: null, riskContribution: null, correlation: null,
    });
    expect(one).toContain('종목 수: 1개');
    expect(one).toContain('섹터 집중도: 계산 안 함');
    expect(one).toContain('상관계수: 계산 안 함');
    expect(one).toContain('변동성 기여도: 계산 안 함');
    expect(one).not.toContain('전체 이익 중');
  });

  it('보유 종목이 없으면 "데이터 없음"', () => {
    expect(buildPortfolioStructureFacts({ ...SAMPLE, holdings: [] })).toBe('데이터 없음');
  });

  it('서버가 만든 사실 블록 자체에 컴플라이언스 금지어가 없다(AI가 그대로 인용해도 안전)', () => {
    expect(scanComplianceViolations(text)).toEqual([]);
  });
});
