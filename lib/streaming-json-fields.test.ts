import { describe, it, expect } from 'vitest';
import { StreamingFieldParser, STOCK_ANALYSIS_FIELD_SPECS, PORTFOLIO_SUMMARY_FIELD_SPECS, type FieldSpec } from './streaming-json-fields';

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

describe('StreamingFieldParser.feedWithPartial (문자단위 타이핑 효과)', () => {
  it('전체를 한 번에 먹이면 fields는 feed()와 동일하고 partial은 null이다(스트림이 이미 다 끝났으므로)', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const { fields, partial } = parser.feedWithPartial(jsonOf(SAMPLE));
    expect(fields.map(f => f.key)).toEqual(['headline', 'mainAnalysis', 'yesterdayDelta', 'riskFactor', 'tags']);
    expect(partial).toBeNull();
  });

  it('문자 단위로 흘리면 partial이 최종값의 접두사로 단조증가하다가 완결 시 fields로 넘어간다', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const full = jsonOf(SAMPLE);
    const partialLengths: number[] = [];
    let lastHeadlinePartial = '';
    let headlineDone: string | undefined;

    for (const ch of full) {
      const { fields, partial } = parser.feedWithPartial(ch);
      if (partial?.key === 'headline') {
        expect(SAMPLE.headline.startsWith(partial.value)).toBe(true);
        expect(partial.value.length).toBeGreaterThanOrEqual(lastHeadlinePartial.length);
        lastHeadlinePartial = partial.value;
        partialLengths.push(partial.value.length);
      }
      const f = fields.find(x => x.key === 'headline');
      if (f) headlineDone = f.value as string;
    }

    // 진행 도중(마지막 완결 순간 이전) 최소 한 번은 전체보다 짧은 길이를 거쳐야
    // "점진적으로 자라났다"고 할 수 있다 — 마지막 partial 자체는 닫는 따옴표 직전에
    // 이미 전체 글자가 다 도착한 상태일 수 있어(구조적으로만 미완결) 전체 길이와 같을 수 있다.
    expect(partialLengths.some((len) => len < SAMPLE.headline.length)).toBe(true);
    expect(headlineDone).toBe(SAMPLE.headline);
  });

  it('이스케이프된 따옴표가 포함된 필드를 문자 단위로 흘려도 partial은 항상 최종값의 유효한 접두사다(깨진 값 없음)', () => {
    const value = '삼성전자 "역대 최다 판매" 목표 재확인';
    const raw = jsonOf({ ...SAMPLE, headline: value });
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    let lastPartial = '';
    let done: string | undefined;

    for (const ch of raw) {
      const { fields, partial } = parser.feedWithPartial(ch);
      if (partial?.key === 'headline') {
        expect(value.startsWith(partial.value)).toBe(true);
        expect(partial.value.length).toBeGreaterThanOrEqual(lastPartial.length);
        lastPartial = partial.value;
      }
      const f = fields.find(x => x.key === 'headline');
      if (f) done = f.value as string;
    }
    expect(lastPartial.length).toBeGreaterThan(0);
    expect(done).toBe(value);
  });

  it('\\uXXXX 이스케이프가 델타 경계에 걸쳐 2/4자리만 도착했을 때, 그 이스케이프 시작 전까지만 partial로 노출한다', () => {
    // 일부러 JSON.stringify가 안 만드는 \uXXXX 형태를 수기로 구성 — A == 'A'.
    // 템플릿 리터럴에서 "\\u0041"은 실제 문자 6개(\,u,0,0,4,1)를 만든다(JS가 유니코드로
    // 해석하는 게 아니라 리터럴 백슬래시 이스케이프).
    const rawJson = '{"reportType":"x","headline":"A\\u0041B","mainAnalysis":"m","yesterdayDelta":"y","riskFactor":"r","tags":["t"],"signal":"s"}';
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);

    const escapeStart = rawJson.indexOf('\\u0041');
    const splitPoint  = escapeStart + 3; // '\','u','0' 까지만 도착, 남은 '0','4','1'은 아직
    const part1 = rawJson.slice(0, splitPoint);
    const part2 = rawJson.slice(splitPoint);

    const r1 = parser.feedWithPartial(part1);
    expect(r1.fields).toEqual([]);
    expect(r1.partial).toEqual({ key: 'headline', value: 'A' }); // \u 이스케이프 시작 이전까지만

    const r2 = parser.feedWithPartial(part2);
    const headline = r2.fields.find(f => f.key === 'headline');
    expect(headline?.value).toBe('AAB'); // A == 'A' → "A" + "A" + "B"
  });

  it('\\uXXXX가 한 글자씩(총 6번) 쪼개져 도착해도 완결 전엔 항상 이스케이프 시작 전 지점에서 멈춘다', () => {
    const rawJson = '{"reportType":"x","headline":"가\\u0042나","mainAnalysis":"m","yesterdayDelta":"y","riskFactor":"r","tags":["t"],"signal":"s"}';
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const escapeStart = rawJson.indexOf('\\u0042');

    let sawStalledAtEscape = false;
    for (let i = 0; i < rawJson.length; i++) {
      const { fields, partial } = parser.feedWithPartial(rawJson[i]);
      if (partial?.key === 'headline') {
        // \uXXXX는 6글자(\,u,+4자리)가 전부 도착해야 완결 — escapeStart+5까지 도착해야
        // 6번째(마지막) 글자까지 온 것이므로, 그 전(escapeStart..escapeStart+4)까지는
        // 아직 이스케이프가 미완결이라 partial이 이스케이프 시작 이전 지점에서 멈춰야 한다.
        if (i >= escapeStart && i < escapeStart + 5) {
          expect(partial.value).toBe('가');
          sawStalledAtEscape = true;
        }
      }
      const done = fields.find(f => f.key === 'headline');
      if (done) expect(done.value).toBe('가B나'); // B == 'B'
    }
    expect(sawStalledAtEscape).toBe(true);
  });

  it('tags(string[])는 partial 대상이 아니다 — 완결될 때까지 아무 partial도 안 나온다', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const full = jsonOf(SAMPLE);
    const tagsKeyIdx = full.indexOf('"tags"');
    const tagsEndIdx = full.indexOf(']', tagsKeyIdx) + 1;

    // riskFactor까지 끝내고 tags 값 도중까지만 먹인다(마지막 원소 닫는 따옴표 전에서 끊음)
    const midTags = full.slice(0, tagsEndIdx - 3);
    const { partial } = parser.feedWithPartial(midTags);
    expect(partial).toBeNull();
  });

  it('emit:false 필드(reportType/signal)는 partial을 절대 내보내지 않는다', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    // reportType 값 "news-driven" 도중까지만 먹인다
    const full = jsonOf(SAMPLE);
    const cut = full.indexOf('"news-driven') + 6;
    const { fields, partial } = parser.feedWithPartial(full.slice(0, cut));
    expect(fields).toEqual([]);
    expect(partial).toBeNull();
  });

  it('필드가 전환돼도 다음 필드에서 partial이 다시 정상적으로(처음부터) 나온다', () => {
    const parser = new StreamingFieldParser(STOCK_ANALYSIS_FIELD_SPECS);
    const full = jsonOf(SAMPLE);
    let mainAnalysisPartialSeen = false;

    for (const ch of full) {
      const { partial } = parser.feedWithPartial(ch);
      if (partial?.key === 'mainAnalysis') {
        expect(SAMPLE.mainAnalysis.startsWith(partial.value)).toBe(true);
        mainAnalysisPartialSeen = true;
      }
    }
    expect(mainAnalysisPartialSeen).toBe(true);
  });
});

describe("StreamingFieldParser 'json' 타입 (포트폴리오분석 holdingTags) + summarySections_* 평탄화(2026-08-12)", () => {
  // 2026-08-28: sectors가 AI 스키마에서 제거되면서(서버 계산으로 대체) 이 파일의 'json'
  // 타입 커버리지(중첩 배열·문자열 내부 대괄호 등)를 riskFactors로 옮겼고, 2026-09-03
  // riskFactors/opportunityFactors가 holdingTags(종목별 성격 태그)로 대체되면서 다시 옮겼다 —
  // related는 실제 프로덕션 스키마엔 없는 필드지만, 파서는 스키마 의미를 모르고 순수하게
  // 괄호 깊이만 세므로 중첩 배열·문자열 내부 대괄호 케이스를 재현하는 용도로만 추가했다.
  const PORTFOLIO_SAMPLE = {
    summarySections_structure: '4종목 중 반도체 2종목이 평가금액의 65%를 차지하는 구조다.',
    summarySections_concentration: '실효 업종 수 2.0개, 상관계수 0.72로 분산 효과가 제한적이다.',
    summarySections_pnlStructure: '',
    summarySections_judgment: '이번 하락은 업종 전체 심리 위축에 가깝다.',
    holdingTags: [
      { name: '삼성전자', tag: 'risk', related: ['005930', '메모리[가격]'] },
      { name: '종근당', tag: 'positive' },
    ],
    holdingPeriodNarrative: '',
    shortTermOutlook: '이 포트폴리오는 반도체 업황 뉴스에 민감하게 반응할 수 있다.',
    midTermOutlook: '중기적으로는 실적 발표 시즌이 핵심 변수다.',
  };

  it('summarySections_* 4개 string 필드를 한 번에 먹이면 정확히 파싱되고, 그 다음 holdingTags(json)도 정상 진행된다', () => {
    const parser = new StreamingFieldParser(PORTFOLIO_SUMMARY_FIELD_SPECS);
    const { fields } = parser.feedWithPartial(JSON.stringify(PORTFOLIO_SAMPLE));
    expect(fields.find(f => f.key === 'summarySections_structure')?.value).toBe(PORTFOLIO_SAMPLE.summarySections_structure);
    expect(fields.find(f => f.key === 'summarySections_concentration')?.value).toBe(PORTFOLIO_SAMPLE.summarySections_concentration);
    expect(fields.find(f => f.key === 'summarySections_pnlStructure')?.value).toBe(PORTFOLIO_SAMPLE.summarySections_pnlStructure);
    expect(fields.find(f => f.key === 'summarySections_judgment')?.value).toBe(PORTFOLIO_SAMPLE.summarySections_judgment);
    const holdingTags = fields.find(f => f.key === 'holdingTags');
    expect(holdingTags?.value).toEqual(PORTFOLIO_SAMPLE.holdingTags);
    expect(fields.find(f => f.key === 'shortTermOutlook')?.value).toBe(PORTFOLIO_SAMPLE.shortTermOutlook);
  });

  // 2026-08-12: mainAnalysisSections와 동일한 이유로 summarySections도 json→4개 string
  // 필드로 분리 — institutionalFlow 등과 같은 'string' 타입 필드가 됐으므로 이제 문자
  // 단위 partial(타이핑 효과)을 지원해야 한다(분리 전엔 riskFactors처럼 완결 시 1회만 노출).
  it('summarySections_structure는 이제 string 타입이라 문자 단위로 흘리면 partial이 최종값의 접두사로 단조증가한다(타이핑 효과 확인)', () => {
    const parser = new StreamingFieldParser(PORTFOLIO_SUMMARY_FIELD_SPECS);
    const full = JSON.stringify(PORTFOLIO_SAMPLE);
    const partialLengths: number[] = [];
    let lastPartial = '';
    let done: string | undefined;

    for (const ch of full) {
      const { fields, partial } = parser.feedWithPartial(ch);
      if (partial?.key === 'summarySections_structure') {
        expect(PORTFOLIO_SAMPLE.summarySections_structure.startsWith(partial.value)).toBe(true);
        expect(partial.value.length).toBeGreaterThanOrEqual(lastPartial.length);
        lastPartial = partial.value;
        partialLengths.push(partial.value.length);
      }
      const f = fields.find(x => x.key === 'summarySections_structure');
      if (f) done = f.value as string;
    }

    expect(partialLengths.some((len) => len < PORTFOLIO_SAMPLE.summarySections_structure.length)).toBe(true);
    expect(done).toBe(PORTFOLIO_SAMPLE.summarySections_structure);
  });

  it('summarySections_judgment(4번째, riskFactors보다 앞)도 순서대로 도착해 partial이 정상 동작한다', () => {
    const parser = new StreamingFieldParser(PORTFOLIO_SUMMARY_FIELD_SPECS);
    const full = JSON.stringify(PORTFOLIO_SAMPLE);
    let judgmentPartialSeen = false;
    let done: string | undefined;

    for (const ch of full) {
      const { fields, partial } = parser.feedWithPartial(ch);
      if (partial?.key === 'summarySections_judgment') {
        expect(PORTFOLIO_SAMPLE.summarySections_judgment.startsWith(partial.value)).toBe(true);
        judgmentPartialSeen = true;
      }
      const f = fields.find(x => x.key === 'summarySections_judgment');
      if (f) done = f.value as string;
    }
    expect(judgmentPartialSeen).toBe(true);
    expect(done).toBe(PORTFOLIO_SAMPLE.summarySections_judgment);
  });

  it('중첩 배열(relatedTickers) 내부의 첫 "]"에서 잘못 멈추지 않고 riskFactors 전체(바깥 배열)의 끝까지 정확히 찾는다', () => {
    // riskFactors 안 첫 원소의 relatedTickers 배열이 닫히는 지점(내부 ']')까지만 먼저
    // 먹여서, 그 시점엔 아직 riskFactors 필드 자체가 완결되면 안 된다는 걸 확인한다.
    const full = JSON.stringify(PORTFOLIO_SAMPLE);
    const innerArrayEnd = full.indexOf('"메모리[가격]"]') + '"메모리[가격]"]'.length; // 첫 related 배열 닫는 ']' 직후
    const parser = new StreamingFieldParser(PORTFOLIO_SUMMARY_FIELD_SPECS);

    const r1 = parser.feedWithPartial(full.slice(0, innerArrayEnd));
    expect(r1.fields.find(f => f.key === 'holdingTags')).toBeUndefined(); // 아직 바깥 배열 안 끝남

    const r2 = parser.feedWithPartial(full.slice(innerArrayEnd));
    const holdingTags = r2.fields.find(f => f.key === 'holdingTags');
    expect(holdingTags?.value).toEqual(PORTFOLIO_SAMPLE.holdingTags);
  });

  it('holdingTags는 emit:true·type:json이라도 partial(타이핑 효과)이 나오지 않는다 — 완결 시 1회만', () => {
    const parser = new StreamingFieldParser(PORTFOLIO_SUMMARY_FIELD_SPECS);
    const full = JSON.stringify(PORTFOLIO_SAMPLE);
    let sawTagsPartial = false;
    for (const ch of full) {
      const { partial } = parser.feedWithPartial(ch);
      if (partial?.key === 'holdingTags') sawTagsPartial = true;
    }
    expect(sawTagsPartial).toBe(false);
  });

  it('holdingTags 문자열 값 안에 대괄호처럼 보이는 문자가 있어도(문자열 내부) 깊이 계산이 깨지지 않는다', () => {
    const withBracketInString = {
      ...PORTFOLIO_SAMPLE,
      holdingTags: [{ name: '삼성전자[우]', tag: 'risk', related: ['005930'] }],
    };
    const parser = new StreamingFieldParser(PORTFOLIO_SUMMARY_FIELD_SPECS);
    const { fields } = parser.feedWithPartial(JSON.stringify(withBracketInString));
    expect(fields.find(f => f.key === 'holdingTags')?.value).toEqual(withBracketInString.holdingTags);
    expect(fields.find(f => f.key === 'shortTermOutlook')?.value).toEqual(PORTFOLIO_SAMPLE.shortTermOutlook);
  });

  it('문자 단위로 흘려도 summarySections_*/holdingTags 이후 모든 문자열 필드가 순서대로 정확히 완결된다(엔드투엔드)', () => {
    const parser = new StreamingFieldParser(PORTFOLIO_SUMMARY_FIELD_SPECS);
    const full = JSON.stringify(PORTFOLIO_SAMPLE);
    const collected: Record<string, unknown> = {};
    for (const ch of full) {
      const { fields } = parser.feedWithPartial(ch);
      for (const f of fields) collected[f.key] = f.value;
    }
    expect(collected).toEqual(PORTFOLIO_SAMPLE);
  });

  it('holdingTags가 빈 배열이어도(고유 이슈 없는 포트폴리오) 정상 처리된다', () => {
    const empty = { ...PORTFOLIO_SAMPLE, holdingTags: [] };
    const parser = new StreamingFieldParser(PORTFOLIO_SUMMARY_FIELD_SPECS);
    const { fields } = parser.feedWithPartial(JSON.stringify(empty));
    expect(fields.find(f => f.key === 'holdingTags')?.value).toEqual([]);
    expect(fields.find(f => f.key === 'midTermOutlook')?.value).toEqual(PORTFOLIO_SAMPLE.midTermOutlook);
  });
});
