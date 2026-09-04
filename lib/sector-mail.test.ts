// lib/sector-mail.ts 순수 함수 검증 — 네트워크/DB/Claude를 타는 함수는 라이브 검증(.e2e-tmp) 담당.
import { describe, it, expect } from 'vitest';
import {
  resolveSectorMailRecipient, selectIndustryRows, aggregateSectorFlows, pickSupplementTargets,
  isMorningAnalysisUsable, buildSectorMailHtml, SUPPLEMENT_MAX_CALLS,
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

describe('aggregateSectorFlows', () => {
  const idx = new Map<string, string[]>([
    ['005930', ['semicon', 'itparts']], // 삼성전자 — 두 섹터에 중복 집계
    ['000660', ['semicon']],
    ['042660', ['ship']],
    ['999999', []],                      // 소속 없음
  ]);
  it('섹터별 외국인/기관 합산, 중복 소속은 양쪽에 더하고, 합계 내림차순·종목은 거래대금순', () => {
    const aggs = aggregateSectorFlows([
      stock('005930', '삼성전자', 1000, 500, 5000),
      stock('000660', 'SK하이닉스', 2000, -100, 9000),
      stock('042660', '한화오션', -300, 50, 800),
      stock('999999', '무소속', 999, 999, 1),
    ], idx);
    expect(aggs.map((a) => a.id)).toEqual(['semicon', 'itparts', 'ship']);
    const semi = aggs[0];
    expect([semi.foreignAuk, semi.institutionAuk, semi.totalAuk]).toEqual([3000, 400, 3400]);
    expect(semi.stocks.map((s) => s.ticker)).toEqual(['000660', '005930']);
    expect(aggs[1]).toMatchObject({ id: 'itparts', foreignAuk: 1000, institutionAuk: 500 });
    expect(aggs[2]).toMatchObject({ id: 'ship', totalAuk: -250, supplementCount: 0 });
  });
  it('추정 보충 종목 수를 센다', () => {
    const aggs = aggregateSectorFlows([stock('042660', '한화오션', 10, 10, 1), stock('010140', '삼성중공업', 5, 5, 2, 'estimate')], new Map([['042660', ['ship']], ['010140', ['ship']]]));
    expect(aggs[0].supplementCount).toBe(1);
  });
});

describe('pickSupplementTargets', () => {
  const agg = (id: string, name: string, total: number, stocks: FlowStock[]): SectorFlowAgg => ({ id, name, foreignAuk: total, institutionAuk: 0, totalAuk: total, stocks, supplementCount: 0 });
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
      aggs: [{ id: 'x', name: 'A&B <섹터>', foreignAuk: 1, institutionAuk: 2, totalAuk: 3, stocks: [stock('1', 'N<1>', 1, 2, 3)], supplementCount: 0 }],
      synthesis: { topSectors: [{ name: 'A&B <섹터>', reason: 'r' }], morningComparison: '', marketNote: '', usedFallback: false },
      missing: [], kisCalls: 0, durationMs: 0,
    });
    expect(html).toContain('A&amp;B &lt;섹터&gt;');
    expect(html).not.toContain('<섹터>');
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
