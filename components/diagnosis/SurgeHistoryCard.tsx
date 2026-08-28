// "급등/급락 이력" + "거래대금 배수" 카드 — lib/stock-analysis-data.ts의
// computeSurgeHistory/computeTradingValueMultiple 원자료를 그대로 노출한다.
// 순수 프레젠테이션 컴포넌트(훅·브라우저 API 미사용)라 diagnosis 메인 페이지
// (컴포넌트: DiagnosisReport.tsx, 클라이언트)와 공유 페이지(app/share/[id]/page.tsx,
// 서버 컴포넌트) 양쪽에서 그대로 import해 쓴다 — 2026-08-28까지는 이 두 파일에
// 손복제돼 있어 한쪽만 고치면 드리프트가 나던 걸 여기로 뽑아 근본적으로 방지.
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';

export interface SurgeHistory {
  hasMatches: boolean;
  threshold: number; // 이 등락률(%) 이상을 "오늘과 유사한 규모"로 판정
  matches: {
    date: string;
    changeRate: number; // 그날의 등락률(%)
    afterReturns: { d3?: number; d5?: number; d10?: number }; // 그날 이후 N거래일 뒤 수익률(%) — 차트 구간 끝에 걸치면 일부만 존재
  }[];
}

export interface TradingValueMultiple {
  valid: boolean;
  todayValue: number; // 원
  avg20d: number;      // 원
  multiple: number;
}

function fmt(n: number) { return n.toLocaleString(); }

export function TradingValueGauge({ multiple }: { multiple: number }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const capped = Math.min(multiple, 4);
  const filled = circ * (capped / 4);
  const color = multiple >= 3 ? '#f87171' : multiple >= 1.5 ? '#fbbf24' : '#94a3b8';
  const label = multiple >= 3 ? '거래 폭증' : multiple >= 1.5 ? '거래 증가' : '평이한 수준';

  return (
    <svg width="148" height="148" viewBox="0 0 148 148">
      <circle cx="74" cy="74" r={r} fill="none" stroke="#1e293b" strokeWidth="14" />
      <circle
        cx="74" cy="74" r={r}
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
        transform="rotate(-90 74 74)"
        style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
      />
      <text x="74" y="69" textAnchor="middle" fill={color} fontSize="20" fontWeight="800" fontFamily="monospace">
        {multiple.toFixed(1)}x
      </text>
      <text x="74" y="88" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600" letterSpacing="1">
        {label}
      </text>
    </svg>
  );
}

// 2026-08-28: 오늘과 유사한 규모(threshold% 이상)의 과거 사례가 없는 게 대다수 종목의
// 기본 상태인 건 맞지만, 카드 자체를 생략하면 "거래대금 배수"(평이한 값 1배 안팎도
// 항상 보여줌)와 시각적 일관성이 깨진다는 지적으로 hasMatches:false여도 카드는 항상
// 그리고, 내부만 "이력 없음" 빈 상태로 바꾼다(사례 목록 대신 짧은 안내문).
export function SurgeHistoryCard({ surgeHistory }: { surgeHistory: SurgeHistory }) {
  return (
    <div className="bg-[#1a1f2e] border border-rose-500/20 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className={`px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
          급등/급락 이력
        </span>
      </div>
      {surgeHistory.hasMatches ? (
        <>
          <div className="flex flex-col divide-y divide-slate-700/40">
            {surgeHistory.matches.map((m, i) => {
              const afterParts = [
                m.afterReturns.d3  !== undefined && `3일 후 ${m.afterReturns.d3  >= 0 ? '+' : ''}${m.afterReturns.d3}%`,
                m.afterReturns.d5  !== undefined && `5일 후 ${m.afterReturns.d5  >= 0 ? '+' : ''}${m.afterReturns.d5}%`,
                m.afterReturns.d10 !== undefined && `10일 후 ${m.afterReturns.d10 >= 0 ? '+' : ''}${m.afterReturns.d10}%`,
              ].filter(Boolean) as string[];
              // 2026-08-27 실라이브 검증(390px 모바일)에서 발견: 날짜/등락률과 N일 후
              // 되돌림을 한 줄(flex justify-between)에 욱여넣으면 좁은 화면에서 되돌림
              // 텍스트가 2줄로 줄바꿈되고, items-center 때문에 위 줄(날짜/등락률)이 그
              // 두 줄 사이 중간 높이로 어색하게 떠 보였음 — 날짜/등락률 줄과 되돌림 줄을
              // 아예 분리해 항상 2줄 구조로 고정(너비와 무관하게 정렬이 흔들리지 않음).
              return (
                <div key={`${m.date}-${i}`} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-slate-500 font-mono">{m.date}</span>
                    <span className={`text-[13px] font-bold font-mono ${m.changeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {m.changeRate >= 0 ? '+' : ''}{m.changeRate}%
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
                    {afterParts.length > 0 ? afterParts.join(' · ') : '이후 데이터 부족'}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-600 mt-3 leading-relaxed">
            최근 약 5개월 내 오늘과 유사한 규모(등락률 {surgeHistory.threshold}% 이상)의 과거 사례이며, 이후 수익률은 결과를 예측하는 값이 아닌 관측된 기록입니다.
          </p>
        </>
      ) : (
        <div className="flex flex-col items-center py-5 text-center">
          <p className="text-[13px] text-slate-400">
            최근 약 5개월 내 등락률 {surgeHistory.threshold}% 이상의 급등/급락 이력 없음
          </p>
          <p className="text-[10.5px] text-slate-600 mt-2 leading-relaxed">
            오늘과 비슷한 규모의 과거 변동이 관측되지 않았습니다 — 이 종목이 상대적으로 완만한 가격 흐름을 보여왔다는 관찰입니다.
          </p>
        </div>
      )}
    </div>
  );
}

// computeTradingValueMultiple() 원자료(오늘 거래대금 vs 최근 20거래일 평균)를 기관/외국인
// 동향 도넛과 같은 시각 언어(TradingValueGauge)로 노출. 배수 자체는 평상시에도 항상
// 존재하는 값(1배 안팎이 오히려 정상)이라 급등이력 카드와 달리 값 유무로 생략하지 않고,
// 계산에 필요한 데이터(최근 20거래일)가 부족할 때만(valid:false) 생략한다.
export function TradingValueMultipleCard({ t }: { t: TradingValueMultiple }) {
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <p className={`${SECTION_TITLE_CLASS} text-slate-400 uppercase tracking-widest`}>거래대금 배수</p>
      </div>
      <div className="flex flex-col items-center py-2">
        <TradingValueGauge multiple={t.multiple} />
        <p className="text-center text-[10px] text-slate-600 leading-snug mt-2">
          오늘 {fmt(Math.round(t.todayValue / 1e8))}억원 · 최근 20일 평균 {fmt(Math.round(t.avg20d / 1e8))}억원 대비
        </p>
      </div>
    </div>
  );
}
