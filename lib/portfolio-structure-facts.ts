// 포트폴리오분석 Stage 2 프롬프트용 "포트폴리오 구조 데이터" 블록(2026-09-01 신설).
//
// 배경: AI 종합평가 4개 소제목이 사실상 뉴스 해설로 채워져 "이게 내 포트폴리오를 분석한
// 건가?"라는 느낌을 주지 못했다. 서버가 이미 계산해 둔 정량 지표(평가금액 비중, 섹터 비중·
// HHI·실효 업종 수, 종목 간 상관계수, 변동성 기여도, 종목별 매입가 대비 손익)를 AI가 그대로
// 인용해 '구조'를 서술하도록, 여기서 한 번에 텍스트로 정리해 프롬프트에 주입한다.
//
// 원칙: 숫자는 전부 서버가 계산한다(AI가 비중·비율을 어림하거나 옮겨 적다 틀릴 여지를
// 없앤다). 이 파일은 순수 함수만 두고(Anthropic SDK·Supabase 의존 없음) vitest로 직접
// 검증한다 — lib/portfolio-analysis-pipeline.ts는 모듈 로드 시 Anthropic 클라이언트를
// 만들어 단위 테스트에 부적합하다.

export interface StructureFactsHolding {
  ticker: string;
  name: string;
  value: number;               // 현재 평가금액(원)
  invested: number;            // 매입금액(원)
  profit: number;              // 평가손익(원) = value - invested
  profitRate: number;          // 매입가 대비 손익률(%)
  volatility: number | null;   // 최근 3개월 일별 변동성(%), 없으면 null
}

import type { WeightDriftRow } from './portfolio-position';

export interface StructureFactsInput {
  holdings: StructureFactsHolding[];
  weightDrift?: WeightDriftRow[]; // 매입 시점 비중 → 현재 비중(computeWeightDrift) — 있으면 드리프트 라인 추가
  totalValue: number;
  totalInvested: number;
  totalProfit: number;
  sectors: { name: string; tickers: string[]; weight: number }[];              // computeSectorBreakdown 결과(weight = %)
  sectorConcentration: { hhi: number; effectiveCount: number; grade: string } | null;
  riskContribution: { ticker: string; name: string; pct: number }[] | null;     // computeRiskContribution 결과(pct = %)
  correlation: { correlation: number; sampleSize: number; bucket: string } | null;
}

const won = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(Math.round(n)).toLocaleString()}원`;
const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;
const signedPct = (n: number, digits = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;

// 그룹 합계 대비 각 항목의 비율(%) — 합계가 0이면 빈 문자열(나눗셈 무의미).
function shareLine(items: { name: string; amount: number }[], groupSum: number): string {
  if (items.length === 0 || groupSum === 0) return '';
  return items
    .map(i => `${i.name} ${pct((i.amount / groupSum) * 100)}`)
    .join(', ');
}

export function buildPortfolioStructureFacts(input: StructureFactsInput): string {
  const { holdings, totalValue, totalInvested, totalProfit, sectors, sectorConcentration, riskContribution, correlation, weightDrift } = input;
  if (holdings.length === 0) return '데이터 없음';

  const tickerToSector = new Map<string, string>();
  for (const s of sectors) for (const t of s.tickers) tickerToSector.set(t, s.name);
  const riskByTicker = new Map<string, number>();
  for (const r of riskContribution ?? []) riskByTicker.set(r.ticker, r.pct);

  const byWeight = [...holdings].sort((a, b) => b.value - a.value);
  const weightOf = (h: StructureFactsHolding) => (totalValue > 0 ? (h.value / totalValue) * 100 : 0);

  const lines: string[] = [];
  lines.push(`- 종목 수: ${holdings.length}개 | 총 평가금액 ${Math.round(totalValue).toLocaleString()}원 (총 매입금액 ${Math.round(totalInvested).toLocaleString()}원, 평가손익 ${won(totalProfit)})`);

  // 종목별 구성 — 평가금액 비중 순
  lines.push('- 종목별 구성(평가금액 비중 순):');
  for (const h of byWeight) {
    const sector = tickerToSector.get(h.ticker);
    const risk = riskByTicker.get(h.ticker);
    lines.push(
      `  · ${h.name}${sector ? `(${sector})` : ''}: 비중 ${pct(weightOf(h))} | 매입가 대비 ${signedPct(h.profitRate)} (${won(h.profit)})` +
      (risk !== undefined ? ` | 변동성 기여도 ${pct(risk)}` : ''),
    );
  }

  // 매입 시점 비중 → 현재 비중 드리프트(2026-09-01 3차) — 손익 방향이 배분을 저절로 바꿔 놓은 사실
  if (weightDrift && weightDrift.length >= 2) {
    const parts = weightDrift.map(d => `${d.name} ${pct(d.buyWeight)} → ${pct(d.currentWeight)} (${d.deltaPp >= 0 ? '+' : ''}${d.deltaPp.toFixed(1)}%p)`);
    const lossRows = weightDrift.filter(d => (d.profitRate ?? 0) < 0);
    const lossBuy = lossRows.reduce((s, d) => s + d.buyWeight, 0);
    const lossNow = lossRows.reduce((s, d) => s + d.currentWeight, 0);
    lines.push(`- 매입 시점 비중 → 현재 비중(드리프트): ${parts.join(' / ')}`);
    if (lossRows.length > 0) lines.push(`  · 손실 종목 합산 비중: 매입 시점 ${pct(lossBuy)} → 현재 ${pct(lossNow)} (${lossNow - lossBuy >= 0 ? '+' : ''}${(lossNow - lossBuy).toFixed(1)}%p — 손익 방향이 배분을 바꿔 놓은 결과, 추가 매매 없이 생긴 이동)`);
  }

  // 섹터 비중 + 집중도
  if (sectors.length > 0) {
    const sectorNames = (tickers: string[]) => tickers.map(t => holdings.find(h => h.ticker === t)?.name ?? t).join(', ');
    lines.push(`- 섹터별 비중: ${[...sectors].sort((a, b) => b.weight - a.weight).map(s => `${s.name} ${pct(s.weight)} (${sectorNames(s.tickers)})`).join(' / ')}`);
  }
  if (sectorConcentration) {
    lines.push(
      `- 섹터 집중도: HHI ${sectorConcentration.hhi.toFixed(3)}, 실효 업종 수 ${sectorConcentration.effectiveCount}개 → 등급 '${sectorConcentration.grade}' ` +
      `(실효 업종 수 = 비중이 완전히 고르게 분산됐다고 볼 때 몇 개 업종에 해당하는지; 명목 업종 수 ${sectors.length}개보다 작을수록 특정 섹터로 쏠려 있음)`,
    );
  } else {
    lines.push('- 섹터 집중도: 계산 안 함(종목 수 부족)');
  }

  // 상관계수
  lines.push(
    correlation
      ? `- 종목 간 상관계수: ${correlation.correlation.toFixed(2)} (${correlation.bucket}, 최근 ${correlation.sampleSize}거래일 평가금액 가중 평균) — 1에 가까울수록 같은 방향으로 움직여 분산 효과가 작음`
      : '- 종목 간 상관계수: 계산 안 함(종목 수 부족 또는 시계열 부족)',
  );

  // 변동성 기여도 — 상위 종목 + 섹터별 합산
  if (riskContribution && riskContribution.length > 0) {
    const top = riskContribution[0];
    const bySector = new Map<string, number>();
    for (const r of riskContribution) {
      const s = tickerToSector.get(r.ticker) ?? '기타';
      bySector.set(s, (bySector.get(s) ?? 0) + r.pct);
    }
    const sectorSum = [...bySector.entries()].sort((a, b) => b[1] - a[1]).map(([s, p]) => `${s} ${pct(p)}`).join(' / ');
    lines.push(`- 변동성 기여도(비중×변동성 근사, 합계 100%): 상위 1종목 ${top.name} ${pct(top.pct)}${bySector.size > 0 ? ` | 섹터별 합산 ${sectorSum}` : ''}`);
  } else {
    lines.push('- 변동성 기여도: 계산 안 함');
  }

  // 손익 구조 — 매입가 대비 누적 손익이 어디서 나오는지
  const losers  = holdings.filter(h => h.profit < 0);
  const gainers = holdings.filter(h => h.profit > 0);
  const lossSum = losers.reduce((s, h) => s + h.profit, 0);   // 음수
  const gainSum = gainers.reduce((s, h) => s + h.profit, 0);  // 양수
  const lossWeightPct = totalValue > 0 ? (losers.reduce((s, h) => s + h.value, 0) / totalValue) * 100 : 0;
  lines.push(
    `- 손익 구조(매입가 대비 누적): 손실 종목 ${losers.length}/${holdings.length}개(평가금액 기준 ${pct(lossWeightPct)}), 이익 종목 ${gainers.length}개 | ` +
    `손실 종목 합산 ${won(lossSum)}, 이익 종목 합산 ${won(gainSum)}, 전체 ${won(totalProfit)}` +
    ` (※ '손실 종목 합산'은 손실 종목만 더한 값 — 상단 카드의 총 손익(전체)과 다르므로 서술에 쓸 때 반드시 '손실 종목 합산'이라고 명시)`,
  );
  const lossShare = shareLine(losers.map(h => ({ name: h.name, amount: h.profit })).sort((a, b) => a.amount - b.amount), lossSum);
  if (lossShare) lines.push(`  · 전체 손실 중 종목별 비율: ${lossShare}`);
  const gainShare = shareLine(gainers.map(h => ({ name: h.name, amount: h.profit })).sort((a, b) => b.amount - a.amount), gainSum);
  if (gainShare) lines.push(`  · 전체 이익 중 종목별 비율: ${gainShare}`);

  // 섹터별 누적 손익(섹터 정보가 있을 때만)
  if (sectors.length > 0) {
    const profitBySector = new Map<string, number>();
    for (const h of holdings) {
      const s = tickerToSector.get(h.ticker) ?? '기타';
      profitBySector.set(s, (profitBySector.get(s) ?? 0) + h.profit);
    }
    const parts = [...profitBySector.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([s, p]) => {
        const ref = p < 0 ? lossSum : gainSum;
        const share = ref !== 0 ? ` (${p < 0 ? '전체 손실' : '전체 이익'}의 ${pct((p / ref) * 100)})` : '';
        return `${s} ${won(p)}${share}`;
      });
    lines.push(`  · 섹터별 누적 손익: ${parts.join(' / ')}`);
  }

  // 비중 1위 vs 손익 절대액 1위 일치 여부 — "큰 비중이 큰 손익을 만들고 있는가"
  const topWeight = byWeight[0];
  const topAbsProfit = [...holdings].sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit))[0];
  if (topWeight && topAbsProfit) {
    lines.push(
      `- 비중 1위 ${topWeight.name}(${pct(weightOf(topWeight))}) vs 손익 절대액 1위 ${topAbsProfit.name}(${won(topAbsProfit.profit)}) → ${topWeight.ticker === topAbsProfit.ticker ? '일치(비중이 큰 종목이 손익도 좌우)' : '불일치(손익은 비중 1위가 아닌 종목에서 더 크게 발생)'}`,
    );
  }

  return lines.join('\n');
}
