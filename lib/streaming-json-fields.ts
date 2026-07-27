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
  type: 'string' | 'string[]';
  emit: boolean; // false면 커서 이동만 하고 결과에 포함하지 않음(reportType/signal처럼 UI 미노출 필드)
}

export interface ExtractedField {
  key: string;
  value: string | string[];
}

export class StreamingFieldParser {
  private buffer = '';
  private cursor = 0;
  private specIndex = 0;

  constructor(private readonly specs: FieldSpec[]) {}

  // 델타 텍스트를 누적하고, 이번 호출로 새로 완결된 필드들을 순서대로 반환한다.
  // emit:false인 필드는 커서만 이동하고 반환 배열에는 포함하지 않는다.
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

  private tryExtract(spec: FieldSpec): { value: string | string[]; nextCursor: number } | null {
    const keyPattern = `"${spec.key}"`;
    const keyIdx = this.buffer.indexOf(keyPattern, this.cursor);
    if (keyIdx === -1) return null;

    let i = keyIdx + keyPattern.length;
    while (i < this.buffer.length && /[\s:]/.test(this.buffer[i])) i++;
    if (i >= this.buffer.length) return null;

    if (spec.type === 'string') {
      if (this.buffer[i] !== '"') return null;
      const strEnd = this.findStringEnd(i);
      if (strEnd === -1) return null;
      const raw = this.buffer.slice(i, strEnd + 1);
      let value: string;
      try { value = JSON.parse(raw); } catch { return null; }
      return { value, nextCursor: strEnd + 1 };
    }

    if (this.buffer[i] !== '[') return null;
    const arrEnd = this.findArrayEnd(i);
    if (arrEnd === -1) return null;
    const raw = this.buffer.slice(i, arrEnd + 1);
    let value: string[];
    try { value = JSON.parse(raw); } catch { return null; }
    return { value, nextCursor: arrEnd + 1 };
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
