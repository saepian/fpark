// "직전 기업분석 대비" 카드의 보조 문구(2026-08-28 델타박스 재설계에서 만든 상태 분기 로직).
// 예전엔 components/diagnosis/DiagnosisReport.tsx와 app/share/[id]/page.tsx에 손복제돼 있었는데,
// 2026-09-02 실화면(S-Oil 개장 전 생성)에서 변화량이 정확히 0(+0.00%p, +0원)인데도 "늘며 수익
// 폭이 커졌습니다"로 나오는 버그가 발견돼 여기 한 곳으로 모으고 "동일" 분기를 추가했다.
//
// 분기표(그때 상태 × 지금 상태 × 델타 방향):
//   수익→수익  증가 "늘며 수익 폭이 커졌습니다" / 감소 "줄었지만 여전히 수익 구간" / 동일 "동일한 수준(수익 구간 유지)"
//   손실→손실  악화 "손실 폭이 커졌습니다" / 회복 "손실 폭이 줄었지만 여전히 손실 구간" / 동일 "동일한 수준(손실 구간 유지)"
//   수익→손실 "손실로 전환" / 손실→수익 "수익으로 전환" (전환은 델타가 0일 수 없음)
//
// "동일"은 화면에 찍히는 자릿수 기준으로 판정한다 — 수익률은 소수 2자리(%p), 금액은 원 단위
// 반올림. 둘 다 0으로 표시될 때만 동일이고, 하나라도 0이 아니면 그 부호를 따른다(수익률이 0.00%p로
// 표시되는데 금액만 몇백 원 움직인 큰 포지션은 금액 부호 기준 증감으로 서술).

export function isFlatDelta(rateDelta: number, amountDelta: number): boolean {
  return Number(rateDelta.toFixed(2)) === 0 && Math.round(amountDelta) === 0;
}

export function buildStateSentence(prevRate: number, rateDelta: number, amountDelta: number): string {
  const prevProfit = prevRate >= 0;
  const currProfit = prevRate + rateDelta >= 0;
  const rateStr   = `${rateDelta >= 0 ? '+' : ''}${rateDelta.toFixed(2)}%p`;
  const amountStr = `${amountDelta >= 0 ? '+' : ''}${Math.round(amountDelta).toLocaleString()}원`;
  const deltaTxt  = `직전 대비 ${rateStr}(${amountStr})`;

  if (prevProfit && !currProfit) return `${deltaTxt} — 직전 수익 구간에서 손실로 전환됐습니다.`;
  if (!prevProfit && currProfit) return `${deltaTxt} — 직전 손실 구간에서 수익으로 전환됐습니다.`;

  if (isFlatDelta(rateDelta, amountDelta)) {
    return `${deltaTxt} — 직전 진단과 동일한 수준입니다(${prevProfit ? '수익' : '손실'} 구간 유지).`;
  }
  // 표시 자릿수에서 수익률이 0.00%p여도 금액이 움직였으면 금액 부호로 방향을 정한다
  const up = Number(rateDelta.toFixed(2)) !== 0 ? rateDelta > 0 : amountDelta > 0;
  if (prevProfit) {
    return up
      ? `${deltaTxt} 늘며 수익 폭이 커졌습니다.`
      : `${deltaTxt} 줄었지만, 여전히 수익 구간입니다.`;
  }
  return up
    ? `${deltaTxt} — 손실 폭이 줄었지만, 여전히 손실 구간입니다.`
    : `${deltaTxt} — 손실 폭이 커졌습니다.`;
}
