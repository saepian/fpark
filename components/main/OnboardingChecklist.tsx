'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

interface OnboardingState {
  shouldShow: boolean;
  requiredComplete: boolean;
  watchlistAdded: boolean;
  reportViewed: boolean;
  alertEnabled: boolean;
  portfolioAdded: boolean;
}

interface ChecklistItem {
  key: string;
  label: string;
  href: string;
  done: boolean;
  optional?: boolean;
}

const CELEBRATION_MS = 2200;

function persistDismiss() {
  fetch('/api/onboarding', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dismissed: true }),
  }).catch(() => {});
}

export default function OnboardingChecklist() {
  const [state, setState]           = useState<OnboardingState | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [hidden, setHidden]         = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
      fetch('/api/onboarding')
        .then((r) => {
          if (!r.ok) {
            // 조용히 숨기는 대신 콘솔에는 남겨서 "그냥 안 보임" 상태를 디버깅할 수 있게 함
            console.error(`[OnboardingChecklist] /api/onboarding 응답 실패: ${r.status}`);
            return null;
          }
          return r.json();
        })
        .then((json: OnboardingState | null) => {
          if (cancelled || !json || !json.shouldShow) return;
          setState(json);
          if (json.requiredComplete) {
            // 이미 필수 3항목을 모두 마친 채로 처음 대시보드에 진입한 경우 —
            // 짧게 축하 메시지를 보여준 뒤 dismissed로 저장해 다시 뜨지 않게 한다.
            setCelebrating(true);
            setTimeout(() => {
              if (cancelled) return;
              setHidden(true);
              persistDismiss();
            }, CELEBRATION_MS);
          }
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = () => {
    setHidden(true);
    persistDismiss();
  };

  if (!state || hidden) return null;

  const items: ChecklistItem[] = [
    { key: 'watchlist', label: '관심종목 3개 추가하기',        href: '/market/domestic',              done: state.watchlistAdded },
    { key: 'report',    label: '첫 AI 진단 리포트 받아보기',     href: '/diagnosis',                    done: state.reportViewed },
    { key: 'alert',     label: '알림 켜기 (이메일 또는 앱)',    href: '/mypage#notification-settings', done: state.alertEnabled },
    { key: 'portfolio', label: '포트폴리오 등록하기',           href: '/portfolio-diagnosis',           done: state.portfolioAdded, optional: true },
  ];

  const requiredItems = items.filter((i) => !i.optional);
  const doneCount     = requiredItems.filter((i) => i.done).length;

  return (
    <div
      className="relative rounded-2xl border border-indigo-500/25 p-5 md:p-6 mb-6"
      style={{
        background: 'linear-gradient(135deg, rgba(79,70,229,0.10) 0%, rgba(124,58,237,0.05) 100%), #0d1117',
      }}
    >
      {/* 닫기 버튼 */}
      <button
        onClick={handleDismiss}
        aria-label="닫기"
        className="absolute top-3.5 right-3.5 w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>

      {celebrating ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-[15px] font-bold text-white">모두 완료했어요!</p>
          <p className="text-[12px] text-slate-400 mt-1">이제 fpark를 200% 활용할 준비가 됐습니다</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-1 pr-8">
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            <p className="text-[13.5px] font-bold text-white">시작하기 체크리스트</p>
            <span className="text-[11px] font-mono text-indigo-300/80 ml-auto">
              {doneCount}/{requiredItems.length}
            </span>
          </div>
          <p className="text-[11.5px] text-slate-500 mb-4">아래 항목을 완료하고 fpark를 시작해보세요</p>

          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={[
                  'flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors group',
                  item.done ? 'bg-slate-800/25' : 'bg-slate-800/60 hover:bg-slate-800',
                ].join(' ')}
              >
                <span
                  className={[
                    'shrink-0 w-5 h-5 rounded-full flex items-center justify-center border transition-colors',
                    item.done ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600 group-hover:border-indigo-400',
                  ].join(' ')}
                >
                  {item.done && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <span
                  className={[
                    'text-[13px] flex-1 min-w-0 truncate',
                    item.done ? 'text-slate-500 line-through' : 'text-slate-200 font-medium',
                  ].join(' ')}
                >
                  {item.label}
                </span>
                {item.optional && !item.done && (
                  <span className="shrink-0 text-[10px] text-slate-600">선택</span>
                )}
                {!item.done && (
                  <span className="shrink-0 text-slate-600 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all text-xs">
                    →
                  </span>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
