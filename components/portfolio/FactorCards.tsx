'use client';

import type { RevealedField } from '@/lib/useSmoothTypingText';

// 포트폴리오 보조 카드 2종 (2026-09-01 리포트 재편) — 메인·공유·대시보드 공용.
//  · IssueFactorsCard  : "종목별 개별 이슈" — 리스크/긍정 (각 종목 고유 요인만, 구조 수치 금지)
//  · WatchVariablesCard: "앞으로 확인할 이벤트·지표" — 단기/중기 (어떤 공시·지표가 나오면 구조가 바뀌는지)
// 예전엔 Risk/Opportunity Factors + 단기/중기 관찰 변수 4카드가 AI 종합평가의 수치(변동성 기여도·
// 상관계수·손익 비율)를 그대로 반복해 요약본처럼 보였다 — 프롬프트에서 역할을 갈랐고, 카드 제목도
// 그 역할대로 바꿨다. 렌더링 정책은 세 화면이 같다: 값이 undefined이고 pending이면 스켈레톤,
// 도착했는데 비어 있으면 그 칸을 조용히 생략(확정된 부재), 둘 다 비어 있으면 카드 전체 생략.

export type RiskFactorEntry = string | { text: string; category?: 'macro' | 'company' };

function FieldSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="space-y-1.5 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-slate-700/40" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}
function TypingCursor() {
  return <span className="ml-0.5 text-indigo-300 animate-pulse font-light">▌</span>;
}

const TITLE = 'px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider';

export function IssueFactorsCard({
  riskFactors,
  opportunityFactors,
  pending = false,
  className = '',
}: {
  riskFactors?: RiskFactorEntry[];
  opportunityFactors?: string[];
  pending?: boolean;       // Stage2 아직 진행 중(미도착이면 스켈레톤)
  className?: string;
}) {
  const showRisk = riskFactors === undefined ? pending : riskFactors.length > 0;
  const showOpp  = opportunityFactors === undefined ? pending : opportunityFactors.length > 0;
  if (!showRisk && !showOpp) return null;
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">종목별 개별 이슈</p>
      <p className="text-[11px] text-slate-500 leading-relaxed mb-4">각 종목 고유의 요인만 다룹니다 — 비중·집중도·변동성 기여 같은 구조 수치는 위 AI 종합 평가를 참고하세요.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {showRisk && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-4">
            <span className={`${TITLE} bg-red-500/15 border border-red-500/30 text-red-400 inline-block mb-3`}>리스크</span>
            {riskFactors === undefined ? <FieldSkeleton lines={3} /> : (
              <div className="flex flex-col gap-2">
                {riskFactors.map((item, i) => {
                  const text = typeof item === 'string' ? item : item.text;
                  const category = typeof item === 'string' ? undefined : item.category;
                  return (
                    <div key={i} className="flex gap-2">
                      <span className="text-red-500/60 text-[11px] mt-1 shrink-0">▶</span>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {category && (
                          <span className="mr-1.5 inline-block px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-400 text-[11px] font-bold uppercase tracking-wide align-middle">
                            {category === 'macro' ? '매크로' : '기업'}
                          </span>
                        )}
                        {text}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {showOpp && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4">
            <span className={`${TITLE} bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 inline-block mb-3`}>긍정 요인</span>
            {opportunityFactors === undefined ? <FieldSkeleton lines={3} /> : (
              <div className="flex flex-col gap-2">
                {opportunityFactors.map((line, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-emerald-500/60 text-[11px] mt-1 shrink-0">▶</span>
                    <p className="text-xs text-slate-300 leading-relaxed">{line}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function WatchVariablesCard({
  shortTermOutlook,
  midTermOutlook,
  pending = false,
  revealed,
  className = '',
  title = '앞으로 확인할 이벤트·지표',
  caption = '어떤 공시·지표·일정이 나오면 지금의 포트폴리오 구조에 영향을 줄 수 있는지 — 예측이 아니라 확인 목록입니다.',
}: {
  shortTermOutlook?: string;
  midTermOutlook?: string;
  pending?: boolean;
  revealed?: Record<string, RevealedField>;
  className?: string;
  title?: string;    // 2026-09-01: 기업분석 리포트도 같은 카드를 쓰므로 문구를 바꿔 끼울 수 있게
  caption?: string;
}) {
  const showShort = shortTermOutlook === undefined ? pending : !!shortTermOutlook;
  const showMid   = midTermOutlook === undefined ? pending : !!midTermOutlook;
  if (!showShort && !showMid) return null;
  const block = (key: 'shortTermOutlook' | 'midTermOutlook', label: string, value: string | undefined, tone: string) => (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <span className={`${TITLE} inline-block mb-3 ${key === 'shortTermOutlook' ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-400' : 'bg-violet-500/15 border border-violet-500/30 text-violet-400'}`}>{label}</span>
      {value === undefined ? <FieldSkeleton lines={2} /> : (
        <p className="text-xs text-slate-300 leading-relaxed">
          {revealed?.[key]?.text ?? value}{revealed?.[key]?.active && <TypingCursor />}
        </p>
      )}
    </div>
  );
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">{title}</p>
      <p className="text-[11px] text-slate-500 leading-relaxed mb-4">{caption}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {showShort && block('shortTermOutlook', '단기 (수주 내)', shortTermOutlook, 'border-indigo-500/20 bg-indigo-500/[0.03]')}
        {showMid   && block('midTermOutlook',   '중기 (수개월)',  midTermOutlook,   'border-violet-500/20 bg-violet-500/[0.03]')}
      </div>
    </div>
  );
}
