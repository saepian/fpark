import { NextRequest, NextResponse, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { fetchStockPrice, fetchStockInfo, fetchDailyChart } from '@/lib/kis-api';
import {
  computeSurgeHistory,
  computeTradingValueMultiple,
  computeRiskMetrics,
  buildSurgeHistoryBlock,
  buildTradingValueBlock,
  buildRiskMetricsBlock,
  buildNewsBlock,
} from '@/lib/stock-analysis-data';
import { COMPLIANCE_PRINCIPLE, INVESTMENT_DISCLAIMER, signalToSentiment, clampSignal, scanComplianceViolations, type Signal } from '@/lib/ai-compliance';
import { selectRelevantNews } from '@/lib/news-selection';
import { selectSectorMacroNews } from '@/lib/sector-news';
import { nowKstString, buildNewsFreshnessLine, TEMPORAL_GROUNDING_INSTRUCTION, MARKET_DAY_GROUNDING_INSTRUCTION, checkTemporalConsistency, kstDateStr, daysBetween } from '@/lib/ai-grounding';
import { getDomesticMarketDayContext, buildMarketDayBlock } from '@/lib/market-day-context';
import { checkPlan, resolveStockAnalysisLimit, getUsageCycleStart, isStockAnalysisDaily } from '@/lib/plan';
import { StreamingFieldParser, STOCK_ANALYSIS_FIELD_SPECS, type JsonFieldValue } from '@/lib/streaming-json-fields';
import type { Database } from '@/lib/database.types';

export const dynamic = 'force-dynamic';
// 캐시 없이 매 요청마다 KIS + Claude를 호출 — 관측된 응답 시간이 16~21초로
// Vercel 기본 함수 타임아웃을 넘길 수 있어 명시적으로 늘림 (diagnosis, portfolio-diagnosis와 동일)
export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export type ReportType = 'news-driven' | 'data-driven';

// 2026-07-10 "리포트가 매일 똑같아 보인다"는 문제 제기로 재설계. 핵심 원칙:
// 1) 뉴스 유무는 AI가 스스로 판단하지 않고 서버가 먼저 결정해서 프롬프트에 못박는다
//    (아래 reportType — selectRelevantNews 결과 유무로 결정, AI는 echo만 함).
// 2) 52주 고저가·PER 같은 정적 지표는 참고 정보로 격하하고 본문 근거로 못 쓰게 막는다.
// 3) "어제와 달라진 점"을 직접 계산해서 프롬프트에 주입해 대조 기준을 준다.
// 4) fpark 자체 계산 지표(급등이력/거래대금배수/MDD·변동성)를 최소 1개 강제 활용시킨다.
const COMMON_INSTRUCTIONS = `## 출력 형식 (JSON만)
{
  "reportType": "news-driven" | "data-driven",
  "headline": "오늘 리포트의 핵심을 담은 한 줄 제목 (매일 달라야 함) — 종목명 제외, 40자 이내, 지시형 표현 금지",
  "mainAnalysis": "본문 — news-driven이면 뉴스 해석 중심, data-driven이면 내부지표/이례적 신호 중심. 52주 고가·저가·PER 같은 정적 지표는 여기 쓰지 말 것",
  "yesterdayDelta": "[직전 리포트와의 차이]에 제공된 정보를 아래 [직전 리포트와의 간격] 지시에 따른 표현으로 정리 (구체적 수치 포함)",
  "riskFactor": "오늘 상황에 특정된 리스크 1개 (일반론 금지)",
  "tags": ["3~4개 핵심 키워드 (업종·테마·이슈 위주)"],
  "signal": "순유입 우위" | "중립·관망" | "차익실현 관찰" | "순유출 우위"
}

규칙:
- reportType은 위 [리포트 유형]에 이미 지정된 값을 그대로 옮겨 적으세요 — 직접 판단하지 마세요
- signal은 매매 지시가 아니라 수급·가격 패턴에 대한 관찰 결과이며 화면에는 노출되지 않고 내부 집계에만 쓰입니다 — 외국인·기관의 순매수 자금 유입이 우위면 "순유입 우위", 순매도 우위면 "순유출 우위", 단기 급등 후 차익실현 흐름이 관찰되면 "차익실현 관찰", 그 외에는 "중립·관망"
- 52주 고가/저가, PER 같은 정적 지표는 mainAnalysis·yesterdayDelta·riskFactor 어디에서도 핵심 근거로 쓰지 마세요 — 이 숫자들은 매일 거의 안 바뀌므로 본문에 쓰면 리포트가 매일 똑같아 보입니다
- [직전 리포트와의 차이]에 제공된 정보 중 최소 1개는 yesterdayDelta에서 구체적 수치와 함께 반드시 언급하세요. 정확한 표현 방식(어제 대비 / N일 전 리포트 대비 / 위트 문구 등)은 아래 [직전 리포트와의 간격] 지시를 따르세요
- [내부 계산 지표](급등이력·거래대금배수·MDD·변동성) 중 최소 1개는 mainAnalysis에서 반드시 활용하세요 — 증권사 앱에서 볼 수 없는 고유 계산값입니다. 이 지표를 언급할 때는 이미 당연히 알고 있는 사실인 것처럼 자연스럽게 서술하세요 — 출처를 밝히거나 어디서 가져온 값인지 표시하지 말 것
- [급등이력]을 언급할 때는 "과거 이런 규모의 등락 이후 실제 수익률이 이랬다"는 사실로만 제시하세요 — "그러니 이번에도 비슷하게 움직일 것"처럼 패턴이 반복될 것으로 예측하거나 암시하는 표현은 절대 쓰지 마세요. 과거 사례 제공이지 미래 예측이 아닙니다
- "정당화", "권고", "~하는 것이 좋습니다" 같은 결론형·권유형 단어를 쓰지 말고 관찰·해석형 문장을 사용하세요
- 같은 종결 표현을 이 리포트 안에서 2회 이상 쓰지 말고 문장마다 종결을 다양하게 바꾸세요 ("~로 보임", "~때문임", "~로 풀이됨", "~라는 점이 눈에 띔" 등)
- ${TEMPORAL_GROUNDING_INSTRUCTION}
- 본문에서 현재가·52주 고가·52주 저가를 언급할 때는 "종목 데이터"에 제시된 숫자를 한 글자도 다르지 않게 그대로 쓰세요 — 익숙한 가격대와 다르다는 이유로 자릿수를 줄이거나 늘리지 말 것
- ${MARKET_DAY_GROUNDING_INSTRUCTION}
- tags에는 "매수"/"매도"/"순매수"/"순매도" 같은 단어를 넣지 말 것
- "fpark", "당사", "본 서비스" 등 자기 서비스를 3인칭처럼 지칭하는 표현을 쓰지 말 것
- "~기준으로", "~에 따르면"처럼 마치 외부 출처를 인용하는 어투로 내부 지표를 서술하지 말 것 (예: "fpark 기준 거래대금은..." 대신 "거래대금은 최근 20거래일 평균의 0.72배에 그쳤다"처럼 사실을 바로 서술)
- JSON 키 순서 및 구조 변경 금지`;

const NEWS_DRIVEN_INSTRUCTIONS = `## [리포트 유형] 뉴스가 있는 날 (news-driven)

오늘은 이 종목과 직접 관련된 뉴스가 있습니다. 아래 [오늘의 관련 뉴스]를 mainAnalysis의 중심 소재로 삼으세요.

작성 순서:
1. 뉴스의 핵심 사실을 1~2문장으로 요약 — "누가/무엇을/왜"가 드러나야 하고, 기사 제목을 그대로 옮기지 말고 재구성
2. 이 뉴스가 오늘 주가/거래대금 움직임과 실제로 연결되는지, 무관하게 따로 노는지 판단하고 이유를 서술 — 데이터가 뒷받침하지 않으면 "뉴스와 가격 움직임이 아직 명확히 연동되지 않고 있다"처럼 솔직하게 쓸 것, "뉴스 때문에 올랐다"고 무조건 단정하지 말 것. 연결된다고 판단했다면 거기서 끝내지 말고, 그 반응 크기가 뉴스 내용에 비해 과도한지 타당한 수준인지까지 결론을 내리세요 — 판단 유형만 고르고 결론 없이 끝내지 말 것
3. 이 뉴스가 하루짜리 이슈인지 앞으로 며칠/몇 주 지켜봐야 할 이슈인지 판단해서 언급 (실적 발표는 후속 이슈, 단발성 공시는 하루짜리 등)

금지: 기사 문장을 15단어 이상 그대로 인용하지 말 것(자체 요약·재구성만). 뉴스 요약이 mainAnalysis 절반을 넘지 않게, "왜 중요한지/어떻게 해석해야 하는지"에 더 많은 분량을 쓸 것

[업종/시장 배경]에 기사가 있다면 이 종목만의 개별 뉴스와 구분해서 참고하세요 — 오늘 움직임이 업종·시장 전체 흐름과 함께 설명된다면 그 배경도 근거로 같이 써도 됩니다. 다만 [오늘의 관련 뉴스]가 있는 이상 mainAnalysis의 중심은 어디까지나 그 종목 개별 뉴스입니다.`;

const DATA_DRIVEN_INSTRUCTIONS = `## [리포트 유형] 뉴스가 없는 날 (data-driven)

오늘은 이 종목과 직접 관련된 뉴스가 없습니다. 억지로 mainAnalysis를 길게 채우지 마세요. 뉴스가 없다는 사실 자체를 숨기지 말고 인정하되, 아래에 집중하세요:

1. [업종/시장 배경]에 이 종목이 속한 업종·시장 전체에 영향을 줄 만한 매크로 뉴스가 있다면(이 종목명이 직접 언급되지 않아도 됨), 그것을 mainAnalysis의 중심으로 삼아 오늘 움직임의 배경을 서술하세요 — 이 경우에도 reportType은 data-driven 그대로 두되(이 종목 개별 뉴스는 없다는 판정 자체는 안 바뀜), "이 종목만의 뉴스는 없지만 업종 전체가 영향을 받고 있다"는 취지를 명확히 밝히세요
2. 업종 배경도 없다면 [내부 계산 지표]에서 오늘 특이한 값(평소 대비 벗어난 값)이 있는지 확인하고, 있다면 그것을 mainAnalysis의 중심으로 삼으세요 (예: 거래대금이 20일 평균 대비 유의미하게 높거나 낮은 경우, 과거 급등/급락 이력과 오늘 상황이 겹치는 경우 등)
3. 특이한 지표도 없다면 "오늘은 뉴스도 없고 지표도 평소 범위 안에 있다"고 짧게 정리하세요. 억지로 리스크 요인이나 관찰 포인트를 지어내지 마세요

이런 날의 mainAnalysis는 뉴스가 있는 날보다 확연히 짧아야 합니다 (목표: 3~5문장 이내, 단 업종 배경으로 서술하는 경우는 예외). 짧다는 것 자체가 "오늘은 특별한 게 없다"는 정직한 신호입니다.`;

// 2026-07-27 휴장일 리포트 재설계: reportType(news-driven/data-driven) 판단은 그대로
// 두되(휴장일 동안 나온 뉴스도 relevantNews에 그대로 잡힘 — 뉴스 파이프라인 자체는 손댈
// 필요 없음), "오늘 이 뉴스로 주가가 움직였다"는 실시간 반응형 서술만 별도로 차단한다.
const NON_TRADING_DAY_NEWS_FRAMING = `## [거래일 상태] 보충 — 뉴스 프레이밍
오늘은 휴장일이므로, [오늘의 관련 뉴스]에 있는 기사들을 "오늘 이 뉴스로 주가가 움직였다"처럼 실시간 반응으로 서술하지 마세요. 대신 "다음 거래일 개장 시 참고할 만한 소식"이라는 틀로 언급하세요. 관련 뉴스가 없다면 억지로 다음 거래일 전망을 지어내지 말고, 마지막 거래일 마감 데이터를 사실 그대로 정리하는 데 집중하세요.`;

// 2026-07-10 "직전 리포트와의 간격"에 따라 어조를 분기. stock_analysis_history는
// 종목 페이지 방문 시에만 새로 쌓이므로, 인기 종목은 매일이지만 비인기 종목은
// 며칠~몇 주씩 공백이 생긴다 — 그런데도 프롬프트가 항상 "어제 대비"라고만
// 지시하면 실제로는 며칠/몇 주 전인데 "어제"라고 잘못 서술하게 된다. 간격
// 자체(daysSinceLastReport)를 프롬프트에 명시하고, 구간별로 다른 어조를 쓴다.
const FIRST_REPORT_TONE = `## [직전 리포트와의 간격] 첫 리포트

이 종목의 첫 리포트로, 비교할 과거 데이터가 없습니다. yesterdayDelta에는 "이 종목의 첫 리포트로 비교할 과거 데이터가 없다"는 사실을 짧게 한 문장으로만 언급하세요. 과장하거나 아쉬워하는 티를 내지 마세요.`;

const ONE_DAY_GAP_TONE = `## [직전 리포트와의 간격] 1일 (어제)

직전 리포트가 어제 것입니다. yesterdayDelta에서 자연스럽게 "어제 대비"라는 표현을 써서 [직전 리포트와의 차이]에 제공된 정보를 구체적 수치와 함께 비교하세요.`;

const FEW_DAYS_GAP_TONE = `## [직전 리포트와의 간격] 2~6일

직전 리포트가 며칠 전 것입니다. yesterdayDelta에서 "어제 대비"가 아니라 "N일 전 리포트 대비"라는 표현을 쓰고(N은 [직전 리포트와의 차이]에 제시된 실제 일수), 그 사이 무엇이 달라졌는지 [직전 리포트와의 차이]의 수치로 비교하세요. 간격이 왜 생겼는지 사과하거나 설명할 필요는 없습니다 — 이 정도는 흔한 일입니다.`;

const LONG_GAP_TONE = `## [직전 리포트와의 간격] 7일 이상

직전 리포트가 오래 전(7일 이상) 것입니다. yesterdayDelta 맨 앞에 "오랜만에 다시 조회된 종목"이라는 사실을 위트 있게 짧게 한 문장으로 짚으세요. 예시 톤(그대로 쓰지 말고 매번 다르게 표현할 것):
- "이 종목은 최근 N일간 조회가 뜸했던 모양이다"
- "N일 만에 다시 관심을 받은 종목이다"
- "한동안 관심 밖이었다가 오늘 다시 소환된 종목"
(N은 [직전 리포트와의 차이]에 제시된 실제 일수로 채우세요)

이 문장은 비꼬거나 종목을 깎아내리는 톤이 아니라 가볍게 던지는 한 줄 유머여야 합니다. 절대로 "망한 종목", "관심 꺼진 종목" 같은 부정적 낙인 표현이나, "지금이 기회", "저평가" 같은 투자 유인성 표현을 쓰지 마세요 — 컴플라이언스 원칙(매수/매도·목표가 관련 금지 규칙)이 이 문장에도 동일하게 적용됩니다. 이 위트 문장 다음에는 곧바로 [직전 리포트와의 차이]의 실제 데이터(가격 변화, 거래대금 변화 등)로 자연스럽게 이어가세요. 위트 문장은 매번 표현을 다르게 써서 반복되지 않게 하세요(고정 문구 금지).`;

export type { Signal };

export interface AnalysisResult {
  reportType: ReportType;
  headline: string;
  mainAnalysis: string;
  yesterdayDelta: string;
  riskFactor: string;
  tags: string[];
  signal: Signal; // 내부 로그/집계용 — 화면에는 방향성 배지로 노출하지 않음(Paddle 심사 대응)
  current_price: number;
  resistance: number; // 52주 고가 — 서버에서 직접 계산 (AI가 지어내지 않음)
  support: number;     // 52주 저가 — 서버에서 직접 계산
  tradingValueMultiple: number | null; // 오늘 거래대금 / 최근 20거래일 평균 — 순수 데이터 지표
  hasRelevantNews: boolean; // false면 UI에서 "최근 관련 뉴스 반영: 없음" 배지 표시
  isCached?: boolean;
  disclaimer: string;
  createdAt: string;
}

interface HistoryRow {
  report_type: ReportType;
  headline: string;
  main_analysis: string;
  yesterday_delta: string | null;
  risk_factor: string | null;
  tags: string[] | null;
  signal: string | null;
  current_price: number | null;
  price_change_pct: number | null;
  reference_metrics: { week52High?: number; week52Low?: number; per?: number; pbr?: number } | null;
  internal_metrics: { tradingValueMultiple?: number | null; mdd?: number; volatility?: number } | null;
  disclaimer: string | null;
  created_at: string;
  regen_count: number | null;
}

function mapRowToResult(row: HistoryRow): Omit<AnalysisResult, 'isCached'> {
  return {
    reportType: row.report_type,
    headline: row.headline,
    mainAnalysis: row.main_analysis,
    yesterdayDelta: row.yesterday_delta ?? '',
    riskFactor: row.risk_factor ?? '',
    tags: row.tags ?? [],
    signal: clampSignal(row.signal),
    current_price: row.current_price ?? 0,
    resistance: row.reference_metrics?.week52High ?? 0,
    support: row.reference_metrics?.week52Low ?? 0,
    tradingValueMultiple: row.internal_metrics?.tradingValueMultiple ?? null,
    hasRelevantNews: row.report_type === 'news-driven',
    disclaimer: row.disclaimer ?? INVESTMENT_DISCLAIMER,
    createdAt: row.created_at,
  };
}

// AI가 본문 서술에서 현재가·52주 고저가를 자기 기억 속 "익숙한" 가격대로 임의 보정해 쓰는 현상 방지.
// 구조화된 필드(current_price/resistance/support)는 서버가 직접 넣으므로 항상 정확하지만,
// 자유 텍스트(headline/mainAnalysis/yesterdayDelta/riskFactor)는 AI 재량이라 유명 대형주에서
// 실측값과 다른 숫자를 쓰는 경우가 확인됨(예: SK하이닉스 — 실제 2,987,000원을 "298,700원"으로 서술).
//
// 2026-07-27 스트리밍 전환: 기존엔 완성된 결과 객체 전체에 한 번 적용했지만, 스트리밍은 필드가
// 하나씩 완결되는 시점에 곧바로 교정해서 내보내야 한다 — 진실값(price.price 등)은 Claude 호출
// 전에 이미 알고 있으므로 필드 단위 교정 함수로 분리해 재사용한다.
interface PriceCheck { re: RegExp; truth: number; label: string }

function buildPriceChecks(current_price: number, resistance: number, support: number): PriceCheck[] {
  return [
    { re: /현재가\s*([\d,]+)\s*원/g, truth: current_price, label: '현재가' },
    { re: /52주\s*고[가점]\s*([\d,]+)\s*원/g, truth: resistance, label: '52주 고가' },
    { re: /52주\s*저[가점]\s*([\d,]+)\s*원/g, truth: support, label: '52주 저가' },
  ];
}

function fixPriceText(text: string, checks: PriceCheck[], ticker: string): string {
  let fixed = text;
  for (const { re, truth, label } of checks) {
    if (!(truth > 0)) continue;
    fixed = fixed.replace(re, (match, numStr: string) => {
      const extracted = parseInt(numStr.replace(/,/g, ''), 10);
      if (!extracted || Math.abs(extracted - truth) / truth <= 0.05) return match;
      console.warn(
        `[ANALYSIS] ${ticker} ${label} 불일치 교정: "${extracted.toLocaleString()}원" → "${truth.toLocaleString()}원"`,
      );
      return match.replace(numStr, truth.toLocaleString());
    });
  }
  return fixed;
}

// headline/mainAnalysis/yesterdayDelta/riskFactor만 가격 언급 교정 대상 — tags/reportType/signal은
// 자유 텍스트가 아니라 교정할 대상이 없음.
const PRICE_CORRECTED_KEYS = new Set(['headline', 'mainAnalysis', 'yesterdayDelta', 'riskFactor']);

// 2026-07-10 발견: fetchStockPrice/fetchStockInfo(KIS inquire-price)와
// fetchDailyChart(KIS inquire-daily-itemchartprice)의 "오늘" 행은 정규장 마감(15:30 KST)
// 전까지는 장중 누적/실시간 값이고, 마감 후에야 그날의 최종 확정치가 된다. 그런데 당일
// 캐시는 report_date만 보고 무조건 재사용해서, 장중에 생성된 리포트가 마감 후 재방문에도
// 그대로 남아 "장중 스냅샷을 오늘자 최종 리포트인 것처럼" 계속 보여주는 문제가 있었다.
// 장 마감 후 첫 방문 때만, 캐시가 장중에 생성된 것이면 무시하고 재생성한다(일일 재생성
// 상한 MAX_DAILY_REGENS 적용 — 아래 장중 신선도 로직과 공유).
const MARKET_OPEN_MINUTES_KST = 9 * 60; // 09:00
const MARKET_CLOSE_MINUTES_KST = 15 * 60 + 30; // 15:30

function kstMinutesSinceMidnight(d: Date): number {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

function isIntradayCacheStale(cachedCreatedAt: string): boolean {
  const generatedBeforeClose = kstMinutesSinceMidnight(new Date(cachedCreatedAt)) < MARKET_CLOSE_MINUTES_KST;
  const nowIsAfterClose = kstMinutesSinceMidnight(new Date()) >= MARKET_CLOSE_MINUTES_KST;
  return generatedBeforeClose && nowIsAfterClose;
}

// 2026-07-15 "장중 캐시 신선도" 개선: 위 장마감 무효화만으로는 아침에 생성된
// 리포트가 장마감 전까지 하루 종일 그대로 유지되는 문제가 있었다(가격이 크게
// 움직이거나 새 뉴스가 나와도 아침 리포트가 그대로 노출됨). 장중에도 "일정 시간
// 경과 AND 가격이 유의미하게 변동"했을 때만 재생성한다 — 시간만 보면(고정 주기)
// 안 움직인 날도 기계적으로 비용이 발생하고, 가격만 보면 생성 직후 정상 변동폭
// 에도 바로 재트리거(thrashing)되므로 AND로 묶어 둘 다 회피한다. 가격 조회 자체가
// KIS 호출 1회를 유발하므로 시간 조건을 먼저 걸러, 최소 시간 미경과 시엔 가격
// 조회조차 하지 않는다(캐시 히트 시 대부분 KIS 호출 0회를 유지).
//
// 2026-07-30 발견: 위 단일 조건(2시간+2.5%)은 개장 직후처럼 리포트 생성 직후 큰
// 갭이 열리는 경우를 놓쳤다 — SK하이닉스가 09:16 생성 후 1.5시간 만에 -5.28%→
// +2.93%(8%p+)로 움직였는데도 2시간 미만이라 가격 확인 자체를 안 해서 재생성이
// 전혀 트리거되지 않았다. 급격한 변동은 더 짧은 경과 시간에도 빠르게 잡도록
// 2단 임계값으로 분리한다 — "느슨한 변동 + 긴 대기" 조합(기존 취지)은 그대로 두고,
// "급격한 변동 + 짧은 대기" 조합을 추가해 개장 직후 큰 갭만 예외적으로 빠르게 잡는다.
const INTRADAY_FAST_MIN_HOURS_ELAPSED = 0.5; // 30분
const INTRADAY_FAST_PRICE_MOVE_THRESHOLD = 0.05; // ±5%
const INTRADAY_MIN_HOURS_ELAPSED = 2;
const INTRADAY_PRICE_MOVE_THRESHOLD = 0.025; // ±2.5%
// 하루 재생성 총 상한(초기 생성 포함) — 변동이 잦은 종목이 무한정 비용을 늘리지
// 않도록 하는 안전장치. 단, 장마감 강제 재생성(isIntradayCacheStale)은 이 상한과
// 무관하게 항상 보장한다 — "그날의 최종 확정 데이터"라는 점에서 인트라데이 노이즈성
// 재생성과 성격이 다르고, 장중에 변동성이 커서 이미 상한을 다 쓴 종목일수록 오히려
// 장마감 후 정확한 최종 스냅샷이 더 중요하기 때문(2026-07-20 발견 — 상한에 걸리면
// 장마감 후에도 낡은 장중 스냅샷이 그대로 남아, 애초에 이 로직이 막으려던 문제를
// 재현하는 모순이 있었음). regen_count는 이 경우에도 정상적으로 +1 기록되어
// 4를 넘을 수 있다(모니터링용 — 별도 상한으로 작동하지 않음).
const MAX_DAILY_REGENS = 4;

async function isIntradayRefreshDue(
  cachedCreatedAt: string,
  storedPrice: number | null,
  ticker: string,
): Promise<{ due: boolean; reason?: string }> {
  const now = new Date();
  const nowMinutes = kstMinutesSinceMidnight(now);
  if (nowMinutes < MARKET_OPEN_MINUTES_KST || nowMinutes >= MARKET_CLOSE_MINUTES_KST) return { due: false };

  const hoursSinceCreated = (now.getTime() - new Date(cachedCreatedAt).getTime()) / (60 * 60 * 1000);
  if (hoursSinceCreated < INTRADAY_FAST_MIN_HOURS_ELAPSED) return { due: false };
  if (!storedPrice) return { due: false };

  // 2시간 이상 지났으면 완화된(2.5%) 기준, 그 전(30분~2시간)이면 급변만 잡는
  // 엄격한(5%) 기준 — 경과 시간이 길수록 "낡았다"고 판단하는 기준을 낮춘다.
  const threshold = hoursSinceCreated >= INTRADAY_MIN_HOURS_ELAPSED
    ? INTRADAY_PRICE_MOVE_THRESHOLD
    : INTRADAY_FAST_PRICE_MOVE_THRESHOLD;

  try {
    const price = await fetchStockPrice(ticker);
    const movePct = Math.abs(price.price - storedPrice) / storedPrice;
    if (movePct < threshold) return { due: false };
    return { due: true, reason: `${hoursSinceCreated.toFixed(1)}h 경과·가격 ${(movePct * 100).toFixed(1)}% 변동` };
  } catch (e) {
    console.warn('[ANALYSIS] 장중 신선도 가격 조회 실패, 기존 캐시 유지:', ticker, e instanceof Error ? e.message : e);
    return { due: false };
  }
}

// 직전 리포트(오늘 이전 가장 최근 1건) 대비 차이를 프롬프트에 주입할 텍스트로 변환.
// "정확히 어제"만 조회하지 않고 report_date < 오늘 중 가장 최근 1건을 이미 가져오므로
// (인기 종목이 아니면 며칠~몇 주씩 공백이 생길 수 있음), 실제 간격(daysSinceLastReport)을
// 명시해서 AI가 "어제 대비"라고 부정확하게 서술하지 않도록 한다.
function buildYesterdayComparisonBlock(
  prev: HistoryRow & { report_date: string } | null,
  todayChangeRate: number,
  todayMultiple: number | null,
  daysSinceLastReport: number | null,
): string {
  if (!prev || daysSinceLastReport === null) return '첫 리포트라 비교 대상 없음';

  const lines: string[] = [
    `- 직전 리포트와의 간격: ${daysSinceLastReport}일`,
    `- 직전 리포트: ${prev.report_date} (${prev.report_type === 'news-driven' ? '뉴스 있음' : '뉴스 없음'})`,
  ];
  if (prev.price_change_pct !== null) {
    lines.push(`- 등락률: 그날 ${prev.price_change_pct >= 0 ? '+' : ''}${prev.price_change_pct}% → 오늘 ${todayChangeRate >= 0 ? '+' : ''}${todayChangeRate}%`);
  }
  const prevMultiple = prev.internal_metrics?.tradingValueMultiple;
  if (prevMultiple != null || todayMultiple != null) {
    lines.push(`- 거래대금(20일 평균 대비 배수): 그날 ${prevMultiple != null ? `${prevMultiple}배` : '데이터 없음'} → 오늘 ${todayMultiple != null ? `${todayMultiple}배` : '데이터 없음'}`);
  }
  return lines.join('\n');
}

function makeAuthSupabase() {
  const cookieStore = cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.then(s => s.getAll()),
        setAll: (pairs) => cookieStore.then(s => {
          pairs.forEach(({ name, value, options }) => s.set(name, value, options));
        }),
      },
    },
  );
}

// 이번 달(결제 사이클) 종목분석 조회 건수 — app/api/diagnosis, app/api/portfolio-diagnosis와
// 동일 패턴(lib/plan.ts의 getUsageCycleStart 공용). basic/pro에서만 사용(free는 일간).
async function getMonthlyStockAnalysisCount(
  authedSupabase: ReturnType<typeof makeAuthSupabase>,
  userId: string,
): Promise<number> {
  const { data: userRow } = await authedSupabase
    .from('users')
    .select('subscription_start_date')
    .eq('id', userId)
    .maybeSingle();
  const { cycleStart } = getUsageCycleStart(userRow?.subscription_start_date ?? null, new Date());

  // 2026-08-03 버그 수정: cycleStart(KST 자정 절대시각)를 그냥 .toISOString().split('T')[0]로
  // 바꾸면 UTC로 하루 당겨져(예: KST 7/1 00:00 → "6/30") 사이클 시작 전날 사용분까지
  // 한도 계산에 포함되던 과다집계 버그 — 유료 회원이 실제 한도보다 일찍 429를 맞았다.
  // kstDateStr()로 정확한 KST 날짜를 구한다.
  const { count } = await authedSupabase
    .from('stock_analysis_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('usage_date', kstDateStr(cycleStart));
  return count ?? 0;
}

// 오늘(KST) 종목분석 조회 건수(전체 티커 합산) — 무료 등급 전용(lib/plan.ts의
// isStockAnalysisDaily 참고, 2026-07-15 정정: 무료만 예외적으로 일간 한도).
async function getDailyStockAnalysisCount(
  authedSupabase: ReturnType<typeof makeAuthSupabase>,
  userId: string,
  todayStr: string,
): Promise<number> {
  const { count } = await authedSupabase
    .from('stock_analysis_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('usage_date', todayStr);
  return count ?? 0;
}

// 2026-07-27 스트리밍 파일럿 — portfolio-diagnosis(app/api/portfolio-diagnosis/route.ts)의
// SSE 패턴을 그대로 재사용. run() 안에서 던진 예외는 여기서 잡아 { type:'error' } 프레임으로
// 변환해 보낸다 — 이미 SSE 응답(200)이 시작된 뒤라 HTTP 상태코드로는 실패를 알릴 수 없다.
function sseResponse(run: (send: (data: object) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 2026-08-11 발견: enqueue가 streamOneGeneration의 claudeStream.on('text', ...)
      // 콜백(onField/onPartial) "안에서" 호출되는 구조라, 클라이언트가 스트리밍 도중
      // 연결을 끊으면 controller가 즉시 닫혀 enqueue가 예외를 던지고 — 그 예외가
      // on('text') 밖으로 전파돼 run() 전체가 catch로 튕겨나가며, 847줄의 after(...)
      // (DB 저장) 등록 코드까지 아예 도달하지 못했다. after()를 이미 쓰고 있어도 여기서
      // 막히면 소용없으므로, 클라이언트 연결 끊김을 여기서 조용히 무시해 run()이 끝까지
      // 실행되게 한다.
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* 클라이언트가 이미 끊었으면 무시 — Claude 스트림 소비·DB 저장은 계속돼야 함 */ }
      };
      try {
        await run(send);
      } catch (e) {
        console.error('[ANALYSIS] 스트림 처리 중 예외:', e);
        try { send({ type: 'error', message: 'AI 분석 생성 실패' }); } catch { /* 클라이언트가 이미 끊었으면 무시 */ }
      } finally {
        try { controller.close(); } catch { /* 이미 취소된 스트림이면 무시 */ }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const todayStr = kstDateStr();

  // 0. 인증 — 2026-07-14까지 완전 비인증(누구나 호출 가능)이었으나, 요금제 재구성으로
  // 월간 이용 한도를 걸기 위해 로그인 필수로 전환.
  const authedSupabase = makeAuthSupabase();
  const { data: { user } } = await authedSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 0-1. 월간 한도 체크 — 이 라우트는 (ticker, report_date) 단위로 전 사용자가 콘텐츠
  // 캐시를 공유하므로, 캐시 히트/미스와 무관하게 "이 사용자가 오늘 이 종목을 이미
  // 조회했는지"로 카운트한다(같은 종목 재조회는 추가 차감 없음, stock_analysis_usage
  // unique(user_id, ticker, usage_date) 제약이 이를 보장).
  const { data: existingUsage } = await authedSupabase
    .from('stock_analysis_usage')
    .select('id')
    .eq('user_id', user.id)
    .eq('ticker', ticker)
    .eq('usage_date', todayStr)
    .maybeSingle();

  if (!existingUsage) {
    const plan  = await checkPlan(authedSupabase, user.id, user.email);
    const limit = resolveStockAnalysisLimit(plan);
    const count = isStockAnalysisDaily(plan)
      ? await getDailyStockAnalysisCount(authedSupabase, user.id, todayStr)
      : await getMonthlyStockAnalysisCount(authedSupabase, user.id);
    if (count >= limit) {
      const message = isStockAnalysisDaily(plan)
        ? '오늘 무료 이용 횟수를 모두 사용했습니다. 베이직/프로로 업그레이드하면 월 단위로 더 많이 이용하실 수 있습니다.'
        : '이번 달 이용 한도를 모두 사용했습니다. 다음 결제일에 초기화됩니다.';
      return NextResponse.json({ error: message }, { status: 429 });
    }
  }

  // 이번 조회를 이용 기록으로 남긴다 — 캐시 히트/신규 생성 응답 모두에서 호출(아래).
  // upsert + ignoreDuplicates로 같은 (user_id, ticker, usage_date) 재기록은 무시.
  const recordUsage = () => {
    after(async () => {
      const { error } = await authedSupabase
        .from('stock_analysis_usage')
        .upsert(
          { user_id: user.id, ticker, usage_date: todayStr },
          { onConflict: 'user_id,ticker,usage_date', ignoreDuplicates: true },
        );
      if (error) console.error('[ANALYSIS] 이용 기록 저장 실패:', error.message);
    });
  };

  // 0-2. 당일 캐시 확인 — 해외물 라우트(overseas/[ticker]/analysis)의 기존 패턴을 그대로 이식.
  // 국내물은 지금까지 캐시가 없어 방문할 때마다 재생성됐는데, 그러면 "어제와의 비교"가
  // 같은 날 안에서도 방문마다 달라져 의미가 없어진다 — 하루 1건을 테이블 unique 제약으로
  // 보장하고, KIS/Claude 호출 자체를 캐시 히트 시 건너뛴다.
  let cachedRegenCount = 0; // 오늘 이미 재생성된 누적 횟수(없으면 0 = 첫 생성) — 저장 시 +1
  try {
    const { data: cached } = await supabase
      .from('stock_analysis_history')
      .select('*')
      .eq('ticker', ticker)
      .eq('report_date', todayStr)
      .maybeSingle();
    if (cached) {
      const row = cached as HistoryRow;
      const regenCount = row.regen_count ?? 1;
      const overDailyCap = regenCount >= MAX_DAILY_REGENS;
      // 장마감 확정 재생성은 일일 캡과 무관하게 항상 보장(위 MAX_DAILY_REGENS 주석 참고).
      const closeStale = isIntradayCacheStale(row.created_at);
      const intradayCheck = !overDailyCap && !closeStale
        ? await isIntradayRefreshDue(row.created_at, row.current_price, ticker)
        : { due: false };

      if (closeStale) {
        console.log(`[ANALYSIS] ${ticker} 장중 생성 캐시(${row.created_at}) 감지 — 장마감 후 첫 조회라 재생성 (누적 ${regenCount}회)`);
        cachedRegenCount = regenCount;
      } else if (intradayCheck.due) {
        console.log(`[ANALYSIS] ${ticker} 장중 신선도 트리거 재생성: ${intradayCheck.reason} (누적 ${regenCount}회)`);
        cachedRegenCount = regenCount;
      } else {
        if (overDailyCap) {
          console.log(`[ANALYSIS] ${ticker} 일일 재생성 상한(${MAX_DAILY_REGENS}) 도달 — 캐시 유지`);
        }
        recordUsage();
        const cached: AnalysisResult = { ...mapRowToResult(row), isCached: true };
        // 캐시 히트도 신규 생성과 동일한 SSE 프로토콜로 응답 — 프론트가 응답 형태를
        // 분기하지 않아도 되고, 이미 다 있는 값이라 사실상 한 번에 전부 쏟아붓는다.
        return sseResponse(async (send) => {
          send({
            type: 'meta',
            current_price: cached.current_price,
            resistance: cached.resistance,
            support: cached.support,
            tradingValueMultiple: cached.tradingValueMultiple,
            hasRelevantNews: cached.hasRelevantNews,
            disclaimer: cached.disclaimer,
            createdAt: cached.createdAt,
            reportType: cached.reportType,
            isCached: true,
          });
          send({ type: 'field', key: 'headline', value: cached.headline });
          send({ type: 'field', key: 'mainAnalysis', value: cached.mainAnalysis });
          send({ type: 'field', key: 'yesterdayDelta', value: cached.yesterdayDelta });
          send({ type: 'field', key: 'riskFactor', value: cached.riskFactor });
          send({ type: 'field', key: 'tags', value: cached.tags });
          send({ type: 'done', createdAt: cached.createdAt });
        });
      }
    }
  } catch (e) {
    console.warn('[ANALYSIS] 당일 캐시 조회 실패, 새로 생성:', e instanceof Error ? e.message : e);
  }

  // 2. 종목 정보 조회
  let priceInfo: [
    Awaited<ReturnType<typeof fetchStockPrice>>,
    Awaited<ReturnType<typeof fetchStockInfo>>,
  ] | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      priceInfo = await Promise.all([fetchStockPrice(ticker), fetchStockInfo(ticker)]);
      break;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!priceInfo) {
    return NextResponse.json({ error: '종목 정보 조회 실패' }, { status: 502 });
  }
  const [price, info] = priceInfo;

  // 3. 관련 뉴스 — 종목명+종목코드 병행 검색(display=100) 후 Haiku 1차 관련성 선별.
  // 2026-07-23 재설계: 기존 종목명 단독 검색(display=5)은 "네이버"처럼 일상어·그룹명과
  // 겹치는 종목에서 노이즈(수백만 건)에 실제 회사 뉴스가 파묻히는 문제를 실측 확인
  // (lib/news-selection.ts 참고). DB 캐시(articles)는 계속 보조 후보로 병행.
  const dbNewsPromise = Promise.resolve(
    supabase
      .from('articles')
      .select('title, summary, published_at')
      .ilike('title', `%${price.name}%`)
      .not('summary', 'is', null)
      .order('published_at', { ascending: false })
      .limit(5),
  ).then(({ data }) => (data ?? []).map((n) => ({
    title:   n.title,
    summary: n.summary ?? undefined,
    date:    n.published_at ? new Date(n.published_at).toLocaleDateString('ko-KR') : undefined,
  })));

  // 3-1. 업종 매크로 뉴스 — 종목명이 전혀 언급되지 않는 순수 업종 뉴스(예: "필라델피아
  // 반도체지수 8% 상승")는 위 selectRelevantNews의 종목명+종목코드 검색 후보에 애초에
  // 안 걸린다. price.sector(KIS bstp_kor_isnm)를 키로 별도 조회해 그 사각지대를 메운다
  // (lib/sector-news.ts 참고). relevantNews와 독립적이라 병렬로 실행.
  // 2026-08-24: 가격이 이미 위(2번)에서 resolve됐으므로 별도 오케스트레이션 변경 없이
  // changeRate만 그대로 전달 — lib/news-selection.ts 선별 프롬프트 규칙 1(오늘 가격변동의
  // 실제 원인 최우선 선택)이 발동하려면 필요.
  const [{ items: relevantNews }, { items: sectorMacroNews }] = await Promise.all([
    selectRelevantNews(ticker, price.name, dbNewsPromise, price.changeRate),
    selectSectorMacroNews(price.sector),
  ]);
  // changeRate를 넘겨야 buildNewsBlock의 5→3 캡이 "최신순"이 아니라 "오늘 가격변동
  // 관련성 우선순위"로 절삭한다(lib/stock-analysis-data.ts 참고).
  const newsBlock = buildNewsBlock(relevantNews, price.changeRate);
  const sectorNewsBlock = buildNewsBlock(sectorMacroNews);

  // 이 종목과 직접 관련된 뉴스 유무로 리포트 유형을 서버가 먼저 결정한다 — AI가 스스로
  // 판단하게 두지 않고 애초에 다른 지시문을 태운다(2026-07-10 리포트 재설계).
  const reportType: ReportType = relevantNews.length > 0 ? 'news-driven' : 'data-driven';

  // 3-1. 일별 차트 (최근 최대 100거래일) — 과거 유사 급등 이력 + 거래대금 배수 + MDD/변동성 계산용
  // 실패해도 분석 자체는 진행하고 해당 데이터 블록만 생략
  let chart: Awaited<ReturnType<typeof fetchDailyChart>> = [];
  try {
    chart = await fetchDailyChart(ticker, '1Y');
  } catch (e) {
    console.warn('[ANALYSIS] 차트 조회 실패, 급등이력/거래대금배수/리스크지표 생략:', e instanceof Error ? e.message : e);
  }

  // 3-1-1. 거래일 상태 — 별도 KIS 재조회 없이 위에서 이미 받은 차트의 마지막 행 날짜를
  // 재사용해 휴장일(주말/공휴일)을 판정한다(lib/market-day-context.ts 참고).
  const marketDayContext = getDomesticMarketDayContext(chart);
  if (!marketDayContext.isTradingDay) {
    console.log(`[ANALYSIS] ${ticker} 휴장일 감지(${marketDayContext.reason}) — 마지막 거래일 ${marketDayContext.lastTradingDate} 기준으로 서술 지시`);
  }

  const surgeHistory          = chart.length ? computeSurgeHistory(chart) : null;
  const tradingValueMultiple  = chart.length ? computeTradingValueMultiple(chart) : null;
  const riskMetrics           = chart.length ? computeRiskMetrics(chart.map((d) => d.close)) : null;
  const surgeHistoryBlock     = buildSurgeHistoryBlock(surgeHistory);
  const tradingValueBlock     = buildTradingValueBlock(tradingValueMultiple);
  const riskMetricsBlock      = buildRiskMetricsBlock(riskMetrics);

  // 3-2. 직전 리포트(오늘 이전 가장 최근 1건) 조회 — "어제와의 차이" 계산용
  let prevRow: (HistoryRow & { report_date: string }) | null = null;
  try {
    const { data } = await supabase
      .from('stock_analysis_history')
      .select('*')
      .eq('ticker', ticker)
      .lt('report_date', todayStr)
      .order('report_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    prevRow = data as (HistoryRow & { report_date: string }) | null;
  } catch (e) {
    console.warn('[ANALYSIS] 직전 리포트 조회 실패, 비교 없이 진행:', e instanceof Error ? e.message : e);
  }
  const daysSinceLastReport = prevRow ? daysBetween(todayStr, prevRow.report_date) : null;
  const yesterdayComparisonBlock = buildYesterdayComparisonBlock(
    prevRow,
    price.changeRate,
    tradingValueMultiple?.valid ? tradingValueMultiple.multiple : null,
    daysSinceLastReport,
  );
  const gapTone =
    daysSinceLastReport === null ? FIRST_REPORT_TONE :
    daysSinceLastReport === 1 ? ONE_DAY_GAP_TONE :
    daysSinceLastReport <= 6 ? FEW_DAYS_GAP_TONE :
    LONG_GAP_TONE;

  // 4. Claude 분석
  const w52pos = info.week52High > 0
    ? Math.round(((price.price - info.week52Low) / (info.week52High - info.week52Low)) * 100)
    : null;

  const prompt = `아래 종목 데이터를 관찰된 사실 위주로 정리하고 반드시 JSON만 출력하세요. JSON 외 텍스트는 절대 포함하지 마세요.

## 기준 시각
현재 시각: ${nowKstString()}

## 거래일 상태
${buildMarketDayBlock(marketDayContext)}

## [리포트 유형]
${reportType} — 이 값을 그대로 reportType 필드에 옮겨 적으세요.

## 종목 데이터
※ 현재가·52주 고저가는 서버가 직접 실측한 값입니다. 본인이 알고 있는 시세감이나 관례적인 가격대와 다르더라도
임의로 보정하거나 축소·확대해서 쓰지 말고, 아래 숫자를 본문에서도 그대로 인용하세요.
- 종목명: ${price.name} (${ticker})
- 현재가: ${price.price.toLocaleString()}원 (등락률 ${price.changeRate > 0 ? '+' : ''}${price.changeRate}%)
- 거래대금: ${price.tradingValue}
- 52주 고가: ${info.week52High.toLocaleString()}원 / 저가: ${info.week52Low.toLocaleString()}원${w52pos !== null ? ` (현재가 52주 레인지의 ${w52pos}% 위치)` : ''}
- 시가총액: ${info.marketCap} / PER: ${info.per || 'N/A'} / PBR: ${info.pbr || 'N/A'}

## 오늘의 관련 뉴스 (${buildNewsFreshnessLine(relevantNews)})
${newsBlock}

## 업종/시장 배경 (${price.sector || '업종 정보 없음'}, ${buildNewsFreshnessLine(sectorMacroNews)})
${sectorNewsBlock}

## 직전 리포트와의 차이
${yesterdayComparisonBlock}

## 내부 계산 지표 (서버 계산값 — 증권사 앱에는 없는 고유 지표)
- 과거 유사 급등/급락 이력(최근 약 5개월): ${surgeHistoryBlock}
- 거래대금: ${tradingValueBlock}
- 리스크 지표: ${riskMetricsBlock}

위 데이터를 바탕으로 시스템 프롬프트에 제시된 JSON 형식과 규칙에 따라 정리하세요.`;

  const newsText = [...relevantNews, ...sectorMacroNews].map((n) => `${n.title} ${n.summary ?? ''}`).join(' ');
  const priceChecks = buildPriceChecks(price.price, info.week52High, info.week52Low);

  interface ParsedAnalysis {
    reportType: ReportType;
    headline: string;
    mainAnalysis: string;
    yesterdayDelta: string;
    riskFactor: string;
    tags: string[];
    signal: string;
  }

  // 종목 데이터/뉴스 등 준비는 위에서 끝났으니 여기부터 SSE 응답 시작 — 아래 run() 안에서
  // 던지는 예외는 sseResponse가 { type:'error' } 프레임으로 변환해 보낸다.
  return sseResponse(async (send) => {
    send({
      type: 'meta',
      current_price: price.price,
      resistance: info.week52High,
      support: info.week52Low,
      tradingValueMultiple: tradingValueMultiple?.valid ? tradingValueMultiple.multiple : null,
      hasRelevantNews: relevantNews.length > 0,
      disclaimer: INVESTMENT_DISCLAIMER,
      reportType,
      isCached: false,
    });

    // 1회 Claude 스트리밍 호출 — 텍스트 델타를 고정 스키마 필드경계 파서(StreamingFieldParser)에
    // 먹여 완결된 필드마다 onField로 통지한다. 스트림이 끝나면 전체 텍스트를 다시 통째로
    // JSON.parse해서 "정합성 보정"을 한 번 더 통지한다 — 증분 파서가 뭔가 놓치거나 잘못
    // 뽑았어도 최종 정확성은 이 전체 재파싱 결과가 항상 덮어써서 보장한다(2026-07-27
    // 스트리밍 파일럿 설계 원칙: 지연시간은 일부 포기해도 최종 정확성은 타협하지 않음).
    //
    // onPartial이 주어지면(1차 생성에서만) feedWithPartial()로 문자 단위 타이핑 효과를
    // 추가로 내보낸다 — 필드당 80ms 스로틀(스냅샷 방식, 완결 이벤트는 스로틀과 무관하게
    // 항상 즉시 발생). 2차(재생성) 호출은 onPartial을 안 넘겨서 기존 feed()만 쓴다 —
    // 이미 완성된 문장이 화면에 떠 있는 상태에서 다시 타이핑으로 자라나게 하면 오히려
    // 어색해서(설계 검토 결론), 재생성은 완성된 값을 한 번에 교체하는 쪽이 자연스럽다.
    async function streamOneGeneration(
      onField: (key: string, value: string | string[]) => void,
      onPartial?: (key: string, value: string) => void,
    ): Promise<{ parsed: ParsedAnalysis; reportText: string }> {
      const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
      let fullText = '';
      const requestStart = Date.now();
      let firstTokenLoggedAt = false;
      const lastPartialEmitAt: Record<string, number> = {};
      const PARTIAL_THROTTLE_MS = 80;

      // value 타입이 string | string[] | JsonFieldValue로 넓은 건 StreamingFieldParser가
      // 범용(포트폴리오분석의 'json' 타입 포함)이기 때문 — 이 라우트의 STOCK_ANALYSIS_FIELD_SPECS는
      // 'json' 타입을 쓰지 않으므로 실제로는 항상 string | string[]만 들어온다.
      const correctIfNeeded = (key: string, value: string | string[] | JsonFieldValue): string | string[] | JsonFieldValue =>
        typeof value === 'string' && PRICE_CORRECTED_KEYS.has(key)
          ? fixPriceText(value, priceChecks, ticker)
          : value;

      const claudeStream = client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: [
          { type: 'text', text: COMPLIANCE_PRINCIPLE },
          { type: 'text', text: COMMON_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
          {
            type: 'text',
            text: (reportType === 'news-driven' ? NEWS_DRIVEN_INSTRUCTIONS : DATA_DRIVEN_INSTRUCTIONS)
              + (marketDayContext.isTradingDay ? '' : `\n\n${NON_TRADING_DAY_NEWS_FRAMING}`),
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: gapTone, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: prompt }],
        // 2026-07-27: 재생성 메커니즘을 그대로 유지하기로 해서(withTemporalRetry와 동등한
        // 로직을 스트리밍용으로 인라인 구현, 아래 호출부 참고) 최악 2회 호출 예산도 그대로다 —
        // SDK maxRetries까지 더하면 예산 계산이 불가능해지므로 0으로 앱 레벨 재시도와 중첩
        // 방지, timeout은 2회 호출 최악(2×28s=56s)이 maxDuration(60s) 안에 들어오도록 산정.
      }, { timeout: 28_000, maxRetries: 0 });

      claudeStream.on('text', (delta) => {
        if (!firstTokenLoggedAt) {
          firstTokenLoggedAt = true;
          console.log(`[ANALYSIS] ${ticker} 첫 토큰 도착: ${Date.now() - requestStart}ms`);
        }
        fullText += delta;

        if (!onPartial) {
          for (const field of parser.feed(delta)) {
            onField(field.key, correctIfNeeded(field.key, field.value) as string | string[]);
          }
          return;
        }

        const { fields, partial } = parser.feedWithPartial(delta);
        for (const field of fields) {
          onField(field.key, correctIfNeeded(field.key, field.value) as string | string[]);
        }
        if (partial) {
          const now = Date.now();
          const last = lastPartialEmitAt[partial.key] ?? 0;
          if (now - last >= PARTIAL_THROTTLE_MS) {
            lastPartialEmitAt[partial.key] = now;
            onPartial(partial.key, correctIfNeeded(partial.key, partial.value) as string);
          }
        }
      });

      const message = await claudeStream.finalMessage();
      console.log('[TOKEN_USAGE]', {
        route: 'stock-analysis', ticker, reportType,
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      });

      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + fullText.slice(0, 100));
      const parsed = JSON.parse(jsonMatch[0]) as ParsedAnalysis;

      // 정합성 보정 — emit 대상 필드 전부를 전체 재파싱 결과로 한 번 더 통지(호출부의
      // emitIfChanged가 이미 보낸 값과 같으면 알아서 무시하므로 중복 전송 걱정 없음).
      for (const spec of STOCK_ANALYSIS_FIELD_SPECS) {
        if (!spec.emit) continue;
        const raw = (parsed as unknown as Record<string, string | string[] | undefined>)[spec.key];
        if (raw === undefined) continue;
        onField(spec.key, correctIfNeeded(spec.key, raw) as string | string[]);
      }

      const reportText = [parsed.headline, parsed.mainAnalysis, parsed.yesterdayDelta, parsed.riskFactor].join(' ');
      return { parsed, reportText };
    }

    const sentValues: Record<string, string | string[]> = {};
    const emitIfChanged = (eventType: 'field' | 'field-updated') => (key: string, value: string | string[]) => {
      if (JSON.stringify(sentValues[key]) === JSON.stringify(value)) return;
      sentValues[key] = value;
      send({ type: eventType, key, value });
    };

    const first = await streamOneGeneration(
      emitIfChanged('field'),
      (key, value) => send({ type: 'field-partial', key, value }),
    );
    const check1 = checkTemporalConsistency(first.reportText, newsText);
    const compliance1 = scanComplianceViolations(first.reportText);
    let finalParsed = first.parsed;

    if (check1.flagged || compliance1.length > 0) {
      if (check1.flagged) console.warn('[ANALYSIS] 시간적 사실관계 불일치 감지, 1회 재생성 시도:', check1);
      if (compliance1.length > 0) console.warn('[ANALYSIS] 컴플라이언스 금지어 감지, 1회 재생성 시도:', compliance1);
      const second = await streamOneGeneration(emitIfChanged('field-updated'));
      const check2 = checkTemporalConsistency(second.reportText, newsText);
      const compliance2 = scanComplianceViolations(second.reportText);
      if (check2.flagged) {
        console.error('[ANALYSIS] 재생성 후에도 불일치 감지 — 결과는 그대로 반환, 모니터링 필요:', check2);
      } else if (check1.flagged) {
        console.log('[ANALYSIS] 재생성으로 불일치 해소됨');
      }
      if (compliance2.length > 0) {
        console.error('[ANALYSIS] 재생성 후에도 컴플라이언스 금지어 감지 — 결과는 그대로 반환, 모니터링 필요:', compliance2);
      } else if (compliance1.length > 0) {
        console.log('[ANALYSIS] 재생성으로 컴플라이언스 위반 해소됨');
      }
      finalParsed = second.parsed;
    }

    const result: Omit<AnalysisResult, 'isCached'> = {
      reportType, // 서버 결정값으로 덮어씀 — AI가 echo를 잘못했을 경우 대비
      headline: sentValues.headline as string,
      mainAnalysis: sentValues.mainAnalysis as string,
      yesterdayDelta: sentValues.yesterdayDelta as string,
      riskFactor: sentValues.riskFactor as string,
      tags: sentValues.tags as string[],
      signal: clampSignal(finalParsed.signal), // AI가 지시된 4개 값을 벗어날 경우 대비
      current_price: price.price,
      resistance: info.week52High, // AI가 산출하지 않고 실제 52주 고가를 그대로 사용
      support: info.week52Low,     // AI가 산출하지 않고 실제 52주 저가를 그대로 사용
      tradingValueMultiple: tradingValueMultiple?.valid ? tradingValueMultiple.multiple : null,
      hasRelevantNews: relevantNews.length > 0,
      disclaimer: INVESTMENT_DISCLAIMER,
      createdAt: new Date().toISOString(),
    };

    // 히스토리 저장 — 하루 1건(ticker, report_date unique)만 남긴다. 장중 생성 캐시가
    // 마감 후 재생성될 때는 같은 (ticker, report_date)에 대한 두 번째 저장이 되므로,
    // insert가 아니라 upsert로 덮어써야 unique 제약 충돌 없이 최신 결과로 갱신된다.
    // 응답을 기다리지 않는 비동기 저장(after()로 등록 — 응답 직후 실행 컨텍스트가 얼어붙어
    // fetch가 중간에 끊기는 문제 방지, 2026-07-10 이전 코드에서 겪은 문제와 동일한 이유).
    after(async () => {
      const { error } = await supabase
        .from('stock_analysis_history')
        .upsert({
          ticker,
          report_date: todayStr,
          report_type: result.reportType,
          headline: result.headline,
          main_analysis: result.mainAnalysis,
          yesterday_delta: result.yesterdayDelta,
          risk_factor: result.riskFactor,
          tags: result.tags,
          current_price: result.current_price,
          price_change_pct: price.changeRate,
          reference_metrics: { week52High: info.week52High, week52Low: info.week52Low, per: info.per, pbr: info.pbr },
          internal_metrics: {
            tradingValueMultiple: result.tradingValueMultiple,
            mdd: riskMetrics?.mdd ?? null,
            volatility: riskMetrics?.volatility ?? null,
          },
          signal: result.signal,
          sentiment: signalToSentiment(result.signal),
          disclaimer: result.disclaimer,
          created_at: result.createdAt,
          regen_count: cachedRegenCount + 1,
        }, { onConflict: 'ticker,report_date' });
      if (error) console.error('[ANALYSIS] 결과 저장 실패:', error.message);
    });
    recordUsage();

    send({ type: 'done', createdAt: result.createdAt });
  });
}
