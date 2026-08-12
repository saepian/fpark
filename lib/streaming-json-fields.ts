// 2026-07-27 종목분석 스트리밍 파일럿(app/api/stock/[ticker]/analysis/route.ts)용 — Claude가
// 지금과 똑같은 단일 JSON 문자열을 그대로 생성하는 걸 전제로, 그 델타 텍스트를 누적하면서
// "다음 키가 등장하기 전까지 닫힌 필드"만 순서대로 뽑아낸다. 프롬프트가 이미 강제하는
// 고정 키 순서("JSON 키 순서 및 구조 변경 금지")를 그대로 이용하므로 범용 partial-JSON
// 파서나 새 의존성 없이 우리 스키마(flat, string|string[] 필드만) 안에서만 동작한다.
//
// 중요: 이 파서는 "스트리밍 UX용 최선 추정"일 뿐, 정확성의 최종 근거가 아니다. 호출부는
// 스트림이 끝난 뒤 항상 전체 텍스트를 기존 방식(text.match(/\{[\s\S]*\}/) + JSON.parse)으로
// 다시 파싱해서 이 파서가 뽑아낸 값과 다르면 정정 이벤트를 별도로 보내야 한다(reconciliation).
// 즉 스트리밍이 잘못되거나 키 순서가 어긋나도 최종 데이터 정확성은 항상 전체파싱이 보장한다.

export interface FieldSpec {
  key: string;
  // 2026-07-27 포트폴리오분석 스트리밍 파일럿에서 'json' 추가 — sectors처럼 flat
  // string/string[]이 아닌 중첩 객체 배열용. partial(타이핑 효과)은 지원하지 않고
  // 완결 시에만 통째로 노출한다(tags와 동일 취급, feedWithPartial의 partial 판단은
  // type === 'string'만 통과시키므로 별도 분기 없이 자동으로 제외됨).
  type: 'string' | 'string[]' | 'json';
  emit: boolean; // false면 커서 이동만 하고 결과에 포함하지 않음(reportType/signal처럼 UI 미노출 필드)
}

export type JsonFieldValue = Record<string, unknown> | Record<string, unknown>[];

export interface ExtractedField {
  key: string;
  value: string | string[] | JsonFieldValue;
}

export interface PartialField {
  key: string;
  value: string;
}

export class StreamingFieldParser {
  private buffer = '';
  private cursor = 0;
  private specIndex = 0;
  // feedWithPartial 전용 — 현재 진행 중인 필드에서 "안전하게 잘라도 되는" 가장 먼 인덱스
  // (누적 커서, 매 호출마다 처음부터 다시 스캔하면 필드가 길어질수록 O(n²)가 되는 걸 방지).
  // feed()만 쓰는 인스턴스에서는 계속 -1로 남아 아무 영향 없다.
  private partialSafeEnd = -1;

  constructor(private readonly specs: FieldSpec[]) {}

  // 델타 텍스트를 누적하고, 이번 호출로 새로 완결된 필드들을 순서대로 반환한다.
  // emit:false인 필드는 커서만 이동하고 반환 배열에는 포함하지 않는다.
  // (2026-07-27 feedWithPartial 추가 이후에도 이 메서드 자체는 무변경 — 재생성/2차 생성이
  // 계속 이 메서드를 쓰므로 기존 "완성 시점에만 노출" 보장을 그대로 유지해야 한다.)
  feed(deltaText: string): ExtractedField[] {
    this.buffer += deltaText;
    const results: ExtractedField[] = [];
    while (this.specIndex < this.specs.length) {
      const spec = this.specs[this.specIndex];
      const found = this.tryExtract(spec);
      if (!found) break;
      if (spec.emit) results.push({ key: spec.key, value: found.value });
      this.cursor = found.nextCursor;
      this.specIndex++;
    }
    return results;
  }

  // feed()와 동일하게 완결된 필드를 뽑아내되, 그 다음으로 "지금 값이 채워지고 있는 중인"
  // 필드가 문자열 타입이면 지금까지 도착한 안전한 부분 문자열도 함께 반환한다(타이핑 효과용).
  // tags(string[])나 emit:false 필드는 partial을 지원하지 않는다 — 배열은 원소 인덱스까지
  // 추적해야 해서 복잡도 대비 이득이 적고, emit:false는 애초에 화면에 안 쓰인다.
  feedWithPartial(deltaText: string): { fields: ExtractedField[]; partial: PartialField | null } {
    this.buffer += deltaText;
    const fields: ExtractedField[] = [];
    while (this.specIndex < this.specs.length) {
      const spec = this.specs[this.specIndex];
      const found = this.tryExtract(spec);
      if (!found) break;
      if (spec.emit) fields.push({ key: spec.key, value: found.value });
      this.cursor = found.nextCursor;
      this.specIndex++;
      this.partialSafeEnd = -1; // 다음 필드로 넘어가니 리셋
    }

    let partial: PartialField | null = null;
    if (this.specIndex < this.specs.length) {
      const spec = this.specs[this.specIndex];
      if (spec.emit && spec.type === 'string') {
        const tokenStart = this.findValueTokenStart(spec);
        if (tokenStart !== null && this.buffer[tokenStart] === '"') {
          const valueStart = tokenStart + 1;
          const safeEnd = this.scanSafePartialEnd(valueStart);
          if (safeEnd > valueStart) {
            const raw = `"${this.buffer.slice(valueStart, safeEnd)}"`;
            try {
              partial = { key: spec.key, value: JSON.parse(raw) as string };
            } catch { /* 이론상 도달하지 않음 — scanSafePartialEnd가 항상 파싱 가능한 지점까지만 자름 */ }
          }
        }
      }
    }

    return { fields, partial };
  }

  // spec의 값 토큰(여는 따옴표 "나 여는 대괄호 [) 위치를 찾는다. 키 자체가 아직 안 왔거나
  // 콜론 뒤 값이 아직 안 왔으면 null. tryExtract와 feedWithPartial의 partial 스캔이
  // "값이 어디서 시작하는지"에 대해 항상 같은 지점을 보도록 공유한다(divergence 방지).
  private findValueTokenStart(spec: FieldSpec): number | null {
    const keyPattern = `"${spec.key}"`;
    const keyIdx = this.buffer.indexOf(keyPattern, this.cursor);
    if (keyIdx === -1) return null;

    let i = keyIdx + keyPattern.length;
    while (i < this.buffer.length && /[\s:]/.test(this.buffer[i])) i++;
    if (i >= this.buffer.length) return null;
    return i;
  }

  private tryExtract(spec: FieldSpec): { value: string | string[] | JsonFieldValue; nextCursor: number } | null {
    const i = this.findValueTokenStart(spec);
    if (i === null) return null;

    if (spec.type === 'string') {
      if (this.buffer[i] !== '"') return null;
      const strEnd = this.findStringEnd(i);
      if (strEnd === -1) return null;
      const raw = this.buffer.slice(i, strEnd + 1);
      let value: string;
      try { value = JSON.parse(raw); } catch { return null; }
      return { value, nextCursor: strEnd + 1 };
    }

    if (spec.type === 'json') {
      if (this.buffer[i] !== '{' && this.buffer[i] !== '[') return null;
      const end = this.findBalancedEnd(i);
      if (end === -1) return null;
      const raw = this.buffer.slice(i, end + 1);
      let value: JsonFieldValue;
      try { value = JSON.parse(raw); } catch { return null; }
      return { value, nextCursor: end + 1 };
    }

    if (this.buffer[i] !== '[') return null;
    const arrEnd = this.findArrayEnd(i);
    if (arrEnd === -1) return null;
    const raw = this.buffer.slice(i, arrEnd + 1);
    let value: string[];
    try { value = JSON.parse(raw); } catch { return null; }
    return { value, nextCursor: arrEnd + 1 };
  }

  // 'json' 타입 전용. start는 여는 { 또는 [ 위치. 문자열 내부는 무시하고(기존 findArrayEnd와
  // 같은 방식) 중첩 깊이를 추적해서 그 여는 괄호와 정확히 짝이 맞는 닫는 괄호 위치를 찾는다.
  // findArrayEnd와 달리 깊이 카운터를 두는 이유: sectors 같은 "객체 배열"은 내부에
  // "tickers":["005930"] 같은 중첩 배열/객체를 포함할 수 있어, 첫 ']'에서 멈추면
  // 바깥쪽이 아니라 안쪽 배열에서 잘못 멈춘다. partial 지원 없음(emit은 완결 시 1회만).
  private findBalancedEnd(start: number): number {
    let depth = 0;
    let inString = false;
    let i = start;
    while (i < this.buffer.length) {
      const c = this.buffer[i];
      if (inString) {
        if (c === '\\') { i += 2; continue; }
        if (c === '"') inString = false;
        i++;
        continue;
      }
      if (c === '"') { inString = true; i++; continue; }
      if (c === '{' || c === '[') { depth++; i++; continue; }
      if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) return i;
        i++;
        continue;
      }
      i++;
    }
    return -1;
  }

  // feedWithPartial 전용. valueStart(여는 따옴표 다음 위치)부터 시작해서, 완결된
  // 이스케이프 시퀀스만 통째로 포함하는 가장 먼 지점을 찾는다 — \" \\ \n 같은 2글자
  // 이스케이프는 물론, \uXXXX(6글자)가 스트림 델타 경계에 걸쳐 일부만 도착했을 때도
  // 그 이스케이프 시작 지점 이전에서 반드시 멈춘다(자칫 "...\u00"처럼 잘리면 그 자체로
  // 유효하지 않은 JSON 문자열이 되어 버리기 때문). this.partialSafeEnd에 진행 상황을
  // 누적해서, 다음 호출은 처음부터가 아니라 이 지점부터 이어서 스캔한다(O(n) 보장).
  private scanSafePartialEnd(valueStart: number): number {
    let i = Math.max(this.partialSafeEnd, valueStart);
    while (i < this.buffer.length) {
      const c = this.buffer[i];
      if (c === '"') break; // 닫는 따옴표 — 이미 완결됐어야 정상(feed 경로가 처리), 방어적으로만
      if (c === '\\') {
        const next = this.buffer[i + 1];
        if (next === undefined) break; // "\"만 오고 다음 글자가 아직 안 옴
        if (next === 'u') {
          if (i + 6 > this.buffer.length) break; // \uXXXX 4자리가 아직 다 안 옴
          i += 6;
        } else {
          i += 2;
        }
        continue;
      }
      i++;
    }
    this.partialSafeEnd = i;
    return i;
  }

  // start는 여는 따옴표 위치. 이스케이프(\") 문자를 건너뛰며 닫는 따옴표 위치를 찾는다.
  // 아직 안 닫혔으면(스트림이 그 문자열 중간까지만 도착) -1.
  private findStringEnd(start: number): number {
    let i = start + 1;
    while (i < this.buffer.length) {
      const c = this.buffer[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '"') return i;
      i++;
    }
    return -1;
  }

  // start는 여는 대괄호 위치. 문자열 내부의 ']'는 무시하고 실제 닫는 대괄호 위치를 찾는다.
  private findArrayEnd(start: number): number {
    let i = start + 1;
    let inString = false;
    while (i < this.buffer.length) {
      const c = this.buffer[i];
      if (inString) {
        if (c === '\\') { i += 2; continue; }
        if (c === '"') inString = false;
        i++;
        continue;
      }
      if (c === '"') { inString = true; i++; continue; }
      if (c === ']') return i;
      i++;
    }
    return -1;
  }
}

// 종목분석 스키마 전용 spec — COMMON_INSTRUCTIONS의 키 순서와 반드시 일치해야 한다.
export const STOCK_ANALYSIS_FIELD_SPECS: FieldSpec[] = [
  { key: 'reportType', type: 'string', emit: false },
  { key: 'headline', type: 'string', emit: true },
  { key: 'mainAnalysis', type: 'string', emit: true },
  { key: 'yesterdayDelta', type: 'string', emit: true },
  { key: 'riskFactor', type: 'string', emit: true },
  { key: 'tags', type: 'string[]', emit: true },
  { key: 'signal', type: 'string', emit: false },
];

// 2026-07-27 포트폴리오분석 스트리밍 — app/api/portfolio-diagnosis/route.ts의
// STOCK_SIGNAL_INSTRUCTIONS 키 순서와 반드시 일치해야 한다.
export const PORTFOLIO_STOCK_FIELD_SPECS: FieldSpec[] = [
  { key: 'ticker', type: 'string', emit: false },
  { key: 'signal', type: 'string', emit: false },
  { key: 'reason', type: 'string', emit: true },
  { key: 'sector', type: 'string', emit: true },
];

// 포트폴리오 종합 분석(Stage 2) 스키마 — PORTFOLIO_SUMMARY_INSTRUCTIONS 키 순서와
// 반드시 일치해야 한다. sectors는 'json'(중첩 객체) — partial 없이 완결 시에만 노출.
// 2026-08-12: summarySections(json, partial 미지원)를 4개 독립 string 필드로 분리 —
// 기업분석 mainAnalysisSections 분리(DIAGNOSIS_FIELD_SPECS 참고)와 동일한 이유·동일한
// 패턴. background/newsInterpretation/historicalComparison/judgment는 원래도 flat
// string이었으므로 top-level로 끌어올리면 institutionalFlow 등과 동일하게 글자 단위
// partial(타이핑 효과)을 그대로 받는다. route.ts가 스트림 종료 후 이 4개를
// summarySections 객체로 재조립해 DB 저장·공유페이지 등 기존 소비처는 그대로 유지한다.
export const PORTFOLIO_SUMMARY_FIELD_SPECS: FieldSpec[] = [
  { key: 'summarySections_background',           type: 'string', emit: true },
  { key: 'summarySections_newsInterpretation',    type: 'string', emit: true },
  { key: 'summarySections_historicalComparison',  type: 'string', emit: true },
  { key: 'summarySections_judgment',              type: 'string', emit: true },
  { key: 'sectors', type: 'json', emit: true },
  // 2026-08-04: {text,category} 객체 배열로 구조화(macro/company 태깅) — sectors와 동일하게 'json'
  { key: 'riskFactors', type: 'json', emit: true },
  { key: 'opportunityFactors', type: 'string[]', emit: true },
  { key: 'historyNarrative', type: 'string', emit: true },
  { key: 'contributionNarrative', type: 'string', emit: true },
  { key: 'holdingPeriodNarrative', type: 'string', emit: true },
  { key: 'coMovementNarrative', type: 'string', emit: true },
  { key: 'shortTermOutlook', type: 'string', emit: true },
  { key: 'midTermOutlook', type: 'string', emit: true },
];

// 2026-08-11 기업분석 스트리밍 전환 — app/api/diagnosis/route.ts의
// DIAGNOSIS_OUTPUT_INSTRUCTIONS 키 순서와 반드시 일치해야 한다. 원래 스키마에 있던
// flowPercentage(순수 숫자 리터럴)는 제외했다 — 이 파서는 'string'/'string[]'/'json'만
// 지원해서 값 토큰이 "나 {/[로 시작하지 않으면 tryExtract가 그 필드에서 영원히 멈추고
// 이후 모든 필드가 증분 파싱을 못 받는다. flowPercentage는 어차피 서버가 KIS 실측
// 수급 데이터로 재계산해 Claude 응답값을 항상 덮어쓰므로(route.ts) 프롬프트 스키마
// 자체에서 삭제했다 — 이 spec은 그 삭제된 스키마를 그대로 반영한다.
// 2026-08-12: mainAnalysisSections(json, partial 미지원)를 4개 독립 string 필드로
// 분리 — sectors 같은 중첩 객체 배열과 달리 이 4개는 원래도 flat string이었으므로
// (background/flowSummary/valuationNote/watchPoint), top-level로 끌어올리면
// institutionalFlow 등과 동일하게 글자 단위 partial(타이핑 효과)을 그대로 받는다.
// route.ts가 스트림 종료 후 이 4개를 mainAnalysisSections 객체로 재조립해 DB
// 저장·공유페이지 등 기존 소비처는 그대로 유지한다.
export const DIAGNOSIS_FIELD_SPECS: FieldSpec[] = [
  { key: 'mainAnalysisSections_background',    type: 'string', emit: true },
  { key: 'mainAnalysisSections_flowSummary',   type: 'string', emit: true },
  { key: 'mainAnalysisSections_valuationNote', type: 'string', emit: true },
  { key: 'mainAnalysisSections_watchPoint',    type: 'string', emit: true },
  { key: 'historyNarrative',     type: 'string',   emit: true },
  { key: 'sectorNarrative',      type: 'string',   emit: true },
  { key: 'financialsNarrative',  type: 'string',   emit: true },
  { key: 'disclosureNarrative',  type: 'string',   emit: true },
  { key: 'riskFactors',          type: 'string[]', emit: true },
  { key: 'institutionalFlow',    type: 'string',   emit: true },
  { key: 'foreignFlow',          type: 'string',   emit: true },
  { key: 'shortTermOutlook',     type: 'string',   emit: true },
  { key: 'midTermOutlook',       type: 'string',   emit: true },
  { key: 'finalVerdict',         type: 'string',   emit: true },
  { key: 'newsIssueClusters',    type: 'json',      emit: true },
];
