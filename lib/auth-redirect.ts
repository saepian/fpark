// 로그인 후 원래 가려던 페이지로 돌아가기 위한 redirect 경로 검증/생성 유틸.
// 클라이언트 컴포넌트와 서버 라우트 핸들러 양쪽에서 공용으로 사용.

// 오픈 리다이렉트 방지: "/"로 시작하되 "//"(프로토콜 상대경로) 또는
// "/\"(일부 브라우저가 "//"로 취급)로 시작하는 값은 외부 도메인 이동으로
// 악용될 수 있어 거부하고 기본값('/')으로 대체한다.
//
// /auth/login·/auth/signup 자체를 가리키는 값도 거부한다 — 어딘가에서 실수로
// loginUrlWithRedirect('/auth/login')처럼 자기 자신을 redirect 대상으로 넘기면,
// 로그인 성공 후 다시 /auth/login으로 돌아와 "로그인했는데 로그인 페이지에
// 그대로 머무는" 것처럼 보이는 자기참조 루프가 생긴다.
export function sanitizeRedirect(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (raw === '/auth/login' || raw.startsWith('/auth/login?') || raw.startsWith('/auth/login/')) return '/';
  if (raw === '/auth/signup' || raw.startsWith('/auth/signup?') || raw.startsWith('/auth/signup/')) return '/';
  return raw;
}

export function loginUrlWithRedirect(path: string): string {
  const safe = sanitizeRedirect(path);
  return safe === '/' ? '/auth/login' : `/auth/login?redirect=${encodeURIComponent(safe)}`;
}
