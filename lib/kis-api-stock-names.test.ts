// STOCK_NAMES(lib/kis-api.ts) 종목코드→종목명 매핑 회귀 테스트.
//
// 2026-07-09 "SK스퀘어(402340)가 SK스페셜티로 표시됨" 버그 조사 중, KIS의
// inquire-price(FHKST01010100)가 어떤 종목이든 hts_kor_isnm/prdt_abrv_name을 내려주지
// 않아 resolveStockName()이 사실상 항상 이 테이블로 폴백한다는 걸 확인했다(주석 참고).
// 즉 이 테이블의 오타/오매핑은 100% 그대로 화면에 노출된다 — 그런데도 이 파일은 순수
// 데이터라 KIS API를 부르는 lib/kis-api.ts 전체를 테스트하지 않고는 지금까지 검증 수단이
// 없었다. 같은 조사에서 KRX 상장법인목록(공식) + KIS search-stock-info로 전수 대조해
// 402340 포함 14건의 "코드는 맞는데 완전히 다른 회사명이 매핑된" 오류를 찾아 수정했고,
// 이 테스트는 그 수정값을 고정해 향후 실수로 되돌아가는 것을 막는다(네트워크 호출 없음
// — 값을 pin하는 정적 회귀 테스트).

import { describe, it, expect } from 'vitest';
import { STOCK_NAMES } from './kis-api';

describe('STOCK_NAMES — 2026-07-09 오매핑 수정 회귀 고정', () => {
  const corrected: Record<string, string> = {
    '402340': 'SK스퀘어',       // 최초 신고된 버그 — 이전엔 'SK스페셜티'(반도체 특수가스 회사, 무관한 회사)
    '005440': '현대지에프홀딩스', // 이전엔 '현대글로비스'
    '088350': '한화생명',        // 이전엔 'NH투자증권'
    '018290': '브이티',          // 이전엔 '레이'
    '057540': '옴니시스템',      // 이전엔 '셀트리온제약'
    '383310': '에코프로에이치엔', // 이전엔 '에코프로머티리얼즈'
    '950130': '엑세스바이오',    // 이전엔 '엑스페릭스'
    '065500': '오리엔트정공',    // 이전엔 '오에스아이소프트'
    '131970': '두산테스나',      // 이전엔 '테크윙'
    '060150': '인선이엔티',      // 이전엔 'SIMPAC'
    '220180': '핸디소프트',      // 이전엔 '한컴라이프케어'
    '189300': '인텔리안테크',    // 이전엔 '인터로조'
    '323990': '박셀바이오',      // 이전엔 '파나진'
    '008560': '메리츠증권',      // 이전엔 '메리츠금융지주'(완전자회사화로 정식명 변경)
  };

  for (const [code, expectedName] of Object.entries(corrected)) {
    it(`${code}는 '${expectedName}'로 매핑돼야 함`, () => {
      expect(STOCK_NAMES[code]).toBe(expectedName);
    });
  }

  it('무효 코드(024770, 실제 상장사 아님)는 테이블에서 제거됨', () => {
    expect(STOCK_NAMES['024770']).toBeUndefined();
  });

  it('모든 키는 6자리 숫자 문자열', () => {
    for (const code of Object.keys(STOCK_NAMES)) {
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('중복 종목코드 없음(객체 리터럴이라 애초에 불가능하지만 명시적으로 확인)', () => {
    const codes = Object.keys(STOCK_NAMES);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
