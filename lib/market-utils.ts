export function isKoreanMarketOpen(): boolean {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}

// 가장 최근 완료된 거래일 반환 (주말 건너뜀, 공휴일은 미지원)
// 평일 15:30 이후 → 오늘 / 그 외 → 직전 평일
export function getLastTradingDate(): { yyyymmdd: string; label: string } {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const fmtLabel = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  const day     = kst.getDay();
  const minutes = kst.getHours() * 60 + kst.getMinutes();

  if (day >= 1 && day <= 5 && minutes >= 15 * 60 + 30) {
    return { yyyymmdd: fmt(kst), label: fmtLabel(kst) };
  }

  const d = new Date(kst);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return { yyyymmdd: fmt(d), label: fmtLabel(d) };
}
