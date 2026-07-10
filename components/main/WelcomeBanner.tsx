'use client';

// 가입 후 7일 이내이면서 /welcome을 아직 안 본 유저에게만 뜨는 안내 배너.
// 강제 리다이렉트 대신 완전히 선택적으로 /welcome을 둘러볼 수 있게 하는 보조
// 진입점 — has_seen_welcome 컬럼을 그대로 재활용한다. Hero의 AI 진단 카드
// 바로 아래(스크롤 없이 보이는 영역)에 배치해 눈에 띄게 한다.
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
    <div className="max-w-2xl mx-auto mb-10">
      <div className="group welcome-banner-border p-px rounded-2xl transition-transform duration-300 hover:-translate-y-0.5">
        <div className="relative flex items-center gap-3 rounded-[15px] bg-[#0d0f1a]/95 backdrop-blur-sm px-5 py-3.5">
          <Link href="/welcome" className="flex items-center gap-3 flex-1 min-w-0">
            <span className="relative flex items-center justify-center w-9 h-9 rounded-full bg-indigo-500/15 border border-indigo-500/30 shrink-0">
              <Sparkles className="w-4.5 h-4.5 text-indigo-300" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400" />
              </span>
            </span>
            <span className="text-[13.5px] text-left leading-snug">
              <span className="text-white font-semibold">fpark가 처음이신가요?</span>{' '}
              <span className="text-indigo-300">요금제별로 뭘 할 수 있는지 확인해보세요</span>{' '}
              <span className="text-indigo-400 transition-transform duration-200 inline-block group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
          <button
            onClick={dismiss}
            className="text-slate-500 hover:text-slate-300 cursor-pointer shrink-0 p-1 -mr-1"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
