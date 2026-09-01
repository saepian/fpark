'use client';

import { ChevronLeft, Printer, AlertCircle } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import ShareDropdown from '@/components/ShareDropdown';
import PageBackground from '@/components/layout/PageBackground';
import PriceChangeTable from '@/components/stock/PriceChangeTable';
import ReferenceNewsList from '@/components/diagnosis/ReferenceNewsList';
import DividendInfo, { type DartDividendSummary, type DividendHistoryRow } from '@/components/diagnosis/DividendInfo';
import type { SurgeHistory, TradingValueMultiple } from '@/components/diagnosis/SurgeHistoryCard';
import {
  MainAnalysisCard, InstitutionalFlowCard, RiskFactorsCard, SurgeTradingRow, DisclosuresCard, FxCorrelationCard,
  LayerHeading, StreamText, FieldSkeleton, TypingCursor, type MainAnalysisSectionsData,
} from '@/components/diagnosis/DiagnosisCards';
import HoldingPositionCard from '@/components/diagnosis/HoldingPositionCard';
import FinancialsTrendCard from '@/components/diagnosis/FinancialsTrendCard';
import { WatchVariablesCard } from '@/components/portfolio/FactorCards';
import type { HoldingPosition } from '@/lib/holding-position';
import type { QuarterlyFinancialRow } from '@/lib/kis-api';
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

export type MainAnalysisSections = MainAnalysisSectionsData;

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
  quarterlyFinancials?: QuarterlyFinancialRow[]; // 최근 분기 단독 실적(2026-09-01 신설, 과거 레코드는 undefined)
  financialsYearEndMonth?: string; // 결산월('12' 외면 실적 카드에 "N월 결산" 캡션)
  holdingPosition?: HoldingPosition | null; // 내 포지션(2026-09-01 신설, 서버 계산 — 과거 레코드는 undefined → 카드 생략)
  flowInsight?: string; // 수급 해석 1문장(기관/외국인 카드, 2026-09-01 신설 — 1층 '수급 동향' 소제목을 대체)
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
          <span className="text-[11px] text-slate-600">{fmtMonthDay(first.date)}</span>
          <span className="text-[11px] text-slate-600">{fmtMonthDay(last.date)}</span>
        </div>
      )}
      <p className="text-[11px] text-slate-600 mt-0.5 text-right">최근 {points.length}거래일 · 데이터 있는 날짜만 연결</p>
    </div>
  );
}

function fmt(n: number) { return n.toLocaleString(); }
function fmtRate(r: number) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`; }

// 2026-08-11 스트리밍 전환 — components/stock/AiAnalysis.tsx의 FieldSkeleton/TypingCursor와
// 동일한 시각 언어를 재사용. 아직 도착하지 않은 AI 필드 자리에 스켈레톤을, 지금 문자
// 단위로 채워지는 중인 필드 끝에는 타이핑 커서를 붙인다. isGenerating이 기본값 false라
// 이 두 컴포넌트를 쓰지 않는 기존 호출부(app/welcome/page.tsx 등)는 동작이 그대로다.
function StatDelta({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[13px] font-bold font-mono ${positive ? 'text-red-400' : 'text-blue-400'}`}>{value}</span>
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
// 2026-09-01: 두 블록을 카드 폭을 반씩 나눠 채우는 미니 패널(배당 정보 카드의 미니카드와
// 같은 bg-slate-800 계열)로 바꿈 — 예전엔 내용만큼만 차지하는 flex라 카드 우측 60%가
// 빈 공간으로 남았다. 부모가 grid [1fr auto 1fr]로 폭을 배분하므로 여기선 min-w-0만 챙긴다.
// 2026-09-01(2차): 수익률과 손익금액을 두 줄이 아니라 "−10.34% · −1,440,000원" 한 줄로 합침.
// 모노 18px 기준 20자 남짓이라 390px 화면에서 두 패널을 가로로 두면(패널 내용폭 ≈116px)
// 절대 한 줄에 못 들어간다 — 부모 grid를 sm 미만에서는 세로 스택(화살표 ↓)으로 바꿔
// 패널이 카드 전폭(≈290px)을 쓰게 하고, whitespace-nowrap으로 줄바꿈을 금지한다.
function StateBlock({ label, rate, amount, emphasize }: { label: string; rate: number; amount: number; emphasize: boolean }) {
  const color = rate >= 0 ? 'text-red-400' : 'text-blue-400';
  return (
    <div className={`min-w-0 flex flex-col justify-center rounded-xl px-3.5 py-2.5 ${emphasize ? 'bg-slate-800/40 border border-slate-700/40' : 'bg-slate-800/20 border border-transparent opacity-70'}`}>
      <p className="text-[11px] text-slate-500 mb-0.5 truncate">{label}</p>
      <p className={`font-mono ${color} flex items-baseline gap-1.5 whitespace-nowrap`}>
        <span className={`font-bold ${emphasize ? 'text-[18px]' : 'text-[13px]'}`}>{fmtRate(rate)}</span>
        <span className={`text-slate-600 ${emphasize ? 'text-[12px]' : 'text-[11px]'}`}>·</span>
        <span className={emphasize ? 'text-[12px]' : 'text-[11px]'}>
          {amount >= 0 ? '+' : ''}{fmt(Math.round(amount))}원
        </span>
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
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 mb-2">
              <StateBlock label={prevDateLabel ? `직전 진단(${prevDateLabel})` : '직전 진단'} rate={h.prevProfitRate!} amount={h.prevProfitAmount!} emphasize={false} />
              <span className="self-center justify-self-center text-slate-600 text-[13px] rotate-90 sm:rotate-0">→</span>
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

  return (
    <div className="pb-8">
      {showBackground && <PageBackground />}
      <div className="max-w-5xl mx-auto px-4 pt-8">

        {/* ── 헤더 ── */}
        <div className="flex justify-between mb-6 gap-4">
          <div>
            <p className="text-[11px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-1.5">AI 상세 분석 리포트</p>
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

        {/* ── 1층: 한눈에 — 주가 배경 → 밸류에이션 → AI 종합 진단 (+ 성과 스냅샷) ── */}
        <LayerHeading no={1} title="한눈에" sub="주가 배경 · 밸류에이션 · AI 종합 진단" />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 mb-6">
          <MainAnalysisCard
            sections={result.mainAnalysisSections}
            mainAnalysis={result.mainAnalysis}
            finalVerdict={result.finalVerdict}
            revealed={revealed}
            isGenerating={isGenerating}
          />
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

        {/* ── 2층: 내 포지션 — 신설 카드(서버 계산) + 관찰 포인트(내 포지션 관점) + 직전 진단 대비 + 기간별 등락률 ── */}
        <LayerHeading no={2} title="내 포지션" sub="매입가 · 보유기간 기준" />
        <HoldingPositionCard
          position={result.holdingPosition}
          className="mb-4"
          narrative={(result.mainAnalysisSections?.watchPoint || (isGenerating && result.mainAnalysisSections)) ? (
            <StreamText value={result.mainAnalysisSections?.watchPoint} k="mainAnalysisSections_watchPoint" revealed={revealed} pending={isGenerating} />
          ) : null}
        />
        <HistoryCompareCard result={result} isGenerating={isGenerating} revealed={revealed} />
        {livePriceTable && (
          <div className="mb-6">
            <PriceChangeTable ticker={ticker} />
          </div>
        )}

        {/* ── 3층: 종목 구조 — 수급(서술처 1곳) · 업종 대비 · 실적(연간+분기) · 배당 · 급등락/거래대금 · 환율 ── */}
        <LayerHeading no={3} title="종목 구조" sub="수급 · 업종 · 실적 · 배당 · 거래" />
        <div className={`grid grid-cols-1 ${result.sectorComparison ? 'md:grid-cols-2' : ''} gap-4 mb-4`}>
          <InstitutionalFlowCard
            flowType={result.flowType}
            flowPercentage={result.flowPercentage}
            flowInsight={result.flowInsight}
            institutionalFlow={result.institutionalFlow}
            foreignFlow={result.foreignFlow}
            revealed={revealed}
            isGenerating={isGenerating}
          />
          {result.sectorComparison && (
            <SectorComparisonCard
              data={result.sectorComparison}
              narrative={<StreamText value={result.sectorNarrative} k="sectorNarrative" revealed={revealed} pending={isGenerating} className="text-xs text-slate-400 leading-relaxed" />}
            />
          )}
        </div>
        <FinancialsTrendCard
          annual={result.annualFinancials}
          quarterly={result.quarterlyFinancials ?? []}
          yearEndMonth={result.financialsYearEndMonth}
          narrative={<StreamText value={result.financialsNarrative} k="financialsNarrative" revealed={revealed} pending={isGenerating} />}
          className="mb-4"
        />
        <DividendInfo summary={result.dividendSummary} history={result.dividendHistory} />
        <SurgeTradingRow surgeHistory={result.surgeHistory} tradingValueMultiple={result.tradingValueMultiple} className="mb-4" />
        <FxCorrelationCard fx={result.fxCorrelation} className="mb-4" />

        {/* 최근 뉴스 논조 추이(2026-08-21 신설, 현재 플래그로 숨김 — 재설계 완료 시 SHOW_NEWS_SENTIMENT_CARD=true) */}
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

        {/* ── 4층: 참고 자료 — DART 공시 · 종목 고유 리스크 · 확인할 이벤트·지표 · 참고 기사 ── */}
        <LayerHeading no={4} title="참고 자료" sub="공시 · 종목 고유 리스크 · 확인할 이벤트 · 기사" />
        <DisclosuresCard
          disclosures={result.disclosures}
          narrative={<StreamText value={result.disclosureNarrative} k="disclosureNarrative" revealed={revealed} pending={isGenerating} lines={1} />}
          className="mb-4"
        />
        <RiskFactorsCard riskFactors={result.riskFactors} isGenerating={isGenerating} className="mb-4" />
        <WatchVariablesCard
          shortTermOutlook={result.shortTermOutlook}
          midTermOutlook={result.midTermOutlook}
          pending={isGenerating}
          revealed={revealed}
          title="확인할 이벤트·지표"
          caption="이 종목 고유의 일정·공시·지표만 — 예측이 아니라 확인 목록입니다."
          className="mb-4"
        />
        <ReferenceNewsList news={result.news ?? []} clusters={result.newsIssueClusters} newsBasis={result.newsBasis} className="mb-4" />

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
