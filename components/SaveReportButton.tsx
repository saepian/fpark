'use client';

import { Bookmark, BookmarkCheck } from 'lucide-react';

export interface SaveReportButtonProps {
  saved: boolean;
  saving?: boolean;
  onToggle: () => void;
  className?: string;
  // 2026-09-03: 상단(SHARE/PRINT REPORT와 나란히, 컴팩트한 유틸리티 행)과 하단("다시
  // 기업 분석 받기"/"다시 분석받기"와 나란히, 화면 중앙의 큰 CTA 행)은 애초에 시각적
  // 위계가 달라 같은 크기를 쓰면 오히려 어색하다 — 짝을 이루는 버튼과 크기를 맞추도록
  // 두 사이즈를 제공한다. 기본값 'sm'은 기존 top-bar 스타일 그대로(회귀 없음).
  size?: 'sm' | 'md';
}

const SIZE_CLASSES: Record<NonNullable<SaveReportButtonProps['size']>, string> = {
  sm: 'gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-semibold tracking-wide',
  // "다시 기업 분석 받기"(DiagnosisReport.tsx)/"다시 분석받기"(portfolio-diagnosis/page.tsx)
  // 버튼과 정확히 같은 px-6 py-3 rounded-xl text-[13px] — 하단 CTA 행에서 짝을 맞춘다.
  md: 'gap-2 px-6 py-3 rounded-xl text-[13px]',
};

// 기업분석/포트폴리오분석 리포트 화면 상단/하단 2곳에서 같은 saved/onToggle을 props로
// 받아 쓰는 순수 프레젠테이션 버튼 — 상태 자체는 lib/useSaveReport.ts가 페이지 레벨에서
// 한 번만 관리하므로 위/아래 버튼이 항상 같은 상태를 보여준다(2026-09-03).
export default function SaveReportButton({ saved, saving = false, onToggle, className = '', size = 'sm' }: SaveReportButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={saving}
      className={`flex items-center border transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait ${SIZE_CLASSES[size]} ${
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
