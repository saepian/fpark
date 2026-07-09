// lib/chatbot-guardrail.ts 사후 검증 정규식 단위 테스트.
// 실제 우회 질문에 대한 챗봇 end-to-end 테스트(실제 Claude 호출)는 별도로 수동 진행하고
// 결과를 대화 로그에 남긴다 — 이 파일은 "1차 방어(프롬프트)가 뚫렸을 때 2차 방어가
// 실제로 걸러내는가"만 순수 함수 레벨에서 검증한다.

import { describe, it, expect } from 'vitest';
import { checkInvestmentAdviceLanguage, CHATBOT_INVESTMENT_REFUSAL_MESSAGE } from './chatbot-guardrail';

describe('checkInvestmentAdviceLanguage — 걸려야 하는 경우(1차 방어 실패를 가정한 응답)', () => {
  it('매수 권유', () => {
    expect(checkInvestmentAdviceLanguage('지금 매수하시는 게 좋아 보여요').flagged).toBe(true);
  });

  it('매도 권유', () => {
    expect(checkInvestmentAdviceLanguage('이 종목은 매도를 고려해보세요').flagged).toBe(true);
  });

  it('목표주가 언급', () => {
    expect(checkInvestmentAdviceLanguage('목표주가는 8만원 정도로 보입니다').flagged).toBe(true);
  });

  it('추천 종목', () => {
    expect(checkInvestmentAdviceLanguage('요즘 추천 종목은 반도체주예요').flagged).toBe(true);
  });

  it('상승 전망 예측', () => {
    expect(checkInvestmentAdviceLanguage('앞으로 상승할 가능성이 높아요').flagged).toBe(true);
  });

  it('6자리 종목코드(원화 금액 아님)', () => {
    expect(checkInvestmentAdviceLanguage('005930 종목이 궁금하신 거죠?').flagged).toBe(true);
  });
});

describe('checkInvestmentAdviceLanguage — 걸리지 않아야 하는 경우(정상 안내 응답)', () => {
  it('포트폴리오 분석 기능 설명', () => {
    const text = '포트폴리오 분석 기능은 보유 종목을 등록하시면 AI가 진단해드리는 기능이에요. /ai-portfolio에서 이용하실 수 있어요.';
    expect(checkInvestmentAdviceLanguage(text).flagged).toBe(false);
  });

  it('기업분석 크레딧 설명', () => {
    const text = '기업분석 크레딧은 일일 이용 한도를 다 쓰신 뒤에도 추가로 분석을 이용하실 수 있는 1회권이에요.';
    expect(checkInvestmentAdviceLanguage(text).flagged).toBe(false);
  });

  it('환불 정책 설명', () => {
    const text = '결제일로부터 7일 이내에 마이페이지에서 신청하시면 환불 금액이 자동으로 계산돼요.';
    expect(checkInvestmentAdviceLanguage(text).flagged).toBe(false);
  });

  it('원화 금액(6자리)은 티커로 오탐하지 않음', () => {
    const text = 'Pro 연간 요금제는 191040원이에요.';
    expect(checkInvestmentAdviceLanguage(text).flagged).toBe(false);
  });

  it('정형 거절 문구 자체는 걸리지 않음(치환 후 재검사해도 안전)', () => {
    expect(checkInvestmentAdviceLanguage(CHATBOT_INVESTMENT_REFUSAL_MESSAGE).flagged).toBe(false);
  });
});
