// 2026-07-13 해외물 종목 리포트 뉴스 연동 — Naver 뉴스 검색은 한글 종목명일 때
// 관련 기사 적중률이 훨씬 높다(예: "NVDA"보다 "엔비디아" 검색 시 국내 매체 커버리지가
// 풍부함, 실측 확인). 검색 유니버스 자체는 Yahoo Finance 검색 API로 열려 있어(app/api/search)
// 특정 티커 목록으로 제한할 수 없으므로, 자주 조회되는 대형주 위주로 매핑해두고
// 매핑에 없는 티커는 영문 종목명으로 폴백 검색한다(app/api/stock/overseas/[ticker]/analysis).
export const OVERSEAS_KOREAN_NAMES: Record<string, string> = {
  AAPL:  '애플',
  MSFT:  '마이크로소프트',
  NVDA:  '엔비디아',
  GOOGL: '알파벳',
  GOOG:  '알파벳',
  AMZN:  '아마존',
  META:  '메타',
  TSLA:  '테슬라',
  NFLX:  '넷플릭스',
  AMD:   'AMD',
  INTC:  '인텔',
  QCOM:  '퀄컴',
  AVGO:  '브로드컴',
  CRM:   '세일즈포스',
  ORCL:  '오라클',
  ADBE:  '어도비',
  IBM:   'IBM',
  DIS:   '디즈니',
  NKE:   '나이키',
  KO:    '코카콜라',
  PEP:   '펩시코',
  MCD:   '맥도날드',
  SBUX:  '스타벅스',
  JPM:   'JP모건',
  BAC:   '뱅크오브아메리카',
  V:     '비자',
  MA:    '마스터카드',
  PYPL:  '페이팔',
  UBER:  '우버',
  BA:    '보잉',
  XOM:   '엑슨모빌',
  PFE:   '화이자',
  JNJ:   '존슨앤드존슨',
  BABA:  '알리바바',
  TSM:   'TSMC',
  SONY:  '소니',
  TM:    '도요타',
};

export function overseasSearchName(ticker: string, fallbackName: string): string {
  return OVERSEAS_KOREAN_NAMES[ticker.toUpperCase()] ?? fallbackName;
}
