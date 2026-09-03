// 포트폴리오 "구조" 순수 계산 모듈 (2026-09-01 리포트 재편) — 매입 비중 vs 현재 비중 드리프트,
// 종목별 "내 포트폴리오에서의 위치"(비중·손익 기여·변동성 기여) 한 줄 요약.
//
// 서버(라우트·프롬프트 사실 블록)와 클라이언트(메인·공유·대시보드 카드) 양쪽이 같은 함수를
// 쓴다 — 화면마다 따로 계산하면 숫자가 어긋날 수 있어 한 곳에서만 정의한다. 외부 의존 없음.

export interface WeightDriftInput {
  ticker: string; name: string;
  invested: number;   // 매입금액 = 매입가 × 수량
  value: number;      // 현재 평가금액 = 현재가 × 수량
  profitRate?: number;
}

export interface WeightDriftRow {
  ticker: string; name: string;
  buyWeight: number;     // 매입 시점 비중(%) = invested / Σinvested
  currentWeight: number; // 현재 비중(%) = value / Σvalue
  deltaPp: number;       // currentWeight - buyWeight (%p)
  profitRate: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

// 매입 시점 배분(매입가×수량)과 현재 배분(현재가×수량)을 종목별로 나란히 — 손실 종목의 비중이
// 저절로 줄고 이익 종목의 비중이 커지는 "구조의 이동"을 보여주는 순수 사실. 현재 비중 내림차순.
export function computeWeightDrift(holdings: WeightDriftInput[]): WeightDriftRow[] {
  const totalInvested = holdings.reduce((s, h) => s + (h.invested > 0 ? h.invested : 0), 0);
  const totalValue    = holdings.reduce((s, h) => s + (h.value > 0 ? h.value : 0), 0);
  if (holdings.length === 0 || totalInvested <= 0 || totalValue <= 0) return [];
  return holdings
    .map(h => {
      const buyWeight     = r1((Math.max(h.invested, 0) / totalInvested) * 100);
      const currentWeight = r1((Math.max(h.value, 0) / totalValue) * 100);
      return {
        ticker: h.ticker, name: h.name,
        buyWeight, currentWeight,
        deltaPp: r1(currentWeight - buyWeight),
        profitRate: typeof h.profitRate === 'number' ? h.profitRate : null,
      };
    })
    .sort((a, b) => b.currentWeight - a.currentWeight);
}

export interface PnlSums { lossSum: number; gainSum: number } // lossSum ≤ 0, gainSum ≥ 0

export function computePnlSums(holdings: { profit: number }[]): PnlSums {
  return {
    lossSum: holdings.reduce((s, h) => s + (h.profit < 0 ? h.profit : 0), 0),
    gainSum: holdings.reduce((s, h) => s + (h.profit > 0 ? h.profit : 0), 0),
  };
}

export interface HoldingPositionSummary {
  weightPct: number;                       // 현재 평가금액 비중(%)
  pnlSharePct: number | null;              // 같은 부호 그룹(전체 손실/전체 이익) 내 비율(%)
  pnlShareKind: 'loss' | 'gain' | null;
  riskPct: number | null;                  // 변동성 기여도(%)
}

export function buildHoldingPositionSummary(
  h: { ticker: string; value: number; profit: number },
  ctx: { totalValue: number; pnl: PnlSums; riskByTicker: Map<string, number> | Record<string, number> },
): HoldingPositionSummary {
  const weightPct = ctx.totalValue > 0 ? r1((h.value / ctx.totalValue) * 100) : 0;
  let pnlSharePct: number | null = null; let pnlShareKind: 'loss' | 'gain' | null = null;
  if (h.profit < 0 && ctx.pnl.lossSum < 0) { pnlSharePct = r1((h.profit / ctx.pnl.lossSum) * 100); pnlShareKind = 'loss'; }
  else if (h.profit > 0 && ctx.pnl.gainSum > 0) { pnlSharePct = r1((h.profit / ctx.pnl.gainSum) * 100); pnlShareKind = 'gain'; }
  const risk = ctx.riskByTicker instanceof Map ? ctx.riskByTicker.get(h.ticker) : ctx.riskByTicker[h.ticker];
  return { weightPct, pnlSharePct, pnlShareKind, riskPct: typeof risk === 'number' ? risk : null };
}

// 2026-09-03 최종 다듬기 — "종목별 개별 이슈" 카드(riskFactors/opportunityFactors 문장)를 기업별
// 관찰 지표의 성격 태그로 흡수. AI(Stage 2)는 [{name, tag}]만 내고, 서버가 종목명→티커로 해석한다.
// name은 매핑의 종목명을 그대로 쓰라고 지시하지만, 띄어쓰기·접미사 차이("SK하이닉스" vs
// "SK하이닉스(주)")를 포함 관계로 흡수하고, 해석 안 되거나 tag가 유효하지 않은 항목은 버린다.
// 종목당 1개(먼저 나온 것 우선). 순수 함수라 여기(외부 의존 없는 모듈)에 두고 테스트한다.
export type HoldingIssueTag = 'risk' | 'positive';
export type HoldingTag = { ticker: string; name: string; tag: HoldingIssueTag };

export function resolveHoldingTags(raw: unknown, nameMap: Record<string, string>): HoldingTag[] {
  if (!Array.isArray(raw)) return [];
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const entries = Object.entries(nameMap).map(([ticker, name]) => ({ ticker, name, key: norm(name) }));
  const seen = new Set<string>();
  const out: HoldingTag[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = (item as Record<string, unknown>).name;
    const tag = (item as Record<string, unknown>).tag;
    if (typeof name !== 'string' || (tag !== 'risk' && tag !== 'positive')) continue;
    const key = norm(name);
    if (!key) continue;
    const hit = entries.find((e) => e.key === key)
      ?? entries.find((e) => key.includes(e.key) || e.key.includes(key));
    if (!hit || seen.has(hit.ticker)) continue;
    seen.add(hit.ticker);
    out.push({ ticker: hit.ticker, name: hit.name, tag });
  }
  return out;
}

// "포트폴리오 비중 31.5% · 전체 손실의 78.9% · 변동성 기여 61.2%" — 없는 항목은 생략.
export function formatHoldingPositionLine(s: HoldingPositionSummary): string {
  const parts = [`포트폴리오 비중 ${s.weightPct.toFixed(1)}%`];
  if (s.pnlSharePct !== null && s.pnlShareKind) parts.push(`전체 ${s.pnlShareKind === 'loss' ? '손실' : '이익'}의 ${s.pnlSharePct.toFixed(1)}%`);
  if (s.riskPct !== null) parts.push(`변동성 기여 ${s.riskPct.toFixed(1)}%`);
  return parts.join(' · ');
}
