// 로그인 후 원래 가려던 페이지로 돌아가기 위한 redirect 경로 검증/생성 유틸.
// 클라이언트 컴포넌트와 서버 라우트 핸들러 양쪽에서 공용으로 사용.

// 오픈 리다이렉트 방지: "/"로 시작하되 "//"(프로토콜 상대경로) 또는
// "/\"(일부 브라우저가 "//"로 취급)로 시작하는 값은 외부 도메인 이동으로
// 악용될 수 있어 거부하고 기본값('/')으로 대체한다.
export function sanitizeRedirect(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

export function loginUrlWithRedirect(path: string): string {
  const safe = sanitizeRedirect(path);
  return safe === '/' ? '/auth/login' : `/auth/login?redirect=${encodeURIComponent(safe)}`;
}
