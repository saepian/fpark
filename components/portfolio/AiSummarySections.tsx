'use client';

import type { RevealedField } from '@/lib/useSmoothTypingText';

// 포트폴리오 "AI 종합 평가" 소제목 블록 — 포트폴리오분석 메인(app/portfolio-diagnosis/page.tsx),
// 공유 페이지(app/share/[id]/page.tsx), 대시보드(app/dashboard/page.tsx) 3곳이 2026-09-01까지
// 각자 손복제한 렌더링 로직을 하나로 모았다(대시보드가 옛 뉴스 중심 스키마에 남아 있던 원인도
// 이 손복제였다). 스키마 판별·라벨·타이핑 효과·스켈레톤 정책은 전부 여기서만 정한다.
//
// v2(2026-09-01, 포트폴리오 구조 중심): structure/concentration/pnlStructure/judgment
// v1(2026-09-01 이전 저장 리포트·공유 스냅샷·대시보드 당일 캐시): background/newsInterpretation/
//   historicalComparison/judgment — v1 필드가 하나라도 채워져 있으면 옛 소제목으로 그린다.
//   스트리밍 중엔 v2 키만 도착하므로 새 리포트는 항상 v2로 그려진다.

export interface AiSummarySectionsData {
  structure?: string; concentration?: string; pnlStructure?: string;
  background?: string; newsInterpretation?: string; historicalComparison?: string;
  judgment?: string;
}

export interface SummaryBlock { key: string; label: string; text: string }

// 스트리밍 키(lib/streaming-json-fields.ts PORTFOLIO_SUMMARY_FIELD_SPECS의 summarySections_*)를
// 객체 필드명으로 되돌리는 매핑 — 페이지의 applyPortfolioField가 공통으로 쓴다.
export const SUMMARY_SECTION_KEYS: Record<string, keyof AiSummarySectionsData> = {
  summarySections_structure: 'structure',
  summarySections_concentration: 'concentration',
  summarySections_pnlStructure: 'pnlStructure',
  summarySections_background: 'background',
  summarySections_newsInterpretation: 'newsInterpretation',
  summarySections_historicalComparison: 'historicalComparison',
  summarySections_judgment: 'judgment',
};

export function isLegacySummarySections(s: AiSummarySectionsData): boolean {
  return !!(s.background || s.newsInterpretation || s.historicalComparison);
}

export function hasAnySummarySection(s: AiSummarySectionsData | undefined | null): boolean {
  return !!s && Object.values(s).some(Boolean);
}

export function summarySectionBlocks(s: AiSummarySectionsData): SummaryBlock[] {
  return isLegacySummarySections(s)
    ? [
        { key: 'summarySections_background',           label: '구조적 배경',   text: s.background ?? '' },
        { key: 'summarySections_newsInterpretation',    label: '뉴스 해석',     text: s.newsInterpretation ?? '' },
        { key: 'summarySections_historicalComparison',  label: '과거 유사 이력', text: s.historicalComparison ?? '' },
        { key: 'summarySections_judgment',              label: '종합 판단',     text: s.judgment ?? '' },
      ]
    : [
        { key: 'summarySections_structure',     label: '포트폴리오 구조', text: s.structure ?? '' },
        { key: 'summarySections_concentration', label: '집중·분산도',     text: s.concentration ?? '' },
        { key: 'summarySections_pnlStructure',  label: '손익 기여 구조',  text: s.pnlStructure ?? '' },
        { key: 'summarySections_judgment',      label: '종합 판단',       text: s.judgment ?? '' },
      ];
}

function TypingCursor() {
  return <span className="ml-0.5 text-indigo-300 animate-pulse font-light">▌</span>;
}

function FieldSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="space-y-1.5 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-slate-700/40" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

// streamFinished=false 동안은 아직 비어 있는 소제목 자리에 스켈레톤을, 완료 후에도 비어 있으면
// (선택 필드 — 예: 1종목이라 집중·분산도가 없는 경우) 그 소제목을 아예 숨긴다. revealed가
// 없으면(공유 페이지 등 정적 렌더링) 텍스트를 그대로 보여준다.
export default function AiSummarySections({
  sections,
  revealed,
  streamFinished = true,
}: {
  sections: AiSummarySectionsData;
  revealed?: Record<string, RevealedField>;
  streamFinished?: boolean;
}) {
  const blocks = summarySectionBlocks(sections);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((b) => (
        b.text ? (
          <div key={b.key}>
            <p className="text-[11px] font-bold text-indigo-400/70 uppercase tracking-wide mb-1">{b.label}</p>
            <p className="text-xs text-slate-300" style={{ lineHeight: 1.8 }}>
              {revealed?.[b.key]?.text ?? b.text}{revealed?.[b.key]?.active && <TypingCursor />}
            </p>
          </div>
        ) : !streamFinished ? (
          <div key={b.key}>
            <p className="text-[11px] font-bold text-indigo-400/70 uppercase tracking-wide mb-1">{b.label}</p>
            <FieldSkeleton lines={2} />
          </div>
        ) : null
      ))}
    </div>
  );
}
