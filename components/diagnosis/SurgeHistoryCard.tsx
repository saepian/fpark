'use client';

// "급등/급락 이력" + "거래대금 배수" 카드 — lib/stock-analysis-data.ts의
// computeSurgeHistory/computeTradingValueMultiple 원자료를 그대로 노출한다.
// diagnosis 메인 페이지(컴포넌트: DiagnosisReport.tsx, 클라이언트)와 공유 페이지
// (app/share/[id]/page.tsx, 서버 컴포넌트) 양쪽에서 그대로 import해 쓴다 — 2026-08-28까지는
// 이 두 파일에 손복제돼 있어 한쪽만 고치면 드리프트가 나던 걸 여기로 뽑아 근본적으로 방지.
// 2026-09-02: 거래대금 배수 카드에 막대그래프(recharts)를 추가하며 'use client' 전환 —
// components/diagnosis/SectorComparisonCard.tsx가 이미 같은 방식(recharts + 'use client')으로
// 서버 컴포넌트인 공유 페이지에 문제없이 렌더링되는 걸 확인한 선례를 그대로 따른다(Next.js
// App Router는 서버 컴포넌트가 클라이언트 컴포넌트를 자식으로 렌더링하는 걸 지원).
import { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, ReferenceLine, Cell, Tooltip, XAxis } from 'recharts';
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
  // 최근 20거래일 + 오늘, 막대그래프용. foreignNet/institutionNet/individualNet(2026-09-02,
  // 2차)은 그날 수급 순매수(+)/순매도(-), 억원 단위 — route.ts가 21일 수급 조회를 병합해줄
  // 때만 존재(옛 레코드·조회 실패 시 undefined, 툴팁이 거래대금만 표시).
  recentSeries: { date: string; value: number; foreignNet?: number; institutionNet?: number; individualNet?: number }[];
}

function fmt(n: number) { return n.toLocaleString(); }

export function TradingValueGauge({ multiple, size = 120 }: { multiple: number; size?: number }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const capped = Math.min(multiple, 4);
  const filled = circ * (capped / 4);
  const color = multiple >= 3 ? '#f87171' : multiple >= 1.5 ? '#fbbf24' : '#94a3b8';
  const label = multiple >= 3 ? '거래 폭증' : multiple >= 1.5 ? '거래 증가' : '평이한 수준';

  return (
    <svg width={size} height={size} viewBox="0 0 148 148">
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
      <text x="74" y="88" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="600" letterSpacing="1">
        {label}
      </text>
    </svg>
  );
}

// 한 건을 한 줄로 압축한 행 — 예전엔 날짜/등락률 줄 + N일 후 되돌림 줄, 2줄 구조였는데
// (2026-08-27 커밋 사유는 아래 유지) 이력이 많은 종목(8건 이상 실측)에서 옆 "거래대금
// 배수" 카드보다 카드가 훨씬 길어지는 높이 불균형 문제(2026-09-02)로 한 줄로 합쳤다.
// justify-between + flex-wrap이라 아주 좁은 화면에서 되돌림 텍스트가 넘치면 자동으로
// 아래 줄로 감싸지되(잘리지 않음), 보통 폭에서는 한 줄로 붙는다.
function SurgeMatchRow({ m }: { m: SurgeHistory['matches'][number] }) {
  const afterParts = [
    m.afterReturns.d3  !== undefined && `3일 ${m.afterReturns.d3  >= 0 ? '+' : ''}${m.afterReturns.d3}%`,
    m.afterReturns.d5  !== undefined && `5일 ${m.afterReturns.d5  >= 0 ? '+' : ''}${m.afterReturns.d5}%`,
    m.afterReturns.d10 !== undefined && `10일 ${m.afterReturns.d10 >= 0 ? '+' : ''}${m.afterReturns.d10}%`,
  ].filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 py-1.5">
      <span className="flex items-baseline gap-2 shrink-0">
        <span className="text-[11px] text-slate-500 font-mono">{m.date}</span>
        <span className={`text-[12px] font-bold font-mono ${m.changeRate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
          {m.changeRate >= 0 ? '+' : ''}{m.changeRate}%
        </span>
      </span>
      <span className="text-[11px] text-slate-500">
        {afterParts.length > 0 ? afterParts.join(' · ') : '이후 데이터 부족'}
      </span>
    </div>
  );
}

// 기본으로 보여줄 최근 건수 — 이보다 많으면 나머지는 <details>(훅 없는 순수 CSS 접이식,
// 이 컴포넌트가 공유 페이지의 서버 컴포넌트에서도 그대로 쓰이므로 useState를 못 씀)로 접는다.
const RECENT_VISIBLE_COUNT = 4;

// 2026-08-28: 오늘과 유사한 규모(threshold% 이상)의 과거 사례가 없는 게 대다수 종목의
// 기본 상태인 건 맞지만, 카드 자체를 생략하면 "거래대금 배수"(평이한 값 1배 안팎도
// 항상 보여줌)와 시각적 일관성이 깨진다는 지적으로 hasMatches:false여도 카드는 항상
// 그리고, 내부만 "이력 없음" 빈 상태로 바꾼다(사례 목록 대신 짧은 안내문).
export function SurgeHistoryCard({ surgeHistory }: { surgeHistory: SurgeHistory }) {
  // matches는 오래된 → 최신 순(lib/stock-analysis-data.ts computeSurgeHistory가 그렇게 push함).
  // 최근 것을 항상 보여주고, 그보다 오래된 것만 접어서 "더 오래된 이력" 쪽에 둔다 —
  // 펼쳐도 항상 보이던 최근 항목들의 위치가 바뀌지 않아 자연스럽다.
  const hasOverflow = surgeHistory.matches.length > RECENT_VISIBLE_COUNT;
  const older  = hasOverflow ? surgeHistory.matches.slice(0, surgeHistory.matches.length - RECENT_VISIBLE_COUNT) : [];
  const recent = hasOverflow ? surgeHistory.matches.slice(-RECENT_VISIBLE_COUNT) : surgeHistory.matches;
  return (
    <div className="bg-[#1a1f2e] border border-rose-500/20 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
          급등/급락 이력
        </span>
      </div>
      {surgeHistory.hasMatches ? (
        <>
          <div className="flex flex-col divide-y divide-slate-700/40">
            {hasOverflow && (
              <details className="group pb-1.5">
                <summary className="cursor-pointer select-none list-none text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1 [&::-webkit-details-marker]:hidden [&::marker]:content-none">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  이전 이력 더보기 (총 {surgeHistory.matches.length}건)
                </summary>
                <div className="flex flex-col divide-y divide-slate-700/40 mt-1">
                  {older.map((m, i) => <SurgeMatchRow key={`${m.date}-${i}`} m={m} />)}
                </div>
              </details>
            )}
            {recent.map((m, i) => <SurgeMatchRow key={`${m.date}-${i}`} m={m} />)}
          </div>
          <p className="text-[11px] text-slate-600 mt-3 leading-relaxed">
            최근 약 5개월 내 오늘과 유사한 규모(등락률 {surgeHistory.threshold}% 이상)의 과거 사례이며, 이후 수익률은 결과를 예측하는 값이 아닌 관측된 기록입니다.
          </p>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <p className="text-[13px] text-slate-400">
            최근 5개월 내 {surgeHistory.threshold}% 이상 급등락 없음
          </p>
          <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
            오늘과 비슷한 규모의 과거 변동이 관측되지 않았다는 관찰입니다.
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
// 2026-09-02: 급등/급락 이력 카드는 이력이 없어도 항상 옆에 유지(SurgeTradingRow) — 여기서 접지 않는다.
// 2026-09-02(2차): 게이지 하나만 있어 옆 급등/급락 이력 카드보다 정보량이 부실하다는 지적 —
// 최근 21거래일(20일 평균 계산 구간 + 오늘) 거래대금 막대그래프를 게이지 아래에 추가한다.
// 오늘 막대만 배수 구간별 색(게이지와 동일 색 규칙)으로 강조하고 나머지는 회색, 점선은
// 20일 평균선 — SectorComparisonCard의 스파크라인·SurgeHistoryCard 자체와 같은 "축 없는
// 미니 차트" 톤을 그대로 따른다.
// 2026-09-02(3차) 실측: 게이지 옆에 나란히(가로) 배치했더니 게이지를 줄인 만큼 카드가 오히려
// 더 짧아져(211px→176px, 모바일) 목표(급등락이력 카드와 밀도 비슷하게)와 반대로 갔다 —
// 막대그래프가 가로로 좁아 세로 공간을 못 늘렸기 때문. 게이지는 그대로 두고 아래에 전폭으로
// 쌓아 막대그래프가 카드 너비를 다 쓰게(가독성도 좋아짐) 바꿔 카드가 자연스럽게 급등락이력
// 카드 쪽으로 높이가 붙게 했다(재실측: 아래 함수 설명 참고 — 최종 실측치는 커밋 코멘트 확인).
function tradingValueBarColor(multiple: number): string {
  return multiple >= 3 ? '#f87171' : multiple >= 1.5 ? '#fbbf24' : '#818cf8';
}

function fmtMonthDay(d: string): string {
  const p = d.split('-');
  return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : d;
}

function fmtAuk(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toLocaleString()}억원`;
}

// 2026-09-02(4차): "막대만 있고 호버해도 정보가 없어 그냥 이미지 같다"는 피드백 — 거래대금
// 수치 + (있으면) 그날 기관·외국인·개인 순매수를 툴팁으로 보여준다. 순매수 조사 결과: KIS
// inquire-investor는 매수/매도 총 거래대금이 아니라 "순매수 금액"만 주므로(세 값을 더하면
// 대략 0에 수렴 — zero-sum), 막대 자체를 기관/외국인/개인 구간으로 쪼개 보여줄 수는 없다.
// 대신 막대(총 거래대금)와 별개로 그날 수급 방향을 보조 정보로 함께 노출한다.
function TradingValueTooltip({ active, payload, label }: {
  active?: boolean;
  label?: string;
  payload?: { payload: TradingValueMultiple['recentSeries'][number] }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const hasFlow = d.foreignNet !== undefined || d.institutionNet !== undefined || d.individualNet !== undefined;
  return (
    <div className="rounded-md border border-slate-700 bg-[#1a1f2e] px-2.5 py-2 text-[11px] shadow-lg">
      <p className="text-slate-400 mb-1">{fmtMonthDay(label ?? d.date)}</p>
      <p className="text-indigo-200 font-mono">거래대금 {(d.value / 1e8).toLocaleString()}억원</p>
      {hasFlow && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-700/60 flex flex-col gap-0.5">
          {d.institutionNet !== undefined && (
            <span className={d.institutionNet >= 0 ? 'text-red-400' : 'text-blue-400'}>기관 {fmtAuk(d.institutionNet)}</span>
          )}
          {d.foreignNet !== undefined && (
            <span className={d.foreignNet >= 0 ? 'text-red-400' : 'text-blue-400'}>외국인 {fmtAuk(d.foreignNet)}</span>
          )}
          {d.individualNet !== undefined && (
            <span className={d.individualNet >= 0 ? 'text-red-400' : 'text-blue-400'}>개인 {fmtAuk(d.individualNet)}</span>
          )}
        </div>
      )}
    </div>
  );
}

// 2026-09-02(6차): 툴팁이 마우스 호버 전용이라 터치 기기에선 원천적으로 볼 방법이 없었다는
// 지적 — (pointer: coarse) 미디어쿼리로 터치 기기를 판정해서, 그럴 때만 막대 탭을 눌러
// 툴팁을 켜고 끄는 컨트롤드 모드로 전환한다. 데스크톱(마우스)은 이 상태를 아예 안 만드니
// recharts의 기본 호버 동작이 그대로 유지된다 — 같은 <Tooltip>에 active/payload/coordinate를
// 조건부로만 넘겨서 두 기기를 갈라놓았다(항상 넘기면 desktop 호버까지 컨트롤드로 바뀌어 버림).
function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch(window.matchMedia('(pointer: coarse)').matches);
  }, []);
  return isTouch;
}

export function TradingValueMultipleCard({ t, compact = false }: { t: TradingValueMultiple; compact?: boolean }) {
  const barColor = tradingValueBarColor(t.multiple);
  const hasSeries = t.recentSeries.length > 0;
  const isTouch = useIsTouchDevice();
  const [tapActive, setTapActive] = useState<{ label: string; payload: TradingValueMultiple['recentSeries'][number]; coordinate: { x: number; y: number } } | null>(null);
  // 2026-09-02(5차): 급등/급락 이력이 0~1건이면 옆 카드가 짧아지는데 이 카드는 항상 같은
  // 막대그래프 높이라 그때만 빈 공간이 남는다는 지적 — compact(SurgeTradingRow가 판정)일 때
  // 그래프 높이를 줄인다. 게이지·수치·툴팁 기능은 그대로 유지(정보 손실 없음, 높이만 축소).
  const chartHeight = compact ? 56 : 110;
  return (
    <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <p className={`${SECTION_TITLE_CLASS} text-slate-400 uppercase tracking-widest`}>거래대금 배수</p>
      </div>
      <div className="flex flex-col items-center py-1">
        <TradingValueGauge multiple={t.multiple} />
      </div>
      {hasSeries && (
        <div className="mt-2">
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={t.recentSeries} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
                <XAxis dataKey="date" hide />
                <Tooltip
                  content={<TradingValueTooltip />}
                  cursor={{ fill: '#334155', fillOpacity: 0.3 }}
                  {...(isTouch
                    ? {
                        active: tapActive !== null,
                        payload: tapActive ? [{ payload: tapActive.payload }] : [],
                        coordinate: tapActive?.coordinate,
                        label: tapActive?.label,
                      }
                    : {})}
                />
                <ReferenceLine y={t.avg20d} stroke="#64748b" strokeDasharray="3 3" />
                <Bar
                  dataKey="value"
                  radius={[1.5, 1.5, 0, 0]}
                  isAnimationActive={false}
                  onClick={(data) => {
                    // BarChart 레벨 onClick의 activeIndex는 touchmove로 누적된 호버 상태에
                    // 의존하는데(탭은 touchstart+touchend뿐이라 touchmove가 안 남) 항상 null로
                    // 옴 — 대신 Bar 자체의 onClick(막대 하나하나에 직접 붙는 클릭 핸들러)을 쓰면
                    // 탭 즉시 해당 막대의 data.payload/tooltipPosition을 그대로 받을 수 있다.
                    if (!isTouch) return;
                    const point = data.payload as TradingValueMultiple['recentSeries'][number] | undefined;
                    if (!point) { setTapActive(null); return; }
                    setTapActive((prev) => (prev?.label === point.date ? null : { label: point.date, payload: point, coordinate: data.tooltipPosition }));
                  }}
                >
                  {t.recentSeries.map((d, i) => (
                    <Cell key={d.date} fill={i === t.recentSeries.length - 1 ? barColor : '#334155'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[11px] text-slate-600">최근 {t.recentSeries.length}거래일{isTouch ? ' · 막대를 탭하면 상세 표시' : ''}</span>
            <span className="text-[11px] text-slate-600">점선: 20일 평균</span>
          </div>
        </div>
      )}
      <p className="text-center text-[11px] text-slate-600 leading-snug mt-1.5">
        오늘 {fmt(Math.round(t.todayValue / 1e8))}억원 · 최근 20일 평균 {fmt(Math.round(t.avg20d / 1e8))}억원 대비
      </p>
    </div>
  );
}
