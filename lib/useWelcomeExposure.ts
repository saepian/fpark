'use client';

// /welcome 안내를 "큰 배너"로 보여줄지 "작은 링크"로 보여줄지 판단하는 공용 훅.
// components/main/WelcomeBanner.tsx(큰 배너)와 components/WelcomeLink.tsx(작은 링크)가
// 이 훅을 같이 써서 둘이 동시에 뜨는 일이 없게 한다.
//
// 규칙:
// - 비로그인 방문자: 'small' (큰 배너는 로그인 유저 전용 정보라 안 보여줌)
// - has_seen_welcome=false && 가입 7일 이내: 'big'
// - 그 외(이미 닫았거나 방문했거나, 7일이 지남): 'small'
// - 7일이 지났는데 아직 has_seen_welcome이 false인 경우, 여기서 발견되는 즉시
//   서버에 true로 기록해서 다음부터는 재조회 없이도 항상 'small'로 안정적으로
//   고정되게 한다.
//
// 큰 배너(WelcomeBanner)와 작은 링크(WelcomeLink)는 서로 다른 컴포넌트 인스턴스라
// 각자 이 훅을 독립적으로 호출한다 — 배너의 닫기 버튼을 눌러도 링크 쪽 훅은
// 그 사실을 모르기 때문에, 같은 탭 안에서 즉시 전환되도록 커스텀 이벤트로
// "지금부터 small"임을 모든 인스턴스에 방송한다.

import { useEffect, useState } from 'react';
import { useSession } from '@/lib/useSession';
import { createClient } from '@/lib/supabase-browser';

export type WelcomeExposure = 'loading' | 'big' | 'small';

const VISIBLE_WINDOW_DAYS = 7;
const DISMISS_EVENT = 'fpark:welcome-dismissed';

export function notifyWelcomeDismissed() {
  window.dispatchEvent(new Event(DISMISS_EVENT));
}

export function useWelcomeExposure(): WelcomeExposure {
  const { user, loading: sessionLoading } = useSession();
  const [exposure, setExposure] = useState<WelcomeExposure>('loading');

  useEffect(() => {
    const handler = () => setExposure('small');
    window.addEventListener(DISMISS_EVENT, handler);
    return () => window.removeEventListener(DISMISS_EVENT, handler);
  }, []);

  useEffect(() => {
    if (sessionLoading) { setExposure('loading'); return; }
    if (!user) { setExposure('small'); return; }

    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('users')
        .select('has_seen_welcome, created_at')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;

      if (!data || data.has_seen_welcome) { setExposure('small'); return; }

      const createdAt = data.created_at ? new Date(data.created_at).getTime() : 0;
      const withinWindow = Date.now() - createdAt < VISIBLE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

      if (withinWindow) {
        setExposure('big');
      } else {
        setExposure('small');
        fetch('/api/welcome', { method: 'POST' }).catch(() => {});
      }
    })();

    return () => { cancelled = true; };
  }, [user, sessionLoading]);

  return exposure;
}
