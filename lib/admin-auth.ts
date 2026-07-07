// 관리자 계정 판별 — app/api/diagnosis, app/api/portfolio-diagnosis에서 쓰던
// `user.email === process.env.ADMIN_EMAIL` 패턴을 공용 함수로 추출.
export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email === process.env.ADMIN_EMAIL;
}
