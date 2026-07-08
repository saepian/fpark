// AI 리포트 사후 검증(sanity check) 회귀 테스트.
// 2026-07-08 삼성전자 2분기 잠정실적 발표를 AI 리포트가 "실적 발표를 앞두고"라며 이미 일어난
// 일을 미래형으로 서술한 버그(커밋 db58ba8)의 정확한 시나리오를 회귀 케이스로 고정한다 —
// 같은 클래스의 버그가 다른 종목/다른 이벤트에서 재발해도 이 휴리스틱이 잡아내야 한다.

import { describe, it, expect } from 'vitest';
import { checkTemporalConsistency, buildNewsFreshnessLine } from './ai-grounding';

describe('checkTemporalConsistency', () => {
  it('실제 버그 재현: 리포트가 미래형 서술 + 뉴스엔 과거형 발표 기사 존재 → 불일치 플래그', () => {
    const reportText = '삼성전자는 실적 발표를 앞두고 투자자들의 관심이 집중되고 있다.';
    const newsText = '삼성전자는 2분기 매출 171조원, 영업이익 89조 4000억원의 잠정 실적을 발표했다.';
    const result = checkTemporalConsistency(reportText, newsText);
    expect(result.flagged).toBe(true);
    expect(result.matchedFuture).toBeTruthy();
    expect(result.matchedPast).toBeTruthy();
  });

  it('리포트가 이미 과거형으로 정확히 서술 → 플래그 없음', () => {
    const reportText = '삼성전자는 2분기 매출 171조원의 역대 최대 잠정실적을 발표했음에도 급락했다.';
    const newsText = '삼성전자는 2분기 매출 171조원, 영업이익 89조 4000억원의 잠정 실적을 발표했다.';
    expect(checkTemporalConsistency(reportText, newsText).flagged).toBe(false);
  });

  it('뉴스 자체에 과거형 근거가 없으면(모델의 순수 추측이 아닌 경우) 플래그하지 않음', () => {
    const reportText = '삼성전자는 실적 발표를 앞두고 있다.';
    const newsText = '삼성전자 주가가 오늘 6% 급락했다.';
    expect(checkTemporalConsistency(reportText, newsText).flagged).toBe(false);
  });

  it('미래형 표현 자체가 없으면 뉴스 내용과 무관하게 플래그하지 않음', () => {
    const reportText = '삼성전자는 오늘 6% 급락 마감했다.';
    const newsText = '삼성전자는 실적을 발표했다.';
    expect(checkTemporalConsistency(reportText, newsText).flagged).toBe(false);
  });

  it('다른 이벤트 유형(제품 출시)에도 동일 패턴 적용', () => {
    const reportText = '신제품 출시를 앞두고 기대감이 형성되고 있다.';
    const newsText = '해당 기업은 어제 신제품을 출시했다.';
    expect(checkTemporalConsistency(reportText, newsText).flagged).toBe(true);
  });
});

describe('buildNewsFreshnessLine', () => {
  it('뉴스 0건 → "최근 관련 뉴스 미확인" 명시', () => {
    expect(buildNewsFreshnessLine([])).toBe('참조 뉴스: 0건 (최근 관련 뉴스 미확인)');
  });

  it('뉴스 있음 + 날짜 있음 → 건수와 최신 날짜 표기', () => {
    const line = buildNewsFreshnessLine([
      { title: 'A', date: '2026. 7. 8.' },
      { title: 'B' },
    ]);
    expect(line).toContain('2건');
    expect(line).toContain('2026. 7. 8.');
  });

  it('뉴스 있음 + 날짜 정보 전혀 없음 → 건수만 표기 (에러 없이 처리)', () => {
    const line = buildNewsFreshnessLine([{ title: 'A' }, { title: 'B' }]);
    expect(line).toContain('2건');
  });
});
