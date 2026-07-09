// 계좌이체 자동 매칭 판정 로직(matchPendingPayments) 단위 테스트.
// 2026-07-09 CODEF 실계좌 테스트로 확정된 사실 반영: resAccountDesc3 = 적요(입금자
// 자유텍스트, 비어있으면 계좌주명 자동), resAccountIn = 입금액.
// depositorName은 예금주 실명(depositor_real_name) 기준 — 이메일ID 기반 매칭에서
// 전환하면서 유저가 은행 앱 적요를 직접 안 건드려도(계좌주명 자동표시) 매칭되도록 함.

import { describe, it, expect } from 'vitest';
import { matchPendingPayments, depositTimestamp, depositKey, type PendingPaymentRequest, type CodefDeposit } from './codef-payment-matching';

function request(overrides: Partial<PendingPaymentRequest> = {}): PendingPaymentRequest {
  return {
    id:            'req-1',
    amount:        9900,
    depositorName: 'hong',
    requestedAt:   '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function deposit(overrides: Partial<CodefDeposit> = {}): CodefDeposit {
  return {
    resAccountTrDate: '20260702',
    resAccountTrTime: '120000',
    resAccountIn:      '9900',
    resAccountDesc3:  'hong',
    ...overrides,
  };
}

describe('matchPendingPayments — 유니크 매칭', () => {
  it('금액+적요가 정확히 하나씩 일치하면 auto_approve', () => {
    const [decision] = matchPendingPayments([request()], [deposit()]);
    expect(decision.decision).toBe('auto_approve');
    if (decision.decision === 'auto_approve') {
      expect(decision.requestId).toBe('req-1');
      expect(decision.depositKey).toBe(depositKey(deposit()));
    }
  });

  it('적요 대소문자/앞뒤 공백 차이는 무시하고 매칭', () => {
    const [decision] = matchPendingPayments(
      [request({ depositorName: '  Hong ' })],
      [deposit({ resAccountDesc3: 'hong' })],
    );
    expect(decision.decision).toBe('auto_approve');
  });

  it('출금 거래(resAccountIn=0)는 후보에서 제외', () => {
    const [decision] = matchPendingPayments(
      [request()],
      [deposit({ resAccountIn: '0' }), deposit()],
    );
    expect(decision.decision).toBe('auto_approve');
  });
});

describe('matchPendingPayments — 동명이인 충돌', () => {
  it('같은 금액+적요의 신청이 2건이면 둘 다 manual_review', () => {
    const requests = [request({ id: 'req-1' }), request({ id: 'req-2' })];
    const decisions = matchPendingPayments(requests, [deposit()]);
    expect(decisions).toHaveLength(2);
    for (const d of decisions) {
      expect(d.decision).toBe('manual_review');
    }
  });
});

describe('matchPendingPayments — 중복 입금(금액 충돌)', () => {
  it('같은 금액+적요의 입금이 2건이면 manual_review', () => {
    const decisions = matchPendingPayments(
      [request()],
      [
        deposit({ resAccountTrTime: '090000' }),
        deposit({ resAccountTrTime: '150000' }),
      ],
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('manual_review');
    if (decisions[0].decision === 'manual_review') {
      expect(decisions[0].candidateCount).toBe(2);
    }
  });
});

describe('matchPendingPayments — 미확인/이름불일치', () => {
  it('금액은 맞지만 적요 이름이 다르면 manual_review, candidateCount 0', () => {
    const decisions = matchPendingPayments(
      [request({ depositorName: 'hong' })],
      [deposit({ resAccountDesc3: 'kim' })],
    );
    expect(decisions[0].decision).toBe('manual_review');
    if (decisions[0].decision === 'manual_review') {
      expect(decisions[0].candidateCount).toBe(0);
    }
  });

  it('적요가 빈 값이면(계좌주명 자동표시 케이스) 등록된 입금자명과 다르면 매칭 안 됨', () => {
    const decisions = matchPendingPayments(
      [request({ depositorName: 'hong' })],
      [deposit({ resAccountDesc3: '' })],
    );
    expect(decisions[0].decision).toBe('manual_review');
  });

  it('입금 자체가 없으면 manual_review, candidateCount 0', () => {
    const decisions = matchPendingPayments([request()], []);
    expect(decisions[0].decision).toBe('manual_review');
    if (decisions[0].decision === 'manual_review') {
      expect(decisions[0].candidateCount).toBe(0);
    }
  });
});

describe('matchPendingPayments — 신청 이전 입금 제외', () => {
  it('입금 시각이 신청 시각보다 이전이면 후보에서 제외', () => {
    const decisions = matchPendingPayments(
      [request({ requestedAt: '2026-07-05T00:00:00.000Z' })],
      [deposit({ resAccountTrDate: '20260701', resAccountTrTime: '120000' })], // 신청 전 입금
    );
    expect(decisions[0].decision).toBe('manual_review');
    if (decisions[0].decision === 'manual_review') {
      expect(decisions[0].candidateCount).toBe(0);
    }
  });

  it('입금 시각이 신청 시각 이후면 정상 매칭', () => {
    const decisions = matchPendingPayments(
      [request({ requestedAt: '2026-07-01T00:00:00.000Z' })],
      [deposit({ resAccountTrDate: '20260702', resAccountTrTime: '120000' })],
    );
    expect(decisions[0].decision).toBe('auto_approve');
  });
});

describe('matchPendingPayments — 예금주 실명 미입력(방어 코드)', () => {
  it('depositorName이 null이면 그룹핑 없이 즉시 manual_review', () => {
    const decisions = matchPendingPayments(
      [request({ depositorName: null })],
      [deposit()],
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('manual_review');
    if (decisions[0].decision === 'manual_review') {
      expect(decisions[0].candidateCount).toBe(0);
      expect(decisions[0].reason).toContain('미입력');
    }
  });

  it('depositorName이 빈 문자열/공백만 있어도 미입력으로 취급', () => {
    const decisions = matchPendingPayments(
      [request({ depositorName: '   ' })],
      [deposit()],
    );
    expect(decisions[0].decision).toBe('manual_review');
  });

  it('이름 없는 신청이 섞여 있어도 이름 있는 신청의 유니크 매칭에는 영향 없음', () => {
    const decisions = matchPendingPayments(
      [request({ id: 'no-name', depositorName: null }), request({ id: 'named', depositorName: 'hong' })],
      [deposit()],
    );
    const noName = decisions.find((d) => d.requestId === 'no-name')!;
    const named = decisions.find((d) => d.requestId === 'named')!;
    expect(noName.decision).toBe('manual_review');
    expect(named.decision).toBe('auto_approve');
  });
});

describe('depositTimestamp — KST 기준 변환', () => {
  it('KST 자정 거래는 UTC로 전날 15시', () => {
    const d = depositTimestamp(deposit({ resAccountTrDate: '20260709', resAccountTrTime: '000000' }));
    expect(d.toISOString()).toBe('2026-07-08T15:00:00.000Z');
  });
});
