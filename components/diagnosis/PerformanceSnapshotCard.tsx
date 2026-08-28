// "Performance Snapshot" 카드 — 현재가·수익률·벤치마크·매입평균가·보유수량·52주 최고/최저를
// 한 카드 안에 보조정보 위계로 모아 보여준다. 순수 프레젠테이션 컴포넌트(훅·브라우저 API
// 미사용)라 diagnosis 메인 페이지(DiagnosisReport.tsx, 클라이언트)와 공유 페이지
// (app/share/[id]/page.tsx, 서버 컴포넌트) 양쪽에서 그대로 import해 쓴다 —
// components/diagnosis/SurgeHistoryCard.tsx와 동일한 이유(손복제 드리프트 방지).
//
// 2026-08-26(commit b10924a) 52주 최고/최저가 독립 카드에서 이 카드로 흡수됐을 때,
// "현재가 대비 %"까지 값과 한 줄에 넣으면 카드 폭(300px)에서 라벨이 밀려 줄바꿈되는
// 문제가 있었음 — 값은 같은 줄, 비율은 그 아래 작은 보조줄로 세로 분리해 해결한 전례가
// 있으니 이 컴포넌트를 고칠 때 그 실수를 반복하지 말 것.
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';

export interface PerformanceBenchmark {
  indexName: 'KOSPI' | 'KOSDAQ';
  indexChangeRate: number;
  stockProfitRate: number;
  fromDate: string;
  toDate: string;
}

export interface PerformanceSnapshotProps {
  currentPrice: number;
  profitRate: number;
  profitAmount: number;
  avgPrice: number;
  quantity: number;
  resistance: number; // 52주 고점 기준 저항선 관찰 (목표가 아님)
  support: number;    // 52주 저가 기준 지지선 관찰 (손절가 아님)
  benchmark?: PerformanceBenchmark | null;
  // 휴장일 등 실시간 조회 실패 시 마지막 거래일 기준 값 — 공유 페이지는 생성 시점에
  // 이미 확정된 스냅샷이라 이 개념이 없어 항상 undefined로 두고 캡션을 생략한다.
  isCached?: boolean;
  cachedAt?: string;
}

function fmt(n: number) { return n.toLocaleString(); }
function fmtRate(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

export function PerformanceSnapshotCard({
  currentPrice, profitRate, profitAmount, avgPrice, quantity, resistance, support,
  benchmark, isCached, cachedAt,
}: PerformanceSnapshotProps) {
  const isProfit = profitRate >= 0;
  const resistanceUpRate = resistance > 0 ? ((resistance - currentPrice) / currentPrice * 100) : 0;
  const supportDownRate  = support    > 0 ? ((support    - currentPrice) / currentPrice * 100) : 0;

  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 pt-4 pb-2 border-b border-slate-700/50">
        <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest`}>Performance Snapshot</p>
      </div>
      {isCached && (
        <div className="flex items-center gap-1.5 px-5 pt-3 text-[11px] text-amber-500">
          <RefreshCw className="w-3 h-3 animate-spin" />
          <span>
            최근 거래일 종가 기준
            {cachedAt && ` · ${new Date(cachedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
      )}
      <div className="divide-y divide-slate-700/40">
        <div className="flex items-center justify-between px-5 py-3.5">
          <span className="text-[12px] text-slate-400">현재가</span>
          <span className="text-[15px] font-bold text-white font-mono">{fmt(currentPrice)} <span className="text-[11px] text-slate-500 font-normal">KRW</span></span>
        </div>
        <div className="flex items-center justify-between px-5 py-3.5">
          <span className="text-[12px] text-slate-400">기업 수익률</span>
          <span className={`text-[15px] font-bold font-mono flex items-center gap-1 ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
            {isProfit ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {fmtRate(profitRate)}
          </span>
        </div>
        {benchmark && (
          <>
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-[12px] text-slate-400">같은 기간 {benchmark.indexName} 등락률</span>
              <span className={`text-[13px] font-bold font-mono ${benchmark.indexChangeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                {fmtRate(benchmark.indexChangeRate)}
              </span>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-[12px] text-slate-400">시장 대비</span>
              {(() => {
                const diff = benchmark.stockProfitRate - benchmark.indexChangeRate;
                return (
                  <span className={`text-[13px] font-bold font-mono ${diff >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {diff >= 0 ? '+' : ''}{diff.toFixed(2)}%p
                  </span>
                );
              })()}
            </div>
          </>
        )}
        <div className="flex items-center justify-between px-5 py-3.5">
          <span className="text-[12px] text-slate-400">평가손익</span>
          <span className={`text-[14px] font-bold font-mono ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
            {profitAmount > 0 ? '+' : ''}{fmt(profitAmount)}
          </span>
        </div>
        <div className="flex items-center justify-between px-5 py-3.5">
          <span className="text-[12px] text-slate-400">매입평균가</span>
          <span className="text-[13px] text-slate-300 font-mono">{fmt(avgPrice)}</span>
        </div>
        <div className="flex items-center justify-between px-5 py-3.5">
          <span className="text-[12px] text-slate-400">보유수량</span>
          <span className="text-[13px] text-slate-300 font-mono">{fmt(quantity)}주</span>
        </div>
        {/* 52주 최고/최저 — "현재가 대비 %"까지 값과 한 줄에 넣으면 카드 폭(300px)에서
            라벨이 밀려 줄바꿈되므로 값/비율을 세로로 분리 — 값은 같은 줄, 비율은 그
            아래 작은 보조줄로(2026-08-26 전례, 반복 금지). */}
        <div className="flex items-center justify-between px-5 py-3.5">
          <span className="text-[12px] text-slate-400 shrink-0">52주 최고</span>
          <span className="text-[13px] text-slate-300 font-mono text-right">
            {resistance > 0 ? fmt(resistance) : '-'}
            {resistance > 0 && (
              <span className="block text-[10px] text-slate-500 font-normal mt-0.5">
                현재가 대비 {resistanceUpRate >= 0 ? '+' : ''}{resistanceUpRate.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between px-5 py-3.5">
          <span className="text-[12px] text-slate-400 shrink-0">52주 최저</span>
          <span className="text-[13px] text-slate-300 font-mono text-right">
            {support > 0 ? fmt(support) : '-'}
            {support > 0 && (
              <span className="block text-[10px] text-slate-500 font-normal mt-0.5">
                현재가 대비 {supportDownRate.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
      </div>
      {benchmark && (
        <p className="px-5 py-2.5 text-[10px] text-slate-600 border-t border-slate-700/40">
          비교 기간: {benchmark.fromDate} ~ {benchmark.toDate} (매입일 기준) · 판단이 아닌 수치 비교 정보입니다.
        </p>
      )}
    </div>
  );
}
