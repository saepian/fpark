export function isKoreanMarketOpen(): boolean {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}

// 오늘(KST) 기준 거꾸로 최대 maxCandidates개의 "평일" 후보 날짜를 생성한다.
// 공휴일 캘린더가 없으므로 요일만으로 후보를 만들고, 실제 거래일 여부(공휴일 스킵)는
// 호출 측이 KIS 응답이 비어있지 않은지로 판별한다 (findFirstNonEmptyByDate 참고).
export function getTradingDateCandidates(maxCandidates = 7): { yyyymmdd: string; label: string }[] {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const fmtLabel = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  const day     = kst.getDay();
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  const includeToday = day >= 1 && day <= 5 && minutes >= 15 * 60 + 30;

  const candidates: { yyyymmdd: string; label: string }[] = [];
  const cursor = new Date(kst);
  if (!includeToday) cursor.setDate(cursor.getDate() - 1);

  while (candidates.length < maxCandidates) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
      candidates.push({ yyyymmdd: fmt(cursor), label: fmtLabel(cursor) });
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return candidates;
}

// 가장 최근 완료된 거래일 반환 (주말 건너뜀, 공휴일은 미지원) — 표시용 라벨
// (prevDateLabel 등)에만 사용. 날짜 파라미터 결정에는 getTradingDateCandidates()와
// findFirstNonEmptyByDate()를 사용할 것.
export function getLastTradingDate(): { yyyymmdd: string; label: string } {
  return getTradingDateCandidates(1)[0];
}

// 후보 날짜를 순서대로 시도해, 응답이 비어있지 않은 첫 날짜를 채택한다.
// fetcher가 던지는 예외는 "그 날짜는 데이터 없음"으로 간주하고 다음 후보로 넘어간다.
export async function findFirstNonEmptyByDate<T>(
  candidates: { yyyymmdd: string; label: string }[],
  fetcher: (yyyymmdd: string) => Promise<T[]>,
): Promise<{ date: string; label: string; rows: T[] } | null> {
  for (const { yyyymmdd, label } of candidates) {
    try {
      const rows = await fetcher(yyyymmdd);
      if (rows.length > 0) return { date: yyyymmdd, label, rows };
    } catch {
      // 다음 후보로 재시도
    }
  }
  return null;
}
