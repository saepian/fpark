'use client';

// 가입 후 7일 이내이면서 /welcome을 아직 안 본 유저에게만 뜨는 얇은 안내 배너.
// 강제 리다이렉트(과거 lib/post-auth-redirect.ts에 있었음) 대신 완전히 선택적으로
// /welcome을 둘러볼 수 있게 하는 보조 진입점 — has_seen_welcome 컬럼을 그대로 재활용한다.
// 닫기(×)를 누르면 app/api/welcome/route.ts를 그대로 호출해 has_seen_welcome을
// true로 갱신하므로, /welcome 방문으로 닫히는 것과 동일하게 재노출되지 않는다.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const VISIBLE_WINDOW_DAYS = 7;

export default function WelcomeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('users')
        .select('has_seen_welcome, created_at')
        .eq('id', user.id)
        .maybeSingle();
      if (!data || data.has_seen_welcome) return;

      const createdAt = data.created_at ? new Date(data.created_at).getTime() : 0;
      const withinWindow = Date.now() - createdAt < VISIBLE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (withinWindow) setVisible(true);
    })();
  }, []);

  const dismiss = () => {
    setVisible(false);
    fetch('/api/welcome', { method: 'POST' }).catch(() => {});
  };

  if (!visible) return null;

  return (
    <div className="max-w-[1400px] mx-auto px-6 pt-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] px-4 py-2.5">
        <Link
          href="/welcome"
          className="flex items-center gap-2 text-[13px] text-indigo-300 hover:text-indigo-200 transition-colors min-w-0"
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">fpark가 처음이신가요? 요금제별로 뭘 할 수 있는지 확인해보세요 →</span>
        </Link>
        <button
          onClick={dismiss}
          className="text-slate-500 hover:text-slate-300 cursor-pointer shrink-0"
          aria-label="닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
