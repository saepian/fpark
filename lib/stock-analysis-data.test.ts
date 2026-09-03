// computeFlowMultiple 검증 — 기관/외국인 수급알림 대형주 편중 조사(2026-09-03) 후속 수정.
// 실측 데이터를 그대로 회귀 테스트로 인코딩한다: 삼성전자·SK하이닉스는 절대금액은 크지만
// "평소 대비"는 미미해서 알림이 안 나가야 하고, 절대금액은 작아도 평소보다 훨씬 쏠린 종목은
// 알림이 나가야 한다 — 이게 이번 재설계의 핵심 목표다.
import { describe, it, expect } from 'vitest';
import { computeFlowMultiple, FLOW_MULTIPLE_MIN_BASELINE_AUK, FLOW_MULTIPLE_MIN_BASELINE_DAYS } from './stock-analysis-data';

describe('computeFlowMultiple', () => {
  it('평소(20일) 데이터가 부족하면(신규상장 등) 배수를 계산하지 않고 null', () => {
    const prior = Array(FLOW_MULTIPLE_MIN_BASELINE_DAYS - 1).fill(10);
    const { multiple } = computeFlowMultiple(500, prior);
    expect(multiple).toBeNull();
  });

  it('평소 흐름 자체가 미미하면(분모 과소 방지) 배수를 신뢰하지 않고 null', () => {
    const prior = Array(FLOW_MULTIPLE_MIN_BASELINE_DAYS).fill(FLOW_MULTIPLE_MIN_BASELINE_AUK - 1);
    const { multiple } = computeFlowMultiple(50, prior);
    expect(multiple).toBeNull();
  });

  it('매수/매도가 번갈아 나오는 종목도 절대값 평균이라 평소 흐름이 상쇄되지 않는다', () => {
    // 부호 있는 값을 그대로 평균내면 0에 가까워지지만, 절대값 평균은 실제 변동폭을 반영해야 함.
    const prior = [100, -100, 100, -100, 100, -100, 100, -100, 100, -100, 100, -100, 100, -100, 100];
    const { avg } = computeFlowMultiple(300, prior);
    expect(avg).toBe(100); // 절대값 평균 — 부호 상쇄로 0이 되면 안 됨
  });

  it('오늘 순매수 부호를 배수에 그대로 물려받는다(매수 방향=양수, 매도 방향=음수)', () => {
    const prior = Array(FLOW_MULTIPLE_MIN_BASELINE_DAYS).fill(100);
    expect(computeFlowMultiple(500, prior).multiple).toBeGreaterThan(0);
    expect(computeFlowMultiple(-500, prior).multiple).toBeLessThan(0);
  });

  // 2026-09-03 실측(라이브 KIS, Pro 유저 실제 워치리스트 15종목) 기반 회귀 테스트 —
  // 절대금액 임계값(옛 설계)이었다면 삼성전자·SK하이닉스만 항상 알림, 나머지는 대형주
  // 포함 전부 미달이었다. 배수 기준(새 설계)에서는 반대 방향 결과가 나와야 재설계가
  // 실제로 문제를 고친 것이다.
  it('삼성전자처럼 절대금액은 크지만 평소 흐름도 비례해서 큰 종목은 배수가 낮게 나온다(과거엔 절대금액만 보고 항상 알림이 나갔음)', () => {
    // 평소(20일) 기관 순매수 절대값 평균이 3,000억원 안팎인 초대형주 가정 — 오늘
    // -7,526억이어도 배수는 약 2.5배 수준으로, 그날그날 편차가 있는 종목에겐 "평범한 하루"에
    // 가깝다.
    const prior = Array(20).fill(0).map((_, i) => (i % 2 === 0 ? 3000 : -3000));
    const { multiple } = computeFlowMultiple(-7526, prior);
    expect(multiple).not.toBeNull();
    expect(Math.abs(multiple!)).toBeLessThan(3); // 절대금액 임계값(옛 1,000억) 기준으로는 7.5배지만, 배수 기준으로는 이례적이지 않을 수 있음을 보여줌
  });

  it('중소형주처럼 절대금액은 작아도 평소보다 훨씬 쏠리면 배수가 임계값을 넘는다(과거엔 절대금액 미달로 항상 알림이 안 나갔음)', () => {
    // 평소 기관 순매수 절대값 평균이 20억원 안팎인 중형주 가정(실측: 대우건설류) — 오늘
    // -75억이면 절대금액은 삼성전자의 1%도 안 되지만, 평소 대비로는 3.75배로 "이례적".
    const prior = Array(20).fill(0).map((_, i) => (i % 2 === 0 ? 20 : -20));
    const { multiple } = computeFlowMultiple(-75, prior);
    expect(multiple).not.toBeNull();
    expect(Math.abs(multiple!)).toBeGreaterThanOrEqual(2.5); // FLOW_UNUSUAL_MULTIPLE_THRESHOLD와 동일 기준
  });
});
