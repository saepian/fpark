import { describe, it, expect } from 'vitest';
import { stripFlowSubject } from './flow-caption';

describe('stripFlowSubject', () => {
  it('주어 접두어(콜론/공백/조사)를 뗀다', () => {
    expect(stripFlowSubject('기관: 최근 5거래일 중 3일 순유입')).toBe('최근 5거래일 중 3일 순유입');
    expect(stripFlowSubject('외국인 최근 5거래일 중 4일 순유입')).toBe('최근 5거래일 중 4일 순유입');
    expect(stripFlowSubject('기관은 5일 중 3일 순유입했다')).toBe('5일 중 3일 순유입했다');
    expect(stripFlowSubject('외국인이 4일 연속 유출')).toBe('4일 연속 유출');
  });
  it('주어가 없으면 그대로, 단어 일부("기관투자자")는 건드리지 않는다', () => {
    expect(stripFlowSubject('최근 5거래일 중 3일 순유입')).toBe('최근 5거래일 중 3일 순유입');
    expect(stripFlowSubject('기관투자자 순유입 3일')).toBe('기관투자자 순유입 3일');
    expect(stripFlowSubject('')).toBe('');
    expect(stripFlowSubject(undefined)).toBe('');
  });
});
