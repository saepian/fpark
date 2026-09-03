'use client';

import { Bookmark, BookmarkCheck } from 'lucide-react';

export interface SaveReportButtonProps {
  saved: boolean;
  saving?: boolean;
  onToggle: () => void;
  className?: string;
}

// 기업분석/포트폴리오분석 리포트 화면 상단/하단 2곳에서 같은 saved/onToggle을 props로
// 받아 쓰는 순수 프레젠테이션 버튼 — 상태 자체는 lib/useSaveReport.ts가 페이지 레벨에서
// 한 번만 관리하므로 위/아래 버튼이 항상 같은 상태를 보여준다(2026-09-03).
export default function SaveReportButton({ saved, saving = false, onToggle, className = '' }: SaveReportButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={saving}
      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-[11px] font-semibold tracking-wide
        transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait ${
        saved
          ? 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40 text-amber-300'
          : 'bg-slate-700/40 hover:bg-slate-700/60 border-slate-600/50 text-slate-300'
      } ${className}`}
    >
      {saved ? <BookmarkCheck className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
      {saved ? '저장됨' : '저장'}
    </button>
  );
}
