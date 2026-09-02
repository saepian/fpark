// 기관/외국인 카드의 5일 캡션(institutionalFlow/foreignFlow)에서 주어 접두어를 떼어낸다(2026-09-02).
// 2026-09-02 S-Oil 실화면에서 "최근 5거래일 중 3일 순유입" / "…4일 순유입" 두 줄이 어느 쪽이 기관이고
// 어느 쪽이 외국인인지 알 수 없게 나왔다 — AI 캡션에 주어를 기대하던 구조라 어제(2026-09-01)
// flowInsight 통합 뒤 주어가 빠지면 라벨이 통째로 사라졌다. 이제 카드가 "기관"/"외국인" 라벨을
// 직접 붙이므로, AI가 주어를 넣어도 "기관 기관: …"처럼 겹치지 않게 앞머리를 정리한다.
// "기관투자자…"처럼 단어의 일부인 경우는 건드리지 않는다(뒤에 콜론·공백·조사+공백이 와야 매치).
const SUBJECT_PREFIX = /^(?:기관|외국인)(?:\s*[:：]\s*|\s+|\s*(?:은|는|이|가|의)\s+)/;

export function stripFlowSubject(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(SUBJECT_PREFIX, '').trim();
}
