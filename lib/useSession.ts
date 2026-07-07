'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-browser';

// 로컬에 남아있던 세션(쿠키/스토리지)이 가리키는 계정이 서버에서 이미
// 삭제/무효화된 경우 — getUser()의 error가 채워진다. 이 상태를 방치하면
// 새로고침해도 계속 "로그인된 것처럼" 보이므로, signOut()으로 로컬
// 세션 흔적을 완전히 지우고 관련 로컬스토리지 키도 함께 정리한다.
async function clearInvalidSession(supabase: ReturnType<typeof createClient>) {
  try {
    await supabase.auth.signOut();
  } catch {
    // 이미 무효한 세션이라 signOut 자체가 실패해도 무시 — 아래 수동 정리로 커버.
  }
  if (typeof window !== 'undefined') {
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith('sb-') && key.includes('auth-token'))
        .forEach((key) => window.localStorage.removeItem(key));
    } catch {}
  }
}

// 클라이언트 컴포넌트에서 로그인 세션 유무를 확인하는 공용 훅.
// getSession()은 로컬에 저장된 토큰을 서버 검증 없이 그대로 돌려주므로 쓰지 않는다.
// getUser()는 매번 Supabase 서버에 실제로 물어보기 때문에, 계정이 삭제된 뒤에도
// 로컬 세션이 남아있는 상황(강력 새로고침으로도 안 지워짐)을 정확히 잡아낼 수 있다.
export function useSession(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const verify = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (cancelled) return;
        if (error) {
          // 세션은 있지만(로컬에 토큰 존재) 서버 검증에서 거부된 경우 —
          // 삭제된 계정이거나 무효화된 토큰. 즉시 로컬 세션을 정리한다.
          await clearInvalidSession(supabase);
          setUser(null);
        } else {
          setUser(data.user);
        }
      } catch {
        // 네트워크 오류 등으로 요청 자체가 실패한 경우는 일시적 문제일 수 있으므로
        // 로그인 상태를 강제로 초기화하지 않는다(불안정한 네트워크로 인한 오탐 로그아웃 방지).
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    verify();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION') return; // verify()가 이미 처리함
      if (event === 'SIGNED_OUT') {
        setUser(null);
        return;
      }
      // SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED 등은 로컬 이벤트 데이터를
      // 그대로 신뢰하지 않고 다시 서버에 확인한다.
      verify();
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
