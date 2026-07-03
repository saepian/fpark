'use client';
import { createBrowserClient } from '@supabase/ssr';

type Client = ReturnType<typeof createBrowserClient>;

// NEXT_PUBLIC_SUPABASE_URL이 빌드 시 없으면 createBrowserClient가 즉시 throw한다.
// 컴포넌트 본체에서 const supabase = createClient()로 선언해도
// supabase.xxx 접근은 항상 useEffect / 이벤트 핸들러(브라우저 전용)에서만 발생하므로,
// 환경변수가 없을 때는 Proxy를 반환해 SSR 렌더 단계에서의 throw를 막는다.
export const createClient = (): Client => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return new Proxy({} as Client, {
      get(_, prop, receiver) {
        // 실제 접근 시 환경변수가 설정돼 있어야 한다 (프로덕션에서는 항상 설정됨).
        throw new Error(
          `[supabase-browser] 환경변수 미설정 — prop: ${String(prop)}. vercel env pull .env.local 을 실행하세요.`,
        );
      },
    });
  }

  return createBrowserClient(url, key, { auth: { flowType: 'implicit' } });
};
