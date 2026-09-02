// 기업분석 리포트 공용 카드 묶음 (2026-09-01 전면 재편) — components/diagnosis/DiagnosisReport.tsx
// (메인, 스트리밍 타이핑 상태 포함)와 app/share/[id]/page.tsx(공유, 정적)가 같은 컴포넌트를 쓴다.
// 예전엔 "오늘의 기업 분석" 소제목 목록·기관/외국인 카드·단기/중기 카드가 두 파일에 손복제돼
// 한쪽만 고치면 드리프트가 났다. 순수 프레젠테이션(훅 없음)이라 서버 컴포넌트에서도 import 가능.
//
// 카드 단일역할 원칙(프롬프트 DIAGNOSIS_OUTPUT_INSTRUCTIONS와 짝):
//  · MainAnalysisCard      1층 — 주가 배경(원인 1개 + 개별/업종 판단) → 밸류에이션(PER/PBR 유일) → AI 종합 진단(판단만)
//  · InstitutionalFlowCard 3층 — 수급을 서술하는 유일한 카드(도넛 + 5일 캡션 + 해석 1문장 flowInsight)
//  · RiskFactorsCard       4층 — 종목 고유 이슈만(수급·PER·거래대금배수·MDD 금지)
//  · SurgeTradingRow       3층 — 급등락 이력이 있을 때만 별도 카드, 없으면 거래대금 카드 안 한 줄로 접음
import type { ReactNode } from 'react';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { stripFlowSubject } from '@/lib/flow-caption';
import type { RevealedField } from '@/lib/useSmoothTypingText';
import { SurgeHistoryCard, TradingValueMultipleCard, type SurgeHistory, type TradingValueMultiple } from '@/components/diagnosis/SurgeHistoryCard';

export function FieldSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="space-y-1.5 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-slate-700/40" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}
export function TypingCursor() {
  return <span className="ml-0.5 text-indigo-300 animate-pulse font-light">▌</span>;
}

// 스트리밍 텍스트 한 조각 — 값이 있으면 텍스트(+타이핑 커서), 아직 없고 생성 중이면 스켈레톤, 아니면 null.
export function StreamText({
  value, k, revealed, pending = false, lines = 2, className = 'text-xs text-slate-300 leading-relaxed', transform,
}: { value?: string; k: string; revealed?: Record<string, RevealedField>; pending?: boolean; lines?: number; className?: string; transform?: (s: string) => string }) {
  if (value) {
    const shown = revealed?.[k]?.text ?? value;
    return <p className={className}>{transform ? transform(shown) : shown}{revealed?.[k]?.active && <TypingCursor />}</p>;
  }
  return pending ? <FieldSkeleton lines={lines} /> : null;
}

export interface MainAnalysisSectionsData {
  background: string;
  valuationNote: string;
  watchPoint: string;
  flowSummary?: string; // 2026-09-01 이전 레코드에만 존재(수급 소제목 삭제) — 표시하지 않음
}

export const MAIN_ANALYSIS_BLOCKS = [
  { key: 'mainAnalysisSections_background',    field: 'background',    label: '오늘의 주가 배경' },
  { key: 'mainAnalysisSections_valuationNote', field: 'valuationNote', label: '밸류에이션' },
] as const;

// 1층 "한눈에" — 주가 배경 → 밸류에이션 → AI 종합 진단. sections가 없으면(과거 레코드/파싱 실패
// 폴백) mainAnalysis 문자열 한 문단.
export function MainAnalysisCard({
  sections, mainAnalysis, finalVerdict, revealed, isGenerating = false, className = '',
}: {
  sections?: MainAnalysisSectionsData | null;
  mainAnalysis: string;
  finalVerdict?: string;
  revealed?: Record<string, RevealedField>;
  isGenerating?: boolean;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-700/50 overflow-hidden ${className}`} style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}>
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
      <div className="p-6">
        <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest mb-4`}>오늘의 기업 분석</p>
        {sections ? (
          <div className="flex flex-col gap-3.5">
            {MAIN_ANALYSIS_BLOCKS.map((b) => {
              const text = sections[b.field];
              if (!text && !isGenerating) return null;
              return (
                <div key={b.key}>
                  <p className={`${SECTION_TITLE_CLASS} text-indigo-400/80 uppercase tracking-wide mb-1`}>{b.label}</p>
                  <StreamText value={text} k={b.key} revealed={revealed} pending={isGenerating} />
                </div>
              );
            })}
          </div>
        ) : isGenerating && !mainAnalysis ? (
          <div className="flex flex-col gap-3.5">
            {MAIN_ANALYSIS_BLOCKS.map((b) => (
              <div key={b.key}>
                <p className={`${SECTION_TITLE_CLASS} text-indigo-400/80 uppercase tracking-wide mb-1`}>{b.label}</p>
                <FieldSkeleton lines={2} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-300 leading-relaxed">{mainAnalysis}</p>
        )}
        {finalVerdict && (
          <div className="mt-5 pt-5 border-t border-slate-700/50">
            <p className="text-[11px] text-slate-500 uppercase tracking-wide mb-2">AI 종합 진단</p>
            <div className="bg-indigo-500/10 border-l-2 border-indigo-400/50 rounded-r-lg px-3 py-2.5">
              <StreamText value={finalVerdict} k="finalVerdict" revealed={revealed} className="text-xs text-slate-200 leading-relaxed" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function FlowDonut({ percent, type }: { percent: number; type: 'BUY' | 'SELL' | 'NEUTRAL' }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const filled = circ * (percent / 100);
  const color = type === 'BUY' ? '#10b981' : type === 'SELL' ? '#f87171' : '#94a3b8';
  const label = type === 'BUY' ? '자금 유입' : type === 'SELL' ? '자금 유출' : '중립';
  return (
    <svg width="148" height="148" viewBox="0 0 148 148">
      <circle cx="74" cy="74" r={r} fill="none" stroke="#1e293b" strokeWidth="14" />
      <circle cx="74" cy="74" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`} transform="rotate(-90 74 74)" style={{ filter: `drop-shadow(0 0 6px ${color}66)` }} />
      <text x="74" y="69" textAnchor="middle" fill={color} fontSize="22" fontWeight="800" fontFamily="monospace">{percent}%</text>
      <text x="74" y="88" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="600" letterSpacing="1">{label}</text>
    </svg>
  );
}

// 3층 "기관/외국인 동향" — 리포트에서 수급을 서술하는 유일한 자리. 도넛(오늘 강도) + 5일 캡션 +
// 해석 1문장(flowInsight, 2026-09-01 신설 — 예전 1층 "수급 동향" 소제목을 여기로 옮김).
export function InstitutionalFlowCard({
  flowType = 'NEUTRAL', flowPercentage = 50, flowInsight, institutionalFlow, foreignFlow, revealed, isGenerating = false, className = '',
}: {
  flowType?: 'BUY' | 'SELL' | 'NEUTRAL';
  flowPercentage?: number;
  flowInsight?: string;
  institutionalFlow?: string;
  foreignFlow?: string;
  revealed?: Record<string, RevealedField>;
  isGenerating?: boolean;
  className?: string;
}) {
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
          <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <p className={`${SECTION_TITLE_CLASS} text-slate-400 uppercase tracking-widest`}>기관/외국인 동향</p>
      </div>
      <p className="text-center text-[11px] font-bold tracking-wide text-slate-500 mb-2">오늘 수급 강도</p>
      <div className="flex flex-col items-center py-2">
        <FlowDonut percent={flowPercentage} type={flowType} />
        <p className="text-center text-[11px] text-slate-600 leading-snug mt-2">평소 거래대금 대비 이례적 쏠림 정도</p>
      </div>
      <div className="flex items-center gap-2.5 mt-4 mb-3">
        <span className="flex-1 h-px bg-slate-700/40" />
        <span className="text-[11px] font-bold tracking-wide text-slate-500 whitespace-nowrap">최근 5일 흐름</span>
        <span className="flex-1 h-px bg-slate-700/40" />
      </div>
      {/* 2026-09-02: 두 줄 다 "최근 5거래일 중 N일 순유입"처럼 나와 어느 줄이 기관/외국인인지 알 수 없던
          문제 — AI 캡션의 주어에 기대지 않고 카드가 라벨을 직접 붙인다(AI가 주어를 넣어도 stripFlowSubject로 정리). */}
      <div className="flex flex-col gap-1.5">
        {[
          { label: '기관',   value: institutionalFlow, k: 'institutionalFlow' },
          { label: '외국인', value: foreignFlow,       k: 'foreignFlow' },
        ].map(({ label, value, k }) => (
          (value || isGenerating) && (
            <div key={k} className="flex items-start gap-2">
              <span className="shrink-0 w-10 text-[11px] font-semibold text-slate-500 leading-relaxed">{label}</span>
              <div className="min-w-0 flex-1">
                <StreamText value={value} k={k} revealed={revealed} pending={isGenerating} lines={1} className="text-xs text-slate-400 leading-relaxed" transform={stripFlowSubject} />
              </div>
            </div>
          )
        ))}
      </div>
      {(flowInsight || isGenerating) && (
        <div className="mt-3 rounded-lg bg-indigo-500/10 border-l-2 border-indigo-400/50 px-3 py-2">
          <StreamText value={flowInsight} k="flowInsight" revealed={revealed} pending={isGenerating} lines={2} className="text-xs text-slate-200 leading-relaxed" />
        </div>
      )}
    </div>
  );
}

// 4층 "종목 고유 리스크" — 수급·PER·거래대금배수·MDD 같은 다른 카드의 지표는 프롬프트에서 금지.
export function RiskFactorsCard({ riskFactors, isGenerating = false, className = '' }: { riskFactors: string[]; isGenerating?: boolean; className?: string }) {
  if (riskFactors.length === 0 && !isGenerating) return null;
  return (
    <div className={`bg-[#1a1f2e] border border-red-500/20 rounded-2xl p-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className={`px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>Risk Factors</span>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed mb-3">이 종목 고유의 이슈만 — 수급·밸류에이션·거래대금·변동성 지표는 각 카드에서 다룹니다.</p>
      <div className="flex flex-col gap-2">
        {riskFactors.length > 0 ? riskFactors.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-red-500/60 text-[11px] mt-1 shrink-0">▶</span>
            <p className="text-xs text-slate-300 leading-relaxed">{line}</p>
          </div>
        )) : <FieldSkeleton lines={3} />}
      </div>
    </div>
  );
}

// 3층 급등/급락 이력 + 거래대금 배수 — hasMatches:false(대다수 종목의 기본 상태)면 빈 카드 대신
// 거래대금 카드 안에 한 줄로 접는다(2026-09-01). 둘 다 없으면 행 자체 생략.
export function SurgeTradingRow({ surgeHistory, tradingValueMultiple, className = '' }: {
  surgeHistory?: SurgeHistory | null;
  tradingValueMultiple?: TradingValueMultiple | null;
  className?: string;
}) {
  const showSurge = !!surgeHistory?.hasMatches;
  const showTrading = !!tradingValueMultiple?.valid;
  if (!showSurge && !showTrading) return null;
  return (
    <div className={`grid grid-cols-1 ${showSurge && showTrading ? 'md:grid-cols-2' : ''} gap-4 ${className}`}>
      {showSurge && <SurgeHistoryCard surgeHistory={surgeHistory!} />}
      {showTrading && (
        <TradingValueMultipleCard
          t={tradingValueMultiple!}
          surgeEmptyNote={!showSurge && surgeHistory ? { threshold: surgeHistory.threshold } : null}
        />
      )}
    </div>
  );
}

// 4층 "DART 주요 공시" — 있을 때만.
export function DisclosuresCard({ disclosures, narrative, className = '' }: {
  disclosures: { title: string; date: string; url: string }[];
  narrative?: ReactNode;
  className?: string;
}) {
  if (disclosures.length === 0) return null;
  return (
    <div className={`rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-5 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className={`${SECTION_TITLE_CLASS} text-amber-400 uppercase tracking-widest`}>주요 공시 (DART)</span>
      </div>
      <div className="flex flex-col gap-2 mb-3">
        {disclosures.map((d, i) => (
          <a key={i} href={d.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/30 px-3 py-2 hover:bg-slate-900/50 transition-colors group">
            <span className="text-[13px] text-amber-100/90 group-hover:text-amber-200 group-hover:underline leading-snug">{d.title}</span>
            <span className="text-[11px] text-amber-400/70 font-mono shrink-0">{d.date}</span>
          </a>
        ))}
      </div>
      {narrative}
    </div>
  );
}

// 3층 환율 상관관계 — |r|<0.3·표본 부족이면 서버가 null(카드 생략).
export function FxCorrelationCard({ fx, className = '' }: { fx?: { correlation: number } | null; className?: string }) {
  if (!fx) return null;
  return (
    <div className={`bg-[#1a1f2e] border border-cyan-500/20 rounded-2xl p-5 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>환율 상관관계</span>
      </div>
      <p className="text-xs text-slate-300 leading-relaxed">
        최근 1년간 이 종목은 원/달러 환율과 {fx.correlation >= 0 ? '+' : ''}{fx.correlation}의 {fx.correlation >= 0 ? '양(+)' : '음(-)'}의 상관관계를 보여왔습니다.
      </p>
    </div>
  );
}

// 층 구분 헤더 — 4층 구조(한눈에 / 내 포지션 / 종목 구조 / 참고자료)를 시각적으로 나눈다.
export function LayerHeading({ no, title, sub }: { no: number; title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-2.5 mb-3 mt-1">
      <span className="text-[11px] font-mono text-indigo-400/70">{String(no).padStart(2, '0')}</span>
      <span className="text-[12px] font-bold text-slate-300 tracking-wide">{title}</span>
      {sub && <span className="text-[11px] text-slate-600">{sub}</span>}
    </div>
  );
}
