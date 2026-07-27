import { describe, it, expect } from 'vitest';
import { StreamingFieldParser, STOCK_ANALYSIS_FIELD_SPECS, type FieldSpec } from './streaming-json-fields';

const SAMPLE = {
  reportType: 'news-driven',
  headline: '갤Z8 사전판매 개시',
  mainAnalysis: '오늘 삼성전자는 소폭 상승했다. 거래대금은 평균 대비 낮았다.',
  yesterdayDelta: '어제 대비 +1.6%p 상승 전환',
  riskFactor: '메모리 비용 전가 최소화 방침에 따른 수익성 압박',
  tags: ['갤럭시Z8', '반도체', '폴더블'],
  signal: '중립·관망',
};

function jsonOf(obj: typeof SAMPLE): string {
  return JSON.stringify(obj);
}

describe('StreamingFieldParser', () => {
  it('전체 JSON을 한 번에 먹이면 emit 대상 필드가 순서대로 전부 나온다', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const fields = parser.feed(jsonOf(SAMPLE));
    expect(fields.map(f => f.key)).toEqual(['headline', 'mainAnalysis', 'yesterdayDelta', 'riskFactor', 'tags']);
    expect(fields.find(f => f.key === 'headline')?.value).toBe(SAMPLE.headline);
    expect(fields.find(f => f.key === 'tags')?.value).toEqual(SAMPLE.tags);
  });

  it('reportType/signal은 emit:false라 결과에 포함되지 않는다', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const fields = parser.feed(jsonOf(SAMPLE));
    expect(fields.some(f => f.key === 'reportType')).toBe(false);
    expect(fields.some(f => f.key === 'signal')).toBe(false);
  });

  it('한 글자씩 흘려도(최악의 분할) 최종적으로 같은 필드를 같은 순서로 얻는다', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const full = jsonOf(SAMPLE);
    const collected: { key: string; value: unknown }[] = [];
    for (const ch of full) {
      collected.push(...parser.feed(ch));
    }
    expect(collected.map(f => f.key)).toEqual(['headline', 'mainAnalysis', 'yesterdayDelta', 'riskFactor', 'tags']);
    expect(collected.find(f => f.key === 'mainAnalysis')?.value).toBe(SAMPLE.mainAnalysis);
  });

  it('필드값 안에 이스케이프된 따옴표가 있어도 정확히 파싱한다', () => {
    const withQuote = { ...SAMPLE, headline: '삼성전자 "역대 최다 판매" 목표 재확인' };
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const fields = parser.feed(jsonOf(withQuote));
    expect(fields.find(f => f.key === 'headline')?.value).toBe(withQuote.headline);
  });

  it('필드값 안에 이스케이프된 따옴표를 문자 단위로 분할 스트리밍해도 정확히 파싱한다', () => {
    const withQuote = { ...SAMPLE, riskFactor: '"공급 계약" 관련 불확실성' };
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const full = jsonOf(withQuote);
    const collected: { key: string; value: unknown }[] = [];
    for (const ch of full) collected.push(...parser.feed(ch));
    expect(collected.find(f => f.key === 'riskFactor')?.value).toBe(withQuote.riskFactor);
  });

  it('tags 배열 안에 대괄호처럼 보이는 문자가 있어도(문자열 내부) 정확히 배열 끝을 찾는다', () => {
    const withBracket = { ...SAMPLE, tags: ['A[특수]', '반도체', '테마'] };
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const fields = parser.feed(jsonOf(withBracket));
    expect(fields.find(f => f.key === 'tags')?.value).toEqual(withBracket.tags);
  });

  it('필드가 값 도중에 끊기면(스트림 진행 중) 그 필드는 아직 반환하지 않는다', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const full = jsonOf(SAMPLE);
    const headlineValueEnd = full.indexOf(SAMPLE.headline) + Math.floor(SAMPLE.headline.length / 2);
    const partial = full.slice(0, headlineValueEnd);
    const fields = parser.feed(partial);
    expect(fields).toEqual([]);
  });

  it('여러 델타에 걸쳐 여러 필드가 나눠 도착해도 각 feed 호출에서 그 시점까지 완결된 필드만 반환한다', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const full = jsonOf(SAMPLE);
    const cut1 = full.indexOf('"mainAnalysis"'); // headline까지만 완결된 지점
    const cut2 = full.indexOf('"tags"'); // yesterdayDelta/riskFactor까지 완결된 지점

    const r1 = parser.feed(full.slice(0, cut1));
    expect(r1.map(f => f.key)).toEqual(['headline']);

    const r2 = parser.feed(full.slice(cut1, cut2));
    expect(r2.map(f => f.key)).toEqual(['mainAnalysis', 'yesterdayDelta', 'riskFactor']);

    const r3 = parser.feed(full.slice(cut2));
    expect(r3.map(f => f.key)).toEqual(['tags']);
  });

  it('커스텀 spec으로 임의 스키마도 동작한다(범용성 확인)', () => {
    const specs: FieldSpec[] = [
      { key: 'a', type: 'string', emit: true },
      { key: 'b', type: 'string[]', emit: true },
    ];
    const parser = new StreamingFieldParser(specs);
    const fields = parser.feed(JSON.stringify({ a: 'hello', b: ['x', 'y'] }));
    expect(fields).toEqual([
      { key: 'a', value: 'hello' },
      { key: 'b', value: ['x', 'y'] },
    ]);
  });
});
