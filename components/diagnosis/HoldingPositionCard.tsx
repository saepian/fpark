// "내 포지션" 카드 (2026-09-01 기업분석 리포트 재편, 2층) — 메인(DiagnosisReport)·공유 페이지
// 공용 순수 프레젠테이션 컴포넌트. 수치는 전부 서버가 lib/holding-position.ts로 계산해 저장한
// 값이며, 카드는 그리기만 한다. "매입가까지 +X% 필요"는 산술값이지 회복 가능성 판단이 아니고,
// PER 변화는 현재 EPS 동일 가정임을 캡션으로 반드시 밝힌다(컴플라이언스: 매수/매도/목표가 없음).
// 아래 "관찰 포인트"(AI watchPoint)는 이 수치들을 내 포지션 관점에서 한 문장으로 잇는 자리.
import type { ReactNode } from 'react';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import { describeHoldingWindow, holdingPriceBasisLabel, type HoldingPosition } from '@/lib/holding-position';

const sgn = (n: number, digits = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
const md = (d: string) => { const p = d.split('-'); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : d; };
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const toneOf = (n: number) => (n >= 0 ? 'text-red-400' : 'text-blue-400');

function Tile({ label, value, sub, tone = 'text-slate-200' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-900/40 border border-slate-700/40 px-3 py-2.5">
      <p className="text-[11px] text-slate-500 mb-1 whitespace-nowrap">{label}</p>
      <p className={`text-[15px] font-bold font-mono leading-tight whitespace-nowrap ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

export function HoldingPositionCard({
  position,
  narrative,
  className = '',
}: {
  position: HoldingPosition | null | undefined;
  narrative?: ReactNode;   // "관찰 포인트" — 호출부가 스트리밍 커서/스켈레톤 상태까지 조립해 넘김(null이면 생략)
  className?: string;
}) {
  if (!position && !narrative) return null;
  const p = position;
  return (
    <div className={`bg-[#1a1f2e] border border-indigo-500/25 rounded-2xl p-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3">
        <span className={`px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>내 포지션</span>
        {p && <span className="text-[11px] text-slate-500">{describeHoldingWindow(p)} · {holdingPriceBasisLabel(p)}</span>}
      </div>

      {p && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Tile
            label="매입가까지"
            value={p.recoveryRate === null ? '-' : p.recoveryRate > 0 ? `${sgn(p.recoveryRate)} 필요` : `${sgn(p.recoveryRate)} 여유`}
            tone={p.recoveryRate === null ? 'text-slate-200' : p.recoveryRate > 0 ? 'text-blue-400' : 'text-red-400'}
            sub={`현재 평가손익 ${sgn(p.profitRate)}`}
          />
          <Tile
            label="보유 중 고점 대비"
            value={p.high ? sgn(p.high.vsCurrent) : '-'}
            tone={p.high ? toneOf(p.high.vsCurrent) : undefined}
            sub={p.high ? `${p.priceBasis === 'intraday' ? '장중 고가' : '고점'} ${won(p.high.close)} · ${md(p.high.date)}` : undefined}
          />
          <Tile
            label="보유 중 저점 대비"
            value={p.low ? sgn(p.low.vsCurrent) : '-'}
            tone={p.low ? toneOf(p.low.vsCurrent) : undefined}
            sub={p.low ? `${p.priceBasis === 'intraday' ? '장중 저가' : '저점'} ${won(p.low.close)} · ${md(p.low.date)}` : undefined}
          />
          <Tile
            label="최대 / 최저 평가손익"
            value={p.maxPnl && p.minPnl ? (
              <><span className={toneOf(p.maxPnl.rate)}>{sgn(p.maxPnl.rate)}</span><span className="text-slate-600"> / </span><span className={toneOf(p.minPnl.rate)}>{sgn(p.minPnl.rate)}</span></>
            ) : '-'}
            sub={p.maxPnl && p.minPnl ? `${md(p.maxPnl.date)} · ${md(p.minPnl.date)}${p.high ? ` — 고점 대비 ${sgn(p.high.vsCurrent)} 되돌림` : ''}` : undefined}
          />
          <Tile
            label={`±${p.bigMoves.threshold}% 이상 변동일`}
            value={p.bigMoves.count > 0 ? `${p.bigMoves.count}일` : '없음'}
            tone={p.bigMoves.count > 0 ? 'text-amber-300' : 'text-slate-300'}
            sub={p.bigMoves.count > 0 ? p.bigMoves.days.map((d) => `${md(d.date)} ${sgn(d.changeRate, 1)}`).join(' · ') : '관찰 구간 내 급등락 없음'}
          />
          <Tile
            label="PER 변화 (매입 시점 → 현재)"
            value={p.per ? `${p.per.atBuy}배 → ${p.per.now}배` : '계산 불가'}
            tone={p.per ? 'text-slate-200' : 'text-slate-500'}
            sub={p.per ? `현재 EPS ${p.per.eps.toLocaleString()}원 동일 가정` : 'EPS 없음(적자 등)'}
          />
        </div>
      )}

      {p?.benchmark && (
        <p className="text-[11px] text-slate-500 mt-2.5 leading-relaxed">
          보유기간 {p.benchmark.indexName} <span className={`font-mono ${toneOf(p.benchmark.indexChangeRate)}`}>{sgn(p.benchmark.indexChangeRate)}</span>
          {' '}vs 이 종목 <span className={`font-mono ${toneOf(p.benchmark.stockProfitRate)}`}>{sgn(p.benchmark.stockProfitRate)}</span>
          {' '}(<span className="font-mono">{p.benchmark.excess >= 0 ? '+' : ''}{p.benchmark.excess.toFixed(2)}%p</span>, {p.benchmark.fromDate}~{p.benchmark.toDate})
        </p>
      )}

      {narrative && (
        <div className={`${p ? 'mt-3 pt-3 border-t border-slate-700/50' : ''}`}>
          <p className={`${SECTION_TITLE_CLASS} text-indigo-400/80 uppercase tracking-wide mb-1`}>관찰 포인트</p>
          {narrative}
        </div>
      )}
    </div>
  );
}

export default HoldingPositionCard;
