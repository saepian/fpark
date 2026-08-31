// 2026-08-31 오픈 전 QA에서 종목분석 실제 저장분(main_analysis)에서 컴플라이언스 금지어
// "패닉 매도"가 프롬프트 지시(COMPLIANCE_PRINCIPLE)를 뚫고 새어나간 걸 발견했다 — 프롬프트만
// 믿지 말고 서버 측 사후 감지 그물(scanComplianceViolations)을 추가한 것을 검증한다.
// 동시에 "공매도"·"매수 사이드카"·"매수관여율" 같은 실제 공식 시장·규제 용어는 오탐이 아니어야
// 한다(같은 QA에서 60건 스캔 중 대부분이 이 합성어 오탐이었음).

import { describe, it, expect } from 'vitest';
import { scanComplianceViolations } from './ai-compliance';

describe('scanComplianceViolations', () => {
  it('진짜 금지어(매수/매도)는 잡아낸다', () => {
    const hits = scanComplianceViolations('오늘의 급락이 대규모 패닉 매도가 아니라 외국인의 자금 회수로 풀이된다.');
    expect(hits.some(h => h.term === '매도')).toBe(true);
  });

  it('목표가/적정가/손절가/저항선/지지선도 잡아낸다', () => {
    expect(scanComplianceViolations('목표가는 15만원이다').some(h => h.term === '목표가')).toBe(true);
    expect(scanComplianceViolations('적정가 수준으로 판단된다').some(h => h.term === '적정가')).toBe(true);
    expect(scanComplianceViolations('손절가를 설정하라는 의견이 있다').some(h => h.term === '손절가')).toBe(true);
    expect(scanComplianceViolations('저항선 부근에서 눌렸다').some(h => h.term === '저항선')).toBe(true);
    expect(scanComplianceViolations('지지선까지 하락했다').some(h => h.term === '지지선')).toBe(true);
  });

  it('공매도는 오탐이 아니다(공식 제도 명칭)', () => {
    const hits = scanComplianceViolations('미국 AI 헤지펀드들의 과도한 공매도 포지션이 원인으로 지목됐다.');
    expect(hits.length).toBe(0);
  });

  it('매수 사이드카·매도 사이드카는 오탐이 아니다(KRX 공식 제도 명칭)', () => {
    expect(scanComplianceViolations('코스피 매수 사이드카가 발동될 만큼 강한 상승 압력이 있었다.').length).toBe(0);
    expect(scanComplianceViolations('코스닥 매도 사이드카가 발동됐다.').length).toBe(0);
  });

  it('매수관여율·매도관여율은 오탐이 아니다(거래소 투자주의종목 지정 지표)', () => {
    expect(scanComplianceViolations('특정 단일 계좌의 매수관여율 7%대를 근거로 투자주의종목 지정.').length).toBe(0);
  });

  it('허용 합성어와 진짜 금지어가 한 문장에 섞여 있어도 진짜 금지어만 잡는다', () => {
    const hits = scanComplianceViolations('공매도 압력이 커지는 가운데, 지금이 매수 타이밍이라는 해석도 있다.');
    expect(hits.length).toBe(1);
    expect(hits[0].term).toBe('매수');
  });

  it('순매수/순매도는 허용 목록이 아니라 여전히 위반으로 잡는다(2026-08 순매수/순매도 표현 완전 제거 정책과 동일 기준)', () => {
    expect(scanComplianceViolations('오늘 외국인 순매수 규모가 컸다.').some(h => h.term === '매수')).toBe(true);
    expect(scanComplianceViolations('기관 순매도가 이어졌다.').some(h => h.term === '매도')).toBe(true);
  });

  it('빈 문자열/undefined는 안전하게 빈 배열을 반환한다', () => {
    expect(scanComplianceViolations('')).toEqual([]);
  });

  it('문맥(context)에 위반어 앞뒤가 포함된다', () => {
    const hits = scanComplianceViolations('오늘 시장은 뚜렷한 매도 우위였다.');
    expect(hits[0].context).toContain('매도');
  });
});
