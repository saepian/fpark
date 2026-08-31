'use client';

import { Sparkles, ChevronLeft, Printer, AlertCircle } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import ShareDropdown from '@/components/ShareDropdown';
import PageBackground from '@/components/layout/PageBackground';
import PriceChangeTable from '@/components/stock/PriceChangeTable';
import DividendInfo, { type DartDividendSummary, type DividendHistoryRow } from '@/components/diagnosis/DividendInfo';
import { SurgeHistoryCard, TradingValueMultipleCard, type SurgeHistory, type TradingValueMultiple } from '@/components/diagnosis/SurgeHistoryCard';
import { PerformanceSnapshotCard } from '@/components/diagnosis/PerformanceSnapshotCard';
import { SectorComparisonCard, type SectorComparison } from '@/components/diagnosis/SectorComparisonCard';
import { INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';
import type { RevealedField } from '@/lib/useSmoothTypingText';

export interface DiagnosisHistory {
  daysSince: number | null; // null = 첫 기업분석(비교 대상 없음)
  prevDate?: string;
  prevProfitRate?: number | null;
  prevProfitAmount?: number | null;
  prevCurrentPrice?: number | null;
  prevFlowType?: 'BUY' | 'SELL' | 'NEUTRAL' | null;
  prevFlowPercentage?: number | null;
  holdingsChanged?: boolean; // 매입평균가/보유수량이 직전 진단과 달라짐 — 손익 금액 비교 제외
  narrative: string; // AI가 해석한 "직전 진단 대비" 서술
}

export type { SectorComparison };

// 뉴스 논조 추이(2단계 UI 노출, 2026-08-21) — news_sentiment_daily는 CURATED_TICKERS_MKT
// (대형주 100종목) 한정 크론이라 그 밖의 종목은 서버가 null을 보내며, 그 경우 카드 자체를 생략한다.
export interface NewsSentimentTrend {
  points: { date: string; score: number }[]; // null(뉴스 0건)인 날짜는 이미 제거된 상태
  availableDays: number;
  label: '긍정 비중 우세' | '중립·혼조' | '부정 비중 우세';
}

export interface AnnualFinancialRow {
  year: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  roe: number | null;
}

export interface DartDisclosure {
  title: string;
  date: string;
  url: string;
  filer: string;
}

export interface MainAnalysisSections {
  background: string;    // 오늘의 주가 배경 — 현재상태+뉴스해석
  flowSummary: string;    // 수급 동향 — 외국인·기관 5일 해석
  valuationNote: string;  // 밸류에이션(PER/PBR 업종대비) — 데이터 없으면 빈 문자열
  watchPoint: string;     // 관찰 포인트 — 내부지표/급등이력 포지션 관점
}

export interface DiagnosisResult {
  mainAnalysis: string; // 현재 상태·밸류에이션·수급·뉴스 해석을 하나로 합친 서술형 본문(mainAnalysisSections를 서버가 이어붙인 값 — 공유페이지 등 과거 소비처 호환용)
  mainAnalysisSections?: MainAnalysisSections; // 소제목별 렌더링용(신규 리포트만 존재, 과거 레코드는 undefined → mainAnalysis 문자열로 폴백)
  currentPrice: number;
  avgPrice: number;
  quantity: number;
  profitRate: number;
  profitAmount: number;
  news: { title: string; description: string; url?: string; date?: string }[]; // date(원문 pubDate)는 현재 프론트엔드 미사용 — route.ts가 뉴스 클러스터링 프롬프트 컨텍스트로만 사용
  newsBasis?: 'news' | 'estimated';
  newsIssueClusters?: { label: string; articleIndexes: number[] }[]; // news 배열의 인덱스 기준 이슈 묶음 — 뉴스가 적어 클러스터링할 게 없으면 빈 배열(참고 기사는 flat 목록으로 표시)
  institutionalFlow: string; // 도넛 옆 한 줄 캡션
  foreignFlow: string;       // 도넛 옆 한 줄 캡션
  riskFactors: string[];
  sectorComparison: SectorComparison | null; // 동종업계 peer 없으면 null — 카드 자체 생략
  sectorNarrative: string;   // 업종 대비 해석 (1~3문장), 데이터 없으면 빈 문자열
  fxCorrelation?: { correlation: number; sampleSize: number } | null; // 최근 1년 원/달러 환율과의 피어슨 상관계수 — |r|<0.3이거나 표본 부족이면 null(카드 생략)
  surgeHistory?: SurgeHistory | null; // 최근 약 5개월 내 오늘과 유사 규모의 과거 급등/급락 이력 — hasMatches:false(평상시 종목)면 카드 안에 "이력 없음" 빈 상태로 표시(카드 자체는 항상 노출, 2026-08-28), 값 자체가 없으면(계산 실패·과거 레코드) undefined/null이라 카드 생략
  tradingValueMultiple?: TradingValueMultiple | null; // 오늘 거래대금의 최근 20거래일 평균 대비 배수 — valid:false(데이터 부족)면 카드 생략, 과거 레코드는 undefined
  annualFinancials: AnnualFinancialRow[]; // 최근 3개년 확정 연간 실적, 없으면 빈 배열 — 카드 생략
  financialsNarrative: string; // 실적 추이 해석, 데이터 없으면 빈 문자열
  disclosures: DartDisclosure[]; // DART 최근 14일 주요 공시, 없으면 빈 배열 — 카드 생략
  disclosureNarrative: string; // 공시 해석, 데이터 없으면 빈 문자열
  dividendSummary: DartDividendSummary | null; // DART 최신 사업연도 배당 요약, 무배당이면 null
  dividendHistory: DividendHistoryRow[]; // KIS 최근 5년 배당 지급 이력, 없으면 빈 배열
  newsSentiment?: NewsSentimentTrend | null; // 최근 뉴스 논조 추이(대형주 100종목 한정), 데이터 부족하면 null — 카드 생략
  resistance: number; // 52주 고점 기준 저항선 관찰 (목표가 아님)
  support: number;    // 52주 저가 기준 지지선 관찰 (손절가 아님)
  benchmark?: {
    indexName: 'KOSPI' | 'KOSDAQ';
    indexChangeRate: number;
    stockProfitRate: number;
    fromDate: string;
    toDate: string;
  } | null;
  flowType?: 'BUY' | 'SELL' | 'NEUTRAL';
  flowPercentage?: number;
  shortTermOutlook?: string;
  midTermOutlook?: string;
  finalVerdict?: string; // mainAnalysisSections·sectorNarrative·riskFactors·outlook 전체를 종합한 최종 판단 1~2문장(점수·등급 없음), 과거 레코드는 undefined
  isCached?: boolean; // 휴장일 등 실시간 조회 실패 시 마지막 거래일 기준 값
  cachedAt?: string;
  history: DiagnosisHistory;
}

// 2026-08-21: "최근 뉴스 논조 추이" 카드가 정보 전달력 재검토 대상이 되어 프론트 렌더링만
// 잠시 끈다 — 백엔드(app/api/diagnosis/route.ts의 fetchNewsSentimentTrend, news_sentiment
// 크론)는 그대로 유지해 데이터는 계속 쌓인다. 재설계 완료되면 이 플래그만 true로 되돌릴 것.
const SHOW_NEWS_SENTIMENT_CARD = false;

function DonutChart({ percent, type }: { percent: number; type: 'BUY' | 'SELL' | 'NEUTRAL' }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const filled = circ * (percent / 100);
  const color = type === 'BUY' ? '#10b981' : type === 'SELL' ? '#f87171' : '#94a3b8';
  const label = type === 'BUY' ? '자금 유입' : type === 'SELL' ? '자금 유출' : '중립';

  return (
    <svg width="148" height="148" viewBox="0 0 148 148">
      {/* 배경 링 */}
      <circle cx="74" cy="74" r={r} fill="none" stroke="#1e293b" strokeWidth="14" />
      {/* 컬러 아크 */}
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
      {/* 퍼센트 */}
      <text x="74" y="69" textAnchor="middle" fill={color} fontSize="22" fontWeight="800" fontFamily="monospace">
        {percent}%
      </text>
      {/* 라벨 */}
      <text x="74" y="88" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600" letterSpacing="1">
        {label}
      </text>
    </svg>
  );
}

// score(-1~1)를 화면에 그대로 노출하지 않는 원칙(투자 신호처럼 읽히는 걸 피함)을 hover
// 툴팁에도 동일하게 적용 — lib/news-sentiment.ts의 labelFromAvgScore와 같은 임계값이지만,
// 이건 "하루치" 값에 적용하는 것이라 서버 함수를 그대로 재사용하지 않고 별도로 둔다
// (그 함수는 adminClient를 모듈 로드 시 참조해 클라이언트 번들에 들이면 안 됨).
function sentimentDayLabel(score: number): string {
  if (score > 0.15) return '긍정';
  if (score < -0.15) return '부정';
  return '중립';
}

function fmtMonthDay(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// "라벨(현재 상태)만 있고 최근 며칠간 어떻게 변해왔는지가 없다"는 실사용 피드백(2026-08-21)
// 대응 — 최근 구간과 그 이전 구간의 평균을 비교해 4가지 방향성 문장 중 하나를 고른다.
// 문구 4개는 전부 "관련 기사의 논조"를 주어로 고정해 인과·예측으로 안 읽히게 사전 승인받음
// (컴플라이언스 원칙: "긍정 뉴스 급증 → 상승 신호" 같은 연결 절대 금지).
const SENTIMENT_DIFF_THRESHOLD = 0.2; // 이 미만이면 "유지" — labelFromAvgScore(서버, 0.15)보다
                                        // 살짝 높게 잡음: 절대값이 아니라 구간 평균의 "차이"라
                                        // 노이즈(하루 변동폭이 -0.8~1까지 튀는 실측 사례가 있었음)에
                                        // 덜 민감하게 하기 위함.
const SENTIMENT_POSITIVE_THRESHOLD = 0.15; // 서버 labelFromAvgScore와 동일한 기준선 재사용

function computeSentimentDirection(points: { date: string; score: number }[]): string | null {
  if (points.length < 5) return null; // 카드 자체가 5거래일 미만이면 생략되므로 사실상 도달 안 함(방어적)

  // 최근 구간을 전체의 약 1/3(2~5일 사이로 clamp)로 잡고 나머지를 "이전 구간"으로 비교.
  // 14거래일 기준이면 최근 5일 vs 이전 9일 — 사용자가 제안한 "최근 3~5일" 범위에 맞춘 것.
  const recentCount = Math.min(5, Math.max(2, Math.round(points.length / 3)));
  const earlier = points.slice(0, points.length - recentCount);
  const recent = points.slice(points.length - recentCount);
  if (earlier.length === 0) return null;

  const avg = (arr: { score: number }[]) => arr.reduce((s, p) => s + p.score, 0) / arr.length;
  const earlierAvg = avg(earlier);
  const recentAvg = avg(recent);
  const diff = recentAvg - earlierAvg;

  if (Math.abs(diff) < SENTIMENT_DIFF_THRESHOLD) {
    return '최근 14거래일간 관련 기사의 논조는 뚜렷한 변화 없이 비슷한 수준을 유지했습니다.';
  }
  if (diff > 0) {
    return '최근 며칠 사이 관련 기사의 논조가 이전보다 긍정적인 쪽으로 옮겨갔습니다.';
  }
  // diff < -THRESHOLD: 하락 — 그래도 여전히 긍정 구간이면 "둔화", 아니면 "부정 전환"
  if (recentAvg > SENTIMENT_POSITIVE_THRESHOLD) {
    return '최근 며칠 사이 관련 기사의 논조가 이전보다 다소 누그러졌습니다.';
  }
  return '최근 며칠 사이 관련 기사의 논조가 이전보다 부정적인 쪽으로 옮겨갔습니다.';
}

// "최근 뉴스 논조 추이" 카드 안에 들어가는 미니 스파크라인 — SectorSparkline과 동일한
// "축·범례 없는 미니 차트" 원칙을 따르되, 상승/하락 시그널처럼 읽히지 않도록 빨강/파랑 대신
// 중립 인디고 한 가지 색만 쓴다(fmtRate의 red/blue 컬러링과 의도적으로 다른 선택). 2026-08-21:
// "기준점이 없어 정보 전달력이 없다"는 실사용 피드백으로 hover 툴팁(날짜+정성적 논조)과
// 시작/종료일 라벨을 추가 — WeeklyChart.tsx의 Tooltip contentStyle 패턴 재사용.
function NewsSentimentSparkline({ points }: { points: { date: string; score: number }[] }) {
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div className="mb-2">
      <div style={{ height: 44 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            {/* hide — 축을 시각적으로 그리지 않되, Tooltip의 label 소스로 dataKey="date"를
                제공하기 위함. XAxis 자체가 없으면 recharts가 배열 인덱스를 label로 넘겨서
                hover 시 날짜 대신 "1/1"(인덱스를 Date로 오인 파싱한 값)이 뜨는 버그가 있었음
                (2026-08-21 실사용 스크린샷으로 발견). */}
            <XAxis dataKey="date" hide />
            <Tooltip
              formatter={(value: number) => [sentimentDayLabel(value), '논조']}
              labelFormatter={(d: string) => fmtMonthDay(d)}
              contentStyle={{ backgroundColor: '#1a1f2e', border: '1px solid #334155', borderRadius: '6px', fontSize: '11px' }}
              labelStyle={{ color: '#94a3b8' }}
              itemStyle={{ color: '#c7d2fe' }}
              cursor={{ stroke: '#475569', strokeDasharray: '3 3' }}
            />
            <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {first && last && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-slate-600">{fmtMonthDay(first.date)}</span>
          <span className="text-[10px] text-slate-600">{fmtMonthDay(last.date)}</span>
        </div>
      )}
      <p className="text-[10px] text-slate-600 mt-0.5 text-right">최근 {points.length}거래일 · 데이터 있는 날짜만 연결</p>
    </div>
  );
}

function fmt(n: number) { return n.toLocaleString(); }
function fmtRate(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

// 2026-08-11 스트리밍 전환 — components/stock/AiAnalysis.tsx의 FieldSkeleton/TypingCursor와
// 동일한 시각 언어를 재사용. 아직 도착하지 않은 AI 필드 자리에 스켈레톤을, 지금 문자
// 단위로 채워지는 중인 필드 끝에는 타이핑 커서를 붙인다. isGenerating이 기본값 false라
// 이 두 컴포넌트를 쓰지 않는 기존 호출부(app/welcome/page.tsx 등)는 동작이 그대로다.
function FieldSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="space-y-1.5 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded bg-slate-700/40"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

function TypingCursor() {
  return <span className="ml-0.5 text-indigo-300 animate-pulse font-light">▌</span>;
}

// newsIssueClusters(뉴스 인덱스 기준 이슈 묶음)를 "참고 기사" 렌더링용 그룹으로 변환.
// 클러스터가 없으면(뉴스가 적어 나눌 게 없는 경우 등) null을 반환해 호출부가 기존
// flat 목록 렌더링으로 폴백하게 한다. 모델이 일부 기사를 어느 클러스터에도 안 넣었을
// 수 있어(전체 커버를 강제하지 않음), 남은 인덱스는 "기타" 묶음으로 자동 보완한다.
function buildNewsGroups(
  news: { title: string; description: string; url?: string }[],
  clusters?: { label: string; articleIndexes: number[] }[],
): { label: string; indexes: number[] }[] | null {
  if (!clusters || clusters.length === 0) return null;
  const covered = new Set<number>();
  const groups = clusters.map((c) => {
    const indexes = c.articleIndexes.filter((i) => i >= 0 && i < news.length);
    indexes.forEach((i) => covered.add(i));
    return { label: c.label, indexes };
  }).filter((g) => g.indexes.length > 0);
  if (groups.length === 0) return null;
  const leftover = news.map((_, i) => i).filter((i) => !covered.has(i));
  if (leftover.length > 0) groups.push({ label: '기타', indexes: leftover });
  return groups;
}

function StatDelta({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[13px] font-bold font-mono ${positive ? 'text-red-400' : 'text-blue-400'}`}>{value}</span>
    </div>
  );
}

// "오늘의 기업 분석" 본문 — mainAnalysisSections가 있으면(신규 리포트) 소제목별로 나눠
// 렌더링하고, 없으면(과거 레코드/JSON 파싱 실패 fallback) 기존처럼 mainAnalysis 문자열을
// 그대로 한 문단으로 렌더링한다. 두 경로가 항상 공존해야 과거 저장된 stock_diagnosis
// 레코드도 계속 정상적으로 보인다.
// 2026-08-12: mainAnalysisSections를 4개의 독립 string 필드로 스키마 분리(서버가
// mainAnalysisSections_background 등 4개 top-level 필드를 스트리밍하고, 클라이언트가
// 다시 이 객체로 merge — app/diagnosis/page.tsx의 applyDiagnosisField 참고)한 덕분에
// institutionalFlow/sectorNarrative와 동일한 패턴(글자 있으면 표시+커서, 생성 중이면
// 스켈레톤, 아니면 숨김)으로 4블록을 각각 독립적으로 타이핑 렌더링할 수 있게 됐다.
const MAIN_ANALYSIS_BLOCKS = [
  { key: 'mainAnalysisSections_background',    field: 'background',    label: '오늘의 주가 배경' },
  { key: 'mainAnalysisSections_flowSummary',   field: 'flowSummary',   label: '수급 동향' },
  { key: 'mainAnalysisSections_valuationNote', field: 'valuationNote', label: '밸류에이션' },
  { key: 'mainAnalysisSections_watchPoint',    field: 'watchPoint',    label: '관찰 포인트' },
] as const;

function MainAnalysisBody({ result, isGenerating, revealed }: { result: DiagnosisResult; isGenerating?: boolean; revealed?: Record<string, RevealedField> }) {
  const s = result.mainAnalysisSections;
  // 신규 리포트는 스트리밍 도중에도 mainAnalysisSections가 (빈 문자열 포함) 항상 존재하므로
  // (applyDiagnosisField가 최초 merge 시 4개 필드를 빈 문자열로 채워둠), 과거 레코드(완전
  // undefined)만 이 분기로 떨어져 기존 mainAnalysis 문자열 폴백을 그대로 사용한다.
  if (!s) {
    if (isGenerating && !result.mainAnalysis) {
      return (
        <div className="flex flex-col gap-3.5">
          {MAIN_ANALYSIS_BLOCKS.map(({ label }) => (
            <div key={label}>
              <p className={`${SECTION_TITLE_CLASS} text-indigo-400/80 uppercase tracking-wide mb-1`}>{label}</p>
              <FieldSkeleton lines={2} />
            </div>
          ))}
        </div>
      );
    }
    return <p className="text-xs text-slate-300 leading-relaxed">{result.mainAnalysis}</p>;
  }

  const blocks = MAIN_ANALYSIS_BLOCKS.map((b) => ({ ...b, text: s[b.field] }));

  return (
    <div className="flex flex-col gap-3.5">
      {blocks.map((b) => (
        b.text ? (
          <div key={b.label}>
            <p className={`${SECTION_TITLE_CLASS} text-indigo-400/80 uppercase tracking-wide mb-1`}>{b.label}</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              {revealed?.[b.key]?.text ?? b.text}{revealed?.[b.key]?.active && <TypingCursor />}
            </p>
          </div>
        ) : isGenerating ? (
          <div key={b.label}>
            <p className={`${SECTION_TITLE_CLASS} text-indigo-400/80 uppercase tracking-wide mb-1`}>{b.label}</p>
            <FieldSkeleton lines={2} />
          </div>
        ) : null
      ))}
    </div>
  );
}

// "YYYY-MM-DD" → "8/18" — 카드 안에서만 쓰는 짧은 날짜 라벨.
function fmtShortDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

// 그때(직전 진단)/지금(오늘)의 "절대적 손익 상태" 한 블록. 색상은 이 블록 자신의
// 부호로 정한다(수익=빨강/손실=파랑 — 한국 관례) — 델타 부호로 정하지 않는다.
// emphasize(오늘 쪽)만 크고 진하게 키워 "지금 수익 중인지 손실 중인지"가 먼저 눈에
// 들어오게 하고, 그때 쪽은 같은 색 규칙을 쓰되 작고 옅게 눌러 보조 정보로 남긴다.
function StateBlock({ label, rate, amount, emphasize }: { label: string; rate: number; amount: number; emphasize: boolean }) {
  const color = rate >= 0 ? 'text-red-400' : 'text-blue-400';
  return (
    <div className={emphasize ? '' : 'opacity-60'}>
      <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
      <p className={`font-mono font-bold ${color} ${emphasize ? 'text-[18px]' : 'text-[13px]'}`}>
        {fmtRate(rate)}
      </p>
      <p className={`font-mono ${color} ${emphasize ? 'text-[12px]' : 'text-[10.5px]'}`}>
        {amount >= 0 ? '+' : ''}{fmt(Math.round(amount))}원
      </p>
    </div>
  );
}

// 그때→지금 조합별 보조 문구 — 델타 부호만이 아니라 "상태(수익/손실) 유지냐 전환이냐"까지
// 구분해서 서술한다. 수익유지(증가/감소)·수익→손실전환·손실→수익전환·손실유지(악화/회복)
// 6가지 조합을 전부 커버(설계 검토에서 요구한 4가지 핵심 케이스 + 대칭 케이스).
function buildStateSentence(prevRate: number, rateDelta: number, amountDelta: number): string {
  const prevProfit = prevRate >= 0;
  const currProfit = prevRate + rateDelta >= 0;
  const rateStr   = `${rateDelta >= 0 ? '+' : ''}${rateDelta.toFixed(2)}%p`;
  const amountStr = `${amountDelta >= 0 ? '+' : ''}${fmt(Math.round(amountDelta))}원`;
  const deltaTxt  = `직전 대비 ${rateStr}(${amountStr})`;

  if (prevProfit && currProfit) {
    return rateDelta >= 0
      ? `${deltaTxt} 늘며 수익 폭이 커졌습니다.`
      : `${deltaTxt} 줄었지만, 여전히 수익 구간입니다.`;
  }
  if (prevProfit && !currProfit) {
    return `${deltaTxt} — 직전 수익 구간에서 손실로 전환됐습니다.`;
  }
  if (!prevProfit && currProfit) {
    return `${deltaTxt} — 직전 손실 구간에서 수익으로 전환됐습니다.`;
  }
  return rateDelta < 0
    ? `${deltaTxt} — 손실 폭이 커졌습니다.`
    : `${deltaTxt} — 손실 폭이 줄었지만, 여전히 손실 구간입니다.`;
}

// "직전 기업분석 대비" 카드 — 그때/지금의 절대 손익 상태를 나란히 먼저 보여주고, 변화량은
// 그 아래 보조 문구로만 붙인다(2026-08-28 재설계 — 델타만 보여주면 "지금도 수익 중인데
// 손실 난 것처럼" 오해할 수 있다는 문제 대응). 델타 수치·상태 문구 전부 서버가 계산해
// 넘긴 값으로 서버가/이 컴포넌트가 결정형으로 만들고(AI가 지어낸 숫자 아님), narrative만
// AI 해석 문장이다.
function HistoryCompareCard({ result, isGenerating, revealed }: { result: DiagnosisResult; isGenerating?: boolean; revealed?: Record<string, RevealedField> }) {
  const h = result.history;
  const isFirst = h.daysSince === null;
  const label = isFirst
    ? '🔄 첫 기업분석'
    : h.daysSince === 1
      ? '🔄 어제 대비'
      : h.daysSince! <= 6
        ? `🔄 ${h.daysSince}일 전 진단 대비`
        : '🔄 오랜만에 재조회';

  // 2026-07-30 발견: 매입평균가가 직전 진단과 달라지면 수익률(%)도 손익 금액과 마찬가지로
  // 서로 다른 기준(분모)으로 계산된 값이라 단순 차감이 무의미해진다(실측 사례 —
  // avgPrice 70,000→290,000일 때 rateDelta가 -313.12%p로 왜곡됨). amountDelta와
  // 동일하게 holdingsChanged로 게이팅. priceDelta는 매입가와 무관해 계속 유효.
  const canCompareState = !isFirst && !h.holdingsChanged && typeof h.prevProfitRate === 'number' && typeof h.prevProfitAmount === 'number';
  const rateDelta   = canCompareState ? result.profitRate - h.prevProfitRate! : null;
  const amountDelta = canCompareState ? result.profitAmount - h.prevProfitAmount! : null;
  const priceDelta  = !isFirst && typeof h.prevCurrentPrice === 'number' ? result.currentPrice - h.prevCurrentPrice : null;
  const prevDateLabel = h.prevDate ? fmtShortDate(h.prevDate) : null;

  return (
    <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-2xl px-5 py-4 mb-4">
      <p className={`${SECTION_TITLE_CLASS} text-indigo-400 uppercase tracking-wide mb-2`}>{label}</p>
      {!isFirst && (
        <div className="mb-2.5">
          {canCompareState ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2">
              <StateBlock label={prevDateLabel ? `직전 진단(${prevDateLabel})` : '직전 진단'} rate={h.prevProfitRate!} amount={h.prevProfitAmount!} emphasize={false} />
              <span className="text-slate-600 text-[13px]">→</span>
              <StateBlock label="오늘" rate={result.profitRate} amount={result.profitAmount} emphasize />
            </div>
          ) : (
            <div className="mb-2">
              <StateBlock label="오늘" rate={result.profitRate} amount={result.profitAmount} emphasize />
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
            {canCompareState && (
              <span className="text-[11.5px] text-slate-400">
                {buildStateSentence(h.prevProfitRate!, rateDelta!, amountDelta!)}
              </span>
            )}
            {priceDelta !== null && (
              <StatDelta label="주가" value={`${priceDelta >= 0 ? '+' : ''}${fmt(Math.round(priceDelta))}원`} positive={priceDelta >= 0} />
            )}
            {h.holdingsChanged && (
              <span className="text-[11px] text-amber-500/80">보유정보 변경으로 수익률·손익 금액 비교 제외</span>
            )}
          </div>
        </div>
      )}
      {h.narrative ? (
        <p className="text-xs text-slate-300 leading-relaxed">
          {revealed?.historyNarrative?.text ?? h.narrative}{revealed?.historyNarrative?.active && <TypingCursor />}
        </p>
      ) : isGenerating ? (
        <FieldSkeleton lines={1} />
      ) : null}
    </div>
  );
}

// 매출(항상 양수, 크기 비교 — 순차형 단일 색상 바)과 영업이익(부호가 바뀔 수 있음 —
// 0 기준선 중심의 발산형 바)을 연도별로 한눈에 비교할 수 있게 표시. 2026-07-13
// "숫자를 읽어야만 알 수 있다"는 피드백으로, 텍스트 나열에서 막대 시각화로 전환.
// 색상은 페이지 전체가 이미 쓰고 있는 관례(상승/이익=red, 하락/손실=blue)를 그대로 따름.
function FinancialsTrendCard({ result, isGenerating, revealed }: { result: DiagnosisResult; isGenerating?: boolean; revealed?: Record<string, RevealedField> }) {
  const rows = result.annualFinancials;
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue ?? 0));
  const maxAbsOpProfit = Math.max(1, ...rows.map((r) => Math.abs(r.operatingProfit ?? 0)));

  return (
    <div className="bg-[#1a1f2e] border border-violet-500/20 rounded-2xl p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className={`px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
          실적 추이 (연간 확정치)
        </span>
      </div>
      <div className="flex flex-col gap-3.5 mb-3">
        {rows.map((r) => (
          <div key={r.year}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-400">{r.year}년</span>
              {r.roe !== null && <span className="text-[10px] text-slate-500 font-mono">ROE {r.roe}%</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              {/* 매출 — 순차형(단일 색) 바, 0 기준 좌측 정렬 */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-600 w-14 shrink-0">매출</span>
                <div className="flex-1 h-2 rounded-full bg-slate-800/60 overflow-hidden">
                  {r.revenue !== null && (
                    <div className="h-full rounded-full bg-indigo-400/70" style={{ width: `${Math.max(2, (r.revenue / maxRevenue) * 100)}%` }} />
                  )}
                </div>
                <span className="text-[11px] font-mono text-slate-300 tabular-nums w-20 text-right shrink-0">
                  {r.revenue !== null ? `${fmt(r.revenue)}억` : '-'}
                </span>
              </div>
              {/* 영업이익 — 발산형 바(0 기준선 중심), 흑자=red/적자=blue (페이지 전체 관례) */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-600 w-14 shrink-0">영업이익</span>
                <div className="relative flex-1 h-2 rounded-full bg-slate-800/60 overflow-hidden">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600/80" />
                  {r.operatingProfit !== null && (
                    r.operatingProfit >= 0 ? (
                      <div className="absolute inset-y-0 left-1/2 rounded-r-full bg-red-400/80" style={{ width: `${Math.max(2, (r.operatingProfit / maxAbsOpProfit) * 50)}%` }} />
                    ) : (
                      <div className="absolute inset-y-0 right-1/2 rounded-l-full bg-blue-400/80" style={{ width: `${Math.max(2, (Math.abs(r.operatingProfit) / maxAbsOpProfit) * 50)}%` }} />
                    )
                  )}
                </div>
                <span className={`text-[11px] font-mono tabular-nums w-20 text-right shrink-0 ${
                  r.operatingProfit === null ? 'text-slate-300' : r.operatingProfit >= 0 ? 'text-red-400' : 'text-blue-400'
                }`}>
                  {r.operatingProfit !== null ? `${r.operatingProfit >= 0 ? '+' : ''}${fmt(r.operatingProfit)}억` : '-'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {result.financialsNarrative ? (
        <p className="text-xs text-slate-300 leading-relaxed">
          {revealed?.financialsNarrative?.text ?? result.financialsNarrative}{revealed?.financialsNarrative?.active && <TypingCursor />}
        </p>
      ) : isGenerating ? (
        <FieldSkeleton lines={2} />
      ) : null}
    </div>
  );
}

interface DiagnosisReportProps {
  result: DiagnosisResult;
  stockName: string;
  ticker: string;
  generatedAt: string;
  onReset?: () => void;
  actions?: boolean;        // 공유·인쇄·다시진단 버튼 노출 여부 (기본 true)
  showBackground?: boolean; // PageBackground(파티클 캔버스) 렌더 여부 (기본 true)
  // 2026-08-31 QA에서 발견: welcome 페이지 예시 썸네일(DiagnosisThumb)이 존재하지 않는
  // 가짜 티커("000000")로 이 컴포넌트를 렌더링하는데, PriceChangeTable은 result의 허구
  // 데이터와 무관하게 ticker prop만 보고 실제 라이브 API를 호출해 매 방문마다 500 에러가
  // 났다(축소·클리핑된 썸네일이라 화면엔 안 보였지만 서버 호출·에러로그는 실제로 발생).
  // 기본값 true라 실제 종목분석 페이지는 변경 없음 — 정적 예시 호출부만 false로 끔.
  livePriceTable?: boolean;
  // 2026-08-11 스트리밍 전환 — 둘 다 기본값(false/null)이면 이전과 완전히 동일하게 동작한다
  // (app/welcome/page.tsx 등 정적 예시 호출부는 변경 없음). app/diagnosis/page.tsx만 SSE
  // 진행 상태를 실어 넘긴다.
  isGenerating?: boolean;    // true면 아직 도착하지 않은 AI 필드 자리에 스켈레톤을 그림
  // 2026-08-12 클라이언트 측 smooth streaming(lib/useSmoothTypingText.ts) — 키(필드명)별로
  // 화면에 보여줄 텍스트와, 아직 목표 길이를 못 따라잡아 타이핑 커서를 그려야 하는지(active)를 담음.
  revealed?: Record<string, RevealedField>;
}

// app/diagnosis/page.tsx의 결과 리포트 뷰를 그대로 추출한 컴포넌트.
// 실제 종목진단 페이지와 랜딩페이지(ai-portfolio) 예시 카드가 이 컴포넌트를 공유하므로
// 리포트 UI가 바뀌면 두 곳 모두 자동으로 최신 상태를 유지한다.
// (app/share/[id]/page.tsx의 DiagnosisView는 별도로 손복제돼 있어 이 파일과 함께 갱신할 것 —
// 단, SurgeHistoryCard/TradingValueMultipleCard/PerformanceSnapshotCard처럼 훅·브라우저 API를
// 안 쓰는 순수 카드는 components/diagnosis/ 아래 공용 컴포넌트로 뽑아 두 곳에서 재사용 중이니,
// 그런 카드를 고칠 땐 손복제가 아니라 그 공용 파일을 고치면 된다.)
export default function DiagnosisReport({
  result, stockName, ticker, generatedAt, onReset, actions = true, showBackground = true,
  isGenerating = false, revealed, livePriceTable = true,
}: DiagnosisReportProps) {
  const newsGroups = buildNewsGroups(result.news, result.newsIssueClusters);

  return (
    <div className="pb-8">
      {showBackground && <PageBackground />}
      <div className="max-w-5xl mx-auto px-4 pt-8">

        {/* ── 헤더 ── */}
        <div className="flex justify-between mb-6 gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">AI 상세 분석 리포트</p>
            <h1 className="text-[22px] font-bold text-white tracking-wide">
              {stockName.toUpperCase()}{' '}
              <span className="text-slate-500 font-mono text-base font-normal">({ticker})</span>
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">리포트 생성 시각: {generatedAt}</p>
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0 mt-1 no-print">
              <ShareDropdown
                title={`AI 기업 분석 - ${stockName}`}
                description={`수익률 ${result.profitRate >= 0 ? '+' : ''}${result.profitRate.toFixed(2)}% | ${result.mainAnalysis?.slice(0, 80) ?? ''}`}
                hashtags="fpark,기업분석,AI분석"
                reportType="diagnosis"
                reportData={{ ...result, stockName, ticker, generatedAt }}
              />
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30
                  border border-indigo-500/40 text-indigo-300 text-[11px] font-semibold tracking-wide transition-colors cursor-pointer"
              >
                <Printer className="w-3 h-3" /> PRINT REPORT
              </button>
            </div>
          )}
        </div>

        {/* ── 상단 면책 안내 (눈에 띄게) ── */}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 mb-5">
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[12px] text-amber-200/90 leading-relaxed">{INVESTMENT_DISCLAIMER}</p>
        </div>

        {/* ── 1행: 오늘의 기업 분석 (65%) + PERFORMANCE SNAPSHOT (35%) ── */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 mb-4">

          {/* 오늘의 기업 분석 (서술형, 매수/매도/홀딩 의견 아님) */}
          <div className="rounded-2xl border border-slate-700/50 overflow-hidden" style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}>
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black bg-indigo-500/10 border border-indigo-500/30">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest`}>오늘의 기업 분석</p>
                </div>
              </div>
              <MainAnalysisBody result={result} isGenerating={isGenerating} revealed={revealed} />
              {result.finalVerdict && (
                <div className="mt-5 pt-5 border-t border-slate-700/50">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">AI 종합 진단</p>
                  <div className="bg-indigo-500/10 border-l-2 border-indigo-400/50 rounded-r-lg px-3 py-2.5">
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {revealed?.finalVerdict?.text ?? result.finalVerdict}{revealed?.finalVerdict?.active && <TypingCursor />}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* PERFORMANCE SNAPSHOT */}
          <PerformanceSnapshotCard
            currentPrice={result.currentPrice}
            profitRate={result.profitRate}
            profitAmount={result.profitAmount}
            avgPrice={result.avgPrice}
            quantity={result.quantity}
            resistance={result.resistance}
            support={result.support}
            benchmark={result.benchmark}
            isCached={result.isCached}
            cachedAt={result.cachedAt}
          />
        </div>

        {/* ── 2행: 직전 기업분석 대비 (신설) ── */}
        <HistoryCompareCard result={result} isGenerating={isGenerating} revealed={revealed} />

        {/* ── 2-1행: 주요 공시 (DART, 있을 때만 — 눈에 띄게 강조) ── */}
        {result.disclosures.length > 0 && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className={`${SECTION_TITLE_CLASS} text-amber-400 uppercase tracking-widest`}>주요 공시 (DART)</span>
            </div>
            <div className="flex flex-col gap-2 mb-3">
              {result.disclosures.map((d, i) => (
                <a
                  key={i}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/30 px-3 py-2 hover:bg-slate-900/50 transition-colors group"
                >
                  <span className="text-[13px] text-amber-100/90 group-hover:text-amber-200 group-hover:underline leading-snug">{d.title}</span>
                  <span className="text-[11px] text-amber-400/70 font-mono shrink-0">{d.date}</span>
                </a>
              ))}
            </div>
            {result.disclosureNarrative ? (
              <p className="text-xs text-slate-300 leading-relaxed">
                {revealed?.disclosureNarrative?.text ?? result.disclosureNarrative}{revealed?.disclosureNarrative?.active && <TypingCursor />}
              </p>
            ) : isGenerating ? (
              <FieldSkeleton lines={1} />
            ) : null}
          </div>
        )}

        {/* ── 3-1행: 기간별 등락률 (종목분석 페이지와 동일 컴포넌트 재사용) ── */}
        {livePriceTable && (
          <div className="mb-4">
            <PriceChangeTable ticker={ticker} />
          </div>
        )}

        {/* ── 3-2행: 배당 정보 (DART 최신 사업연도 요약 + KIS 최근 5년 지급이력) ── */}
        <DividendInfo summary={result.dividendSummary} history={result.dividendHistory} />

        {/* ── 4행: 기관/외국인 동향 도넛 + 업종 대비 + 리스크 요인 ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

          {/* 기관/외국인 동향 — 도넛 차트 (설명 텍스트는 본문에 흡수, 여기는 캡션 한 줄만) */}
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className={`${SECTION_TITLE_CLASS} text-slate-400 uppercase tracking-widest`}>기관/외국인 동향</p>
            </div>

            {/* 도넛 차트 — flowPercentage는 "오늘 하루" 순매매 강도(평소 거래대금 대비 정규화값)라
                최근 5일 캡션과 기간이 다르다. 소제목·구분선으로 명시해 같은 카드 안에서 서로 다른
                기간의 수치가 섞여 보이지 않게 한다. */}
            <p className="text-center text-[10px] font-bold tracking-wide text-slate-500 mb-2">오늘 수급 강도</p>
            <div className="flex flex-col items-center py-2">
              <DonutChart
                percent={result.flowPercentage ?? 50}
                type={result.flowType ?? 'NEUTRAL'}
              />
              <p className="text-center text-[10px] text-slate-600 leading-snug mt-2">평소 거래대금 대비 이례적 쏠림 정도</p>
            </div>

            {/* 구분선 — 도넛(오늘)과 아래 캡션(최근 5일)이 다른 기간의 데이터임을 시각적으로 분리 */}
            <div className="flex items-center gap-2.5 mt-4 mb-3">
              <span className="flex-1 h-px bg-slate-700/40" />
              <span className="text-[10px] font-bold tracking-wide text-slate-500 whitespace-nowrap">최근 5일 흐름</span>
              <span className="flex-1 h-px bg-slate-700/40" />
            </div>

            {/* 캡션 (기관/외국인 각 한 줄) */}
            <div className="flex flex-col gap-1.5">
              {result.institutionalFlow ? (
                <p className="text-center text-xs text-slate-400 leading-relaxed">
                  {revealed?.institutionalFlow?.text ?? result.institutionalFlow}{revealed?.institutionalFlow?.active && <TypingCursor />}
                </p>
              ) : isGenerating ? (
                <FieldSkeleton lines={1} />
              ) : null}
              {result.foreignFlow ? (
                <p className="text-center text-xs text-slate-400 leading-relaxed">
                  {revealed?.foreignFlow?.text ?? result.foreignFlow}{revealed?.foreignFlow?.active && <TypingCursor />}
                </p>
              ) : isGenerating ? (
                <FieldSkeleton lines={1} />
              ) : null}
            </div>
          </div>

          {/* 업종 대비 (동종업계 peer 없으면 카드 자체 생략) — 카드 전체가 공유 페이지와
              공유하는 컴포넌트(SectorComparisonCard, 드리프트 방지). narrative만 이 페이지의
              스트리밍 타이핑 커서 상태를 반영해 여기서 조립해 넘긴다. */}
          {result.sectorComparison && (
            <SectorComparisonCard
              data={result.sectorComparison}
              narrative={
                result.sectorNarrative ? (
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {revealed?.sectorNarrative?.text ?? result.sectorNarrative}{revealed?.sectorNarrative?.active && <TypingCursor />}
                  </p>
                ) : isGenerating ? (
                  <FieldSkeleton lines={2} />
                ) : null
              }
            />
          )}

          {/* 리스크 요인 */}
          <div className="bg-[#1a1f2e] border border-red-500/20 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className={`px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
                Risk Factors
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {result.riskFactors.length > 0 ? (
                result.riskFactors.map((line, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-red-500/60 text-[10px] mt-1 shrink-0">▶</span>
                    <p className="text-xs text-slate-300 leading-relaxed">{line}</p>
                  </div>
                ))
              ) : isGenerating ? (
                <FieldSkeleton lines={3} />
              ) : null}
            </div>
          </div>
        </div>

        {/* ── 4-1행: 최근 뉴스 논조 추이 (2026-08-21 신설) — news_sentiment_daily는
            CURATED_TICKERS_MKT(대형주 100종목) 한정 크론이라 그 밖의 종목·데이터 부족(5거래일
            미만)이면 서버가 newsSentiment를 null로 보내며, 그 경우 카드 자체를 생략한다
            (업종 대비 카드와 동일한 "근거 부족하면 생략" 관례). raw score(-1~1)는 노출하지
            않고 3단계 텍스트 라벨로만 보여준다 — 매수/매도 신호처럼 읽히는 걸 피하기 위함. ── */}
        {SHOW_NEWS_SENTIMENT_CARD && result.newsSentiment && (
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <p className={`${SECTION_TITLE_CLASS} text-slate-400 uppercase tracking-widest`}>최근 뉴스 논조 추이</p>
              <span className="text-[11px] font-semibold text-indigo-300">{result.newsSentiment.label}</span>
            </div>
            <NewsSentimentSparkline points={result.newsSentiment.points} />
            {(() => {
              const direction = computeSentimentDirection(result.newsSentiment!.points);
              return direction ? (
                <p className="text-[12px] text-slate-300 leading-relaxed mt-2">{direction}</p>
              ) : null;
            })()}
            <p className="text-[11px] text-slate-500 leading-relaxed mt-2">
              최근 {result.newsSentiment.availableDays}거래일간 관련 기사의 호재·악재성 사실 비율 변화이며, 주가 방향을 예측하는 투자 신호가 아닙니다.
            </p>
          </div>
        )}

        {/* ── 5행: 단기/중기 관찰 변수 ── */}
        {(result.shortTermOutlook || result.midTermOutlook || isGenerating) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {(result.shortTermOutlook || isGenerating) && (
              <div className="bg-[#1a1f2e] border border-indigo-500/20 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
                    단기 관찰 변수
                  </span>
                </div>
                {result.shortTermOutlook ? (
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {revealed?.shortTermOutlook?.text ?? result.shortTermOutlook}{revealed?.shortTermOutlook?.active && <TypingCursor />}
                  </p>
                ) : (
                  <FieldSkeleton lines={2} />
                )}
              </div>
            )}
            {(result.midTermOutlook || isGenerating) && (
              <div className="bg-[#1a1f2e] border border-violet-500/20 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
                    중기 관찰 변수
                  </span>
                </div>
                {result.midTermOutlook ? (
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {revealed?.midTermOutlook?.text ?? result.midTermOutlook}{revealed?.midTermOutlook?.active && <TypingCursor />}
                  </p>
                ) : (
                  <FieldSkeleton lines={2} />
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 5-0-1행: 환율 상관관계 (최근 1년, |r|<0.3이거나 표본 부족이면 카드 자체 생략) ── */}
        {result.fxCorrelation && (
          <div className="bg-[#1a1f2e] border border-cyan-500/20 rounded-2xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className={`px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 uppercase tracking-wider ${SECTION_TITLE_CLASS}`}>
                환율 상관관계
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              최근 1년간 이 종목은 원/달러 환율과 {result.fxCorrelation.correlation >= 0 ? '+' : ''}{result.fxCorrelation.correlation}의 {result.fxCorrelation.correlation >= 0 ? '양(+)' : '음(-)'}의 상관관계를 보여왔습니다.
            </p>
          </div>
        )}

        {/* ── 5-0-2행: 급등/급락 이력 + 거래대금 배수 (내부 계산 지표 원자료 카드화, 2026-08-27
            신설). 2026-08-28 수정: 급등이력은 유사 사례가 없는 게 대다수 종목의 기본
            상태지만, 거래대금 배수(평상시 1배 안팎도 항상 표시)와 시각적 일관성을 맞추려
            hasMatches:false여도 카드는 그리고 내부에서 "이력 없음" 빈 상태를 보여준다 —
            surgeHistory 객체 자체가 없을 때(과거 레코드·계산 실패로 null/undefined)만
            생략한다. 거래대금 배수는 기존과 동일하게 valid일 때만 표시. 둘 다 없으면
            행 자체가 생략된다. ── */}
        {((result.surgeHistory != null) || (result.tradingValueMultiple?.valid)) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {result.surgeHistory != null && (
              <SurgeHistoryCard surgeHistory={result.surgeHistory} />
            )}
            {result.tradingValueMultiple?.valid && (
              <TradingValueMultipleCard t={result.tradingValueMultiple} />
            )}
          </div>
        )}

        {/* ── 5-1행: 실적 추이 (최근 3개년 확정 연간, 데이터 없으면 카드 생략) ── */}
        {result.annualFinancials.length > 0 && (
          <FinancialsTrendCard result={result} isGenerating={isGenerating} revealed={revealed} />
        )}

        {/* ── 6행: 참고 기사 (본문에서 이미 해석했으므로 출처 링크만) ── */}
        <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest`}>참고 기사</p>
            {result.newsBasis === 'news' ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                📰 뉴스 기반 분석
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-400 border border-slate-600/40">
                🔍 수급·기술적 추정
              </span>
            )}
          </div>
          {result.news?.length > 0 ? (
            newsGroups ? (
              <div className="flex flex-col gap-4">
                {newsGroups.map((g, gi) => (
                  <div key={gi}>
                    <p className="text-[11px] font-bold text-indigo-300/90 mb-1.5">
                      {g.label !== '기타' && '🔖 '}{g.label}
                    </p>
                    <div className="flex flex-col divide-y divide-slate-700/40">
                      {g.indexes.map((i) => {
                        const n = result.news[i];
                        const href = n.url || `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(n.title)}`;
                        return (
                          <a
                            key={i}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="py-2 first:pt-0 last:pb-0 group cursor-pointer flex items-center gap-2.5"
                          >
                            <span className="text-[10px] font-bold text-slate-600 shrink-0 w-4">{i + 1}</span>
                            <p className="text-[13px] text-slate-300 leading-snug group-hover:text-indigo-300 group-hover:underline transition-colors">
                              {n.title}
                            </p>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-slate-700/40">
                {result.news.map((n, i) => {
                  const href = n.url || `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(n.title)}`;
                  return (
                    <a
                      key={i}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2.5 first:pt-0 last:pb-0 group cursor-pointer flex items-center gap-2.5"
                    >
                      <span className="text-[10px] font-bold text-slate-600 shrink-0 w-4">{i + 1}</span>
                      <p className="text-[13px] text-slate-300 leading-snug group-hover:text-indigo-300 group-hover:underline transition-colors">
                        {n.title}
                      </p>
                    </a>
                  );
                })}
              </div>
            )
          ) : (
            <p className="text-xs text-slate-500 leading-relaxed">
              관련도 높은 뉴스가 확인되지 않아, 수급·기술적 지표를 근거로 분석했습니다.
            </p>
          )}
        </div>

        {/* 면책 */}
        <p className="text-[11px] text-slate-600 text-center leading-relaxed mb-6 px-4">
          {INVESTMENT_DISCLAIMER}
        </p>

        {/* 다시 진단받기 */}
        {actions && onReset && (
          <button onClick={onReset}
            className="flex items-center gap-2 mx-auto px-6 py-3 rounded-xl
              bg-slate-800 hover:bg-slate-700 border border-slate-700
              text-slate-300 text-[13px] transition-colors cursor-pointer">
            <ChevronLeft className="w-4 h-4" /> 다시 기업 분석 받기
          </button>
        )}
      </div>
    </div>
  );
}
