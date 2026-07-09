// 계좌이체 결제 신청 ↔ CODEF 입금내역 자동 매칭 — DB/CODEF API 호출과 분리된 순수 함수.
// 호출부(크론/라우트)가 지켜야 할 전제 두 가지:
//   1) requests에는 status='pending' 신청만 넘길 것 (이미 처리된 건은 여기서 걸러지지 않음
//      — 중복 승인 방지는 호출부가 DB 쿼리 단계에서 책임진다)
//   2) deposits는 입금/출금 구분 없이 CODEF 거래내역을 그대로 넘겨도 된다(resAccountIn<=0은
//      내부에서 자동 제외).
//
// 매칭 기준: 금액 + 적요(예금주 실명) 조합이 신청 쪽에서도 입금 쪽에서도 각각 정확히
// 1건씩일 때만 auto_approve — 동명이인(신청 2건 이상), 중복입금(입금 2건 이상),
// 미확인(입금 0건) 등 애매한 경우는 전부 manual_review로 남겨 기존 관리자 수동 승인
// 대기열이 그대로 안전망 역할을 한다.
//
// depositorName은 예금주 실명(users.depositor_real_name/bank_transfer_requests.
// depositor_real_name) 기준 — 2026-07-09 이전 신청 건은 이 필드가 없어 null일 수 있고,
// 그런 신청은 매칭 근거 자체가 없으므로 그룹핑에 섞지 않고 바로 manual_review로 분리한다
// (null끼리 그룹핑되면 "동명이인 충돌"처럼 잘못 보고될 수 있어 별도 처리).

export interface PendingPaymentRequest {
  id:            string;
  amount:        number;
  depositorName: string | null;
  requestedAt:   string; // ISO — 이 시각 이후 입금만 매칭 대상(신청 전 입금 오매칭 방지)
}

export interface CodefDeposit {
  resAccountTrDate: string; // YYYYMMDD
  resAccountTrTime: string; // HHMMSS
  resAccountIn:     string; // 입금액(문자열) — "0"이면 입금 아님
  resAccountDesc3:  string; // 적요 — 입금자 입력 텍스트(비어있으면 계좌주명 자동)
}

export type MatchDecision =
  | {
      requestId:  string;
      decision:   'auto_approve';
      depositKey: string;
      reason:     string;
    }
  | {
      requestId:      string;
      decision:       'manual_review';
      reason:         string;
      candidateCount: number;
    };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// CODEF는 거래일시를 한국 표준시(KST) 기준 로컬 시각으로 반환한다.
export function depositTimestamp(d: CodefDeposit): Date {
  const y   = Number(d.resAccountTrDate.slice(0, 4));
  const mon = Number(d.resAccountTrDate.slice(4, 6));
  const day = Number(d.resAccountTrDate.slice(6, 8));
  const hh  = Number(d.resAccountTrTime.slice(0, 2));
  const mm  = Number(d.resAccountTrTime.slice(2, 4));
  const ss  = Number(d.resAccountTrTime.slice(4, 6));
  const utcMs = Date.UTC(y, mon - 1, day, hh, mm, ss) - KST_OFFSET_MS;
  return new Date(utcMs);
}

// 감사 로그/추적용 자연키 — CODEF 응답에 별도 거래 고유ID가 없어 (일자+시각+금액)으로 대체.
export function depositKey(d: CodefDeposit): string {
  return `${d.resAccountTrDate}_${d.resAccountTrTime}_${d.resAccountIn}`;
}

export function matchPendingPayments(
  requests: PendingPaymentRequest[],
  deposits: CodefDeposit[],
): MatchDecision[] {
  const realDeposits = deposits.filter((d) => Number(d.resAccountIn) > 0);

  const groupKey = (amount: number, name: string) => `${amount}|${normalizeName(name)}`;

  const depositsByKey = new Map<string, CodefDeposit[]>();
  for (const d of realDeposits) {
    const key = groupKey(Number(d.resAccountIn), d.resAccountDesc3);
    const list = depositsByKey.get(key);
    if (list) list.push(d); else depositsByKey.set(key, [d]);
  }

  const results: MatchDecision[] = [];

  // 예금주 실명이 없는 신청 — 매칭 근거 자체가 없으므로 그룹핑 없이 즉시 manual_review
  const namedRequests: (PendingPaymentRequest & { depositorName: string })[] = [];
  for (const r of requests) {
    if (!r.depositorName || !r.depositorName.trim()) {
      results.push({
        requestId:      r.id,
        decision:       'manual_review',
        reason:         '예금주 실명 미입력 — 자동 매칭 불가(마이페이지에서 등록 후 다음 주기부터 적용)',
        candidateCount: 0,
      });
      continue;
    }
    namedRequests.push(r as PendingPaymentRequest & { depositorName: string });
  }

  const requestsByKey = new Map<string, (PendingPaymentRequest & { depositorName: string })[]>();
  for (const r of namedRequests) {
    const key = groupKey(r.amount, r.depositorName);
    const list = requestsByKey.get(key);
    if (list) list.push(r); else requestsByKey.set(key, [r]);
  }

  for (const [key, reqList] of requestsByKey) {
    const allDepositsForKey = depositsByKey.get(key) ?? [];

    for (const req of reqList) {
      const validDeposits = allDepositsForKey.filter(
        (d) => depositTimestamp(d).getTime() >= new Date(req.requestedAt).getTime(),
      );

      if (reqList.length === 1 && validDeposits.length === 1) {
        const deposit = validDeposits[0];
        results.push({
          requestId:  req.id,
          decision:   'auto_approve',
          depositKey: depositKey(deposit),
          reason:     `금액 ${req.amount}원 + 적요 "${req.depositorName}" 유니크 매칭 ` +
                      `(거래일시 ${deposit.resAccountTrDate} ${deposit.resAccountTrTime})`,
        });
      } else if (validDeposits.length === 0) {
        results.push({
          requestId:      req.id,
          decision:       'manual_review',
          reason:         '조건에 맞는 입금 내역 없음 (미입금 또는 적요 이름 불일치)',
          candidateCount: 0,
        });
      } else {
        results.push({
          requestId:      req.id,
          decision:       'manual_review',
          reason:         `동일 금액+적요 조합 — 신청 ${reqList.length}건 / 입금 ${validDeposits.length}건으로 ` +
                          `유니크하지 않음(동명이인 또는 중복입금 가능성)`,
          candidateCount: validDeposits.length,
        });
      }
    }
  }

  return results;
}
