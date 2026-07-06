'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-browser';

// 클라이언트 컴포넌트에서 로그인 세션 유무를 확인하는 공용 훅.
// 초기값은 null(비로그인 취급) — getUser() 응답 전까지는 랜딩페이지 쪽 UI를 기본으로 둔다.
export function useSession(): User | null {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  return user;
}
