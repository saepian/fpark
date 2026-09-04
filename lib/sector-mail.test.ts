// lib/sector-mail.ts 순수 함수 검증 — 네트워크/DB/Claude를 타는 함수는 라이브 검증(.e2e-tmp) 담당.
import { describe, it, expect } from 'vitest';
import {
  resolveSectorMailRecipient, selectIndustryRows, aggregateSectorFlows, pickSupplementTargets,
  isMorningAnalysisUsable, buildSectorMailHtml, SUPPLEMENT_MAX_CALLS,
  rankByIntensity, rankByChange, rankByAmount, INTENSITY_MIN_TRADING_VALUE_AUK, DOMINANT_SHARE_PCT,
  type FlowStock, type PoolStock, type SectorFlowAgg,
} from './sector-mail';
import { parseSignedPaddedInt, type SectorIndexRow } from './kis-api';

describe('resolveSectorMailRecipient — 수신자 1명 보장', () => {
  it('미설정이면 기본 주소, 정상 단일 주소는 그대로', () => {
    expect(resolveSectorMailRecipient(undefined)).toBe('saepian2@gmail.com');
    expect(resolveSectorMailRecipient('')).toBe('saepian2@gmail.com');
    expect(resolveSectorMailRecipient(' me@example.com ')).toBe('me@example.com');
  });
  it('다중 주소/이름 포함 형식은 거부한다', () => {
    expect(() => resolveSectorMailRecipient('a@x.com,b@y.com')).toThrow();
    expect(() => resolveSectorMailRecipient('a@x.com; b@y.com')).toThrow();
    expect(() => resolveSectorMailRecipient('Name <a@x.com>')).toThrow();
    expect(() => resolveSectorMailRecipient('not-an-email')).toThrow();
  });
});

describe('parseSignedPaddedInt — 18자리 제로패딩 부호 문자열', () => {
  it('부호 포함 제로패딩을 정수로 바꾼다', () => {
    expect(parseSignedPaddedInt('000000000000387000')).toBe(387000);
    expect(parseSignedPaddedInt('-00000000000032000')).toBe(-32000);
    expect(parseSignedPaddedInt('000000000000000000')).toBe(0);
    expect(parseSignedPaddedInt('')).toBe(0);
    expect(parseSignedPaddedInt(undefined)).toBe(0);
    expect(parseSignedPaddedInt('12a')).toBe(0);
  });
});

const row = (code: string, name: string, changeRate: number): SectorIndexRow => ({ code, name, value: 100, change: 0, changeRate, volume: 0, tradingValue: 0 });

describe('selectIndustryRows — 파생/규모 지수 제외', () => {
  it('코스피는 0005~0030만, 코스닥은 1005~1041만 남긴다', () => {
    const kospi = [row('0001', '종합', 1), row('0004', '소형주', 1), row('0005', '음식료·담배', 1), row('0030', '오락·문화', 1), row('0163', '고배당50', 1), row('2180', '코스피 200 ESG 지수', 1), row('0503', 'VKOSPI', 1)];
    expect(selectIndustryRows(kospi, 'KOSPI').map((r) => r.code)).toEqual(['0005', '0030']);
    const kosdaq = [row('1003', '코스닥 중형주', 1), row('1006', '일반서비스', 1), row('1015', '오락·문화', 1), row('1042', '우량기업', 1), row('3003', 'KSQ150', 1), row('1196', '코스닥 TR', 1)];
    const sel = selectIndustryRows(kosdaq, 'KOSDAQ');
    expect(sel.map((r) => r.code)).toEqual(['1006', '1015']);
    expect(sel.every((r) => r.market === 'KOSDAQ')).toBe(true);
  });
});

const stock = (ticker: string, name: string, f: number, i: number, tv: number, source: FlowStock['source'] = 'ranking'): FlowStock =>
  ({ ticker, name, price: 1000, changeRate: 1, foreignAuk: f, institutionAuk: i, tradingValueAuk: tv, source });

describe('aggregateSectorFlows — 수급 강도 · 가중 등락률 · 단일 종목 표기', () => {
  const idx = new Map<string, string[]>([
    ['005930', ['semicon']], ['000660', ['semicon']], ['042660', ['ship']], ['010140', ['ship']], ['999999', []], ['S1', ['chem']],
  ]);
  const st = (ticker: string, name: string, f: number, i: number, tv: number, chg: number, source: FlowStock['source'] = 'ranking'): FlowStock =>
    ({ ticker, name, price: 1000, changeRate: chg, foreignAuk: f, institutionAuk: i, tradingValueAuk: tv, source });
  const aggs = aggregateSectorFlows([
    st('005930', '삼성전자', 1000, 500, 9000, 1.0),   // 반도체: 순매수 1900, 거래대금 10000 → 강도 19%, 삼성전자 기여 1500/1900=79% → 단일 종목
    st('000660', 'SK하이닉스', 300, 100, 1000, 3.0),
    st('042660', '한화오션', 200, 100, 400, 5.0),       // 조선: 순매수 160, 거래대금 500 → 강도 32%, 가중등락률 (5*400+(-1)*100)/500 = 3.8
    st('010140', '삼성중공업', -150, 10, 100, -1.0),     //       |순매수| 비중 300/(300+140)=68% → 단일 종목 표기 없음
    st('S1', '소형정유', 20, 5, 20, 8.0),              // 석유화학: 거래대금 20 < 30 → 강도 null
    st('999999', '무소속', 999, 999, 1, 9.0),
  ], idx);
  it('강도 = 순매수÷거래대금, 거래대금 미달은 null, 순위는 강도 내림차순(null은 뒤)', () => {
    expect(aggs.map((a) => a.id)).toEqual(['ship', 'semicon', 'chem']);
    const ship = aggs[0], semi = aggs[1], chem = aggs[2];
    expect(ship.intensityPct).toBeCloseTo(32, 5);
    expect(semi.intensityPct).toBeCloseTo(19, 5);
    expect(chem.intensityPct).toBeNull();
    expect(chem.tradingValueAuk).toBeLessThan(INTENSITY_MIN_TRADING_VALUE_AUK);
    expect([semi.foreignAuk, semi.institutionAuk, semi.totalAuk, semi.tradingValueAuk]).toEqual([1300, 600, 1900, 10000]);
  });
  it('거래대금 가중 등락률과 상승률 순위', () => {
    const ship = aggs.find((a) => a.id === 'ship')!;
    expect(ship.weightedChangeRate).toBeCloseTo(3.8, 5);
    expect(aggs.find((a) => a.id === 'semicon')!.weightedChangeRate).toBeCloseTo(1.2, 5);
    expect(rankByChange(aggs).map((a) => a.id)).toEqual(['chem', 'ship', 'semicon']);
    expect(rankByAmount(aggs).map((a) => a.id)).toEqual(['semicon', 'ship', 'chem']);
    expect(rankByIntensity(rankByAmount(aggs)).map((a) => a.id)).toEqual(['ship', 'semicon', 'chem']);
  });
  it('단일 종목 기여도 ≥ 70%면 dominant 표기, 아니면 null, 1종목 섹터는 100%', () => {
    const semi = aggs.find((a) => a.id === 'semicon')!;
    expect(semi.dominant?.name).toBe('삼성전자');
    expect(semi.dominant!.sharePct).toBeGreaterThanOrEqual(DOMINANT_SHARE_PCT);
    expect(aggs.find((a) => a.id === 'ship')!.dominant).toBeNull();
    expect(aggs.find((a) => a.id === 'chem')!.dominant).toEqual({ name: '소형정유', sharePct: 100 });
  });
  it('추정 보충 종목 수를 센다', () => {
    const a = aggregateSectorFlows([st('042660', '한화오션', 10, 10, 100, 1), st('010140', '삼성중공업', 5, 5, 200, 2, 'estimate')], new Map([['042660', ['ship']], ['010140', ['ship']]]));
    expect(a[0].supplementCount).toBe(1);
  });
});

describe('pickSupplementTargets', () => {
  const agg = (id: string, name: string, total: number, stocks: FlowStock[]): SectorFlowAgg => ({ id, name, foreignAuk: total, institutionAuk: 0, totalAuk: total, tradingValueAuk: 1000, intensityPct: total / 10, weightedChangeRate: 0, dominant: null, stocks, supplementCount: 0 });
  const pool = (ticker: string, tv: number): PoolStock => ({ ticker, name: ticker, price: 1000, changeRate: 0, tradingValueAuk: tv });
  it('섹터 구성 종목 중 거래대금 상위 5개를 대표종목으로 보고, 그중 미수록 종목만 상한 내에서 고른다', () => {
    // a: 수록 A1(1000),A2(900),A3(800) + 풀 A4(950),A5(300),A6(200) → 거래대금 상위 5 = A1,A4,A2,A3,A5 → 미수록 A4,A5
    // b: 수록 없음 + 풀 B1(50),B2(60) → B2,B1
    const aggs = [
      agg('a', 'A', 100, [stock('A1', 'A1', 1, 1, 1000), stock('A2', 'A2', 1, 1, 900), stock('A3', 'A3', 1, 1, 800)]),
      agg('b', 'B', 50, []),
    ];
    const idx = new Map<string, string[]>([['A1', ['a']], ['A4', ['a']], ['A5', ['a']], ['A6', ['a']], ['B1', ['b']], ['B2', ['b']], ['Z', []]]);
    const p = [pool('A1', 1000), pool('A4', 950), pool('A5', 300), pool('A6', 200), pool('B1', 50), pool('B2', 60), pool('Z', 9999)];
    const covered = new Set(['A1', 'A2', 'A3']);
    expect(pickSupplementTargets(aggs, p, idx, covered).map((t) => t.ticker)).toEqual(['A4', 'A5', 'B2', 'B1']);
    expect(pickSupplementTargets(aggs, p, idx, covered, 3).map((t) => t.ticker)).toEqual(['A4', 'A5', 'B2']);
    // 대표종목 5개가 전부 수록돼 있으면 호출 0건(같은 값을 다시 받을 뿐이라 생략)
    const full = [agg('a', 'A', 100, ['A1', 'A2', 'A3', 'A7', 'A8'].map((x, i) => stock(x, x, 1, 1, 5000 - i)))];
    expect(pickSupplementTargets(full, p, idx, new Set(['A1', 'A2', 'A3', 'A7', 'A8']))).toEqual([]);
    expect(SUPPLEMENT_MAX_CALLS + 14).toBeLessThanOrEqual(40);
  });
});

describe('isMorningAnalysisUsable — 6h TTL + 같은 KST 날짜', () => {
  const now = new Date('2026-09-04T01:05:00Z'); // 10:05 KST
  const data = { dateKst: '2026-09-04', expectedSectors: [] };
  it('같은 날 6시간 이내면 사용', () => {
    expect(isMorningAnalysisUsable({ data, updated_at: '2026-09-03T23:30:00Z' }, now)).toBe(true);
  });
  it('6시간 초과·다른 날짜·빈 값은 폴백', () => {
    expect(isMorningAnalysisUsable({ data, updated_at: '2026-09-03T18:00:00Z' }, now)).toBe(false);
    expect(isMorningAnalysisUsable({ data: { ...data, dateKst: '2026-09-03' }, updated_at: '2026-09-03T23:30:00Z' }, now)).toBe(false);
    expect(isMorningAnalysisUsable(null, now)).toBe(false);
    expect(isMorningAnalysisUsable({ data: null, updated_at: '2026-09-03T23:30:00Z' }, now)).toBe(false);
  });
});

describe('buildSectorMailHtml — 결손 섹션은 "데이터 없음"으로, 발송 자체는 진행', () => {
  it('전부 결손이어도 4개 섹션이 있는 HTML을 만든다', () => {
    const html = buildSectorMailHtml({
      dateStr: '2026년 9월 4일', generatedAtKst: '2026-09-04 10:05', morning: null, index: null, aggs: [],
      synthesis: { topSectors: [], morningComparison: '', marketNote: '', usedFallback: true },
      missing: ['업종 등락률', '외국인/기관 수급'], kisCalls: 11, durationMs: 1234,
    });
    expect(html).toContain('아침 분석 생략');
    expect(html).toContain('업종 등락률: 데이터 없음');
    expect(html).toContain('섹터별 수급: 데이터 없음');
    expect(html).toContain('결손: 업종 등락률, 외국인/기관 수급');
    expect(html).not.toMatch(/<details|<input|onclick/); // 탭/아코디언 금지
  });
  it('HTML 특수문자를 이스케이프한다', () => {
    const html = buildSectorMailHtml({
      dateStr: 'd', generatedAtKst: 'g', morning: null, index: null,
      aggs: [{ id: 'x', name: 'A&B <섹터>', foreignAuk: 1, institutionAuk: 2, totalAuk: 3, tradingValueAuk: 100, intensityPct: 3, weightedChangeRate: 1, dominant: { name: 'N<1>', sharePct: 100 }, stocks: [stock('1', 'N<1>', 1, 2, 3)], supplementCount: 0 }],
      synthesis: { topSectors: [{ name: 'A&B <섹터>', reason: 'r' }], morningComparison: '', marketNote: '', usedFallback: false },
      missing: [], kisCalls: 0, durationMs: 0,
    });
    expect(html).toContain('A&amp;B &lt;섹터&gt;');
    expect(html).not.toContain('<섹터>');
    expect(html).toContain('사실상 N&lt;1&gt; 단일 종목 (100%)');
    expect(html).toContain('상승률 순위');
  });
});

describe('createChunkPacer — 묶음 시작 간격 보장', () => {
  it('두 번째 호출부터 최소 gapMs 간격을 둔다', async () => {
    const { createChunkPacer, KIS_CHUNK_MAX } = await import('./sector-mail');
    const pace = createChunkPacer(120);
    const t0 = Date.now();
    await pace(); const t1 = Date.now();
    await pace(); const t2 = Date.now();
    await pace(); const t3 = Date.now();
    expect(t1 - t0).toBeLessThan(50);
    expect(t2 - t1).toBeGreaterThanOrEqual(110);
    expect(t3 - t2).toBeGreaterThanOrEqual(110);
    expect(KIS_CHUNK_MAX + 1).toBeLessThanOrEqual(10); // 앵커 차트 1건과 같은 초에 겹쳐도 10 이하
  });
});

describe('09:30 속보 — 수급 없이 거래대금 유니버스만으로 상승률 랭킹', () => {
  it('poolToFlowUniverse는 수급 0·거래대금/등락률만 채우고, 집계 후 강도·단일종목 표기가 붙지 않는다', async () => {
    const { poolToFlowUniverse, buildSectorFlashHtml } = await import('./sector-mail');
    const pool: PoolStock[] = [
      { ticker: '042660', name: '한화오션', price: 1, changeRate: 4, tradingValueAuk: 300 },
      { ticker: '010140', name: '삼성중공업', price: 1, changeRate: -2, tradingValueAuk: 100 },
      { ticker: '005930', name: '삼성전자', price: 1, changeRate: 1, tradingValueAuk: 5000 },
    ];
    const uni = poolToFlowUniverse(pool);
    expect(uni.every((s) => s.foreignAuk === 0 && s.institutionAuk === 0 && s.source === 'ranking')).toBe(true);
    const aggs = rankByChange(aggregateSectorFlows(uni, new Map([['042660', ['ship']], ['010140', ['ship']], ['005930', ['semicon']]])));
    expect(aggs.map((a) => a.id)).toEqual(['ship', 'semicon']);
    expect(aggs[0].weightedChangeRate).toBeCloseTo((4 * 300 - 2 * 100) / 400, 5);
    expect(aggs[0].intensityPct).toBe(0);
    expect(aggs[0].dominant).toBeNull();
    const html = buildSectorFlashHtml({ dateStr: 'd', generatedAtKst: 'g', index: null, aggs, missing: ['업종 등락률'], kisCalls: 11, durationMs: 100 });
    expect(html).toContain('[09:30 속보]');
    expect(html).toContain('업종 등락률: 데이터 없음');
    expect(html).toContain('조선');
    expect(html).not.toContain('순매수');   // 수급 표기 없음
    expect(html).not.toContain('단일 종목');
    expect(html).not.toMatch(/<details|<input|onclick/);
  });
});
