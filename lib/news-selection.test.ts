// 2026-09-03 조사: selectRelevantNews가 종목과 무관한 시장 전체/타종목 기사를 참고기사에
// 섞는 문제(9/2 기업분석 검토, 셀트리온 사례) 검증. 실측(market_cache 캐시 154개 종목 전수
// 조사)에서 발견된 실제 오염 사례를 그대로 회귀 테스트로 인코딩한다.
import { describe, it, expect } from 'vitest';
import { filterUnrelated, type NewsCandidate } from './news-selection';

describe('filterUnrelated', () => {
  it('종목명이 본문에 있으면 무조건 유지', () => {
    const items: NewsCandidate[] = [{ title: '현대차, 8월 잔혹사…국내 판매 40% 털썩' }];
    expect(filterUnrelated(items, '005380', '현대차')).toHaveLength(1);
  });

  it('종목코드가 본문에 있으면 유지(종목명 표기가 다르더라도)', () => {
    const items: NewsCandidate[] = [{ title: '[특징주] DB하이텍(000990), 8인치 파운드리 호황' }];
    expect(filterUnrelated(items, '000990', '디비하이텍')).toHaveLength(1);
  });

  // 2026-09-03 실측: 현대차(005380) 리포트에 실제로 섞여 들어온 기사 — 현대차와 전혀
  // 무관한 미국 소프트웨어 기업 실적 기사. 오늘 등락률 정보가 없으면(대부분의 호출부가
  // changeRate 없이 부르는 경우 포함) 종목명 미언급 기사는 예외 없이 제거된다.
  it('종목명·코드 둘 다 없고 오늘 등락률 정보도 없으면 제거(실측: 현대차 리포트의 스노우플레이크 기사)', () => {
    const items: NewsCandidate[] = [{ title: '[증시전략] 스노우플레이크, 실적 상향에 시간외 거래서 21% 급등' }];
    expect(filterUnrelated(items, '005380', '현대차')).toHaveLength(0);
  });

  // 2026-09-03 실측: S-Oil(010950, 정유주) 리포트에 섞여 들어온, 완전히 다른 업종(반도체)
  // 시황 기사 — "반등" 같은 가격반응 키워드가 있어도, S-Oil 자신의 등락률 숫자가 아니라
  // 코스피·다른 종목 얘기이므로 제거돼야 한다. heuristicPriceRelevanceScore의 키워드
  // 매칭만으로는 이걸 못 걸러낸다는 게 최초 설계의 허점이었다(시황 기사는 원래 급등락
  // 키워드를 쓰는 게 본업이라 키워드만으로는 통과선을 넘기가 너무 쉬웠음) — 그래서
  // 이 종목 자신의 등락률 숫자 매칭으로 예외 조건을 좁혔다.
  it('가격반응 키워드가 있어도 이 종목 자신의 등락률이 아니면 제거(실측: S-Oil 리포트의 반도체 시황 기사)', () => {
    const items: NewsCandidate[] = [{ title: "코스피, 이란 공습에도 반등...삼전·닉스가 'V자 반전' 주도" }];
    expect(filterUnrelated(items, '010950', 'S-Oil')).toHaveLength(0);
    expect(filterUnrelated(items, '010950', 'S-Oil', 2.1)).toHaveLength(0); // S-Oil 오늘 등락률(예: 2.1%)이 본문에 없으므로 changeRate를 줘도 여전히 제거
  });

  // 2026-09-03 실측: 오리온홀딩스(001800) 리포트에 섞여 들어온, 종목명도 없고 가격반응
  // 키워드도 없는 순수 업종 나열 기사.
  it('가격반응 키워드도 없는 순수 업종 나열 기사는 제거(실측: 오리온홀딩스 리포트)', () => {
    const items: NewsCandidate[] = [
      { title: '항공·여행·식음료 업종 수혜 부각…원화 강세 모멘텀에 매수세 유입' },
    ];
    expect(filterUnrelated(items, '001800', '오리온홀딩스')).toHaveLength(0);
  });

  // 2026-07-31에 의도적으로 허용한 케이스(코드 주석 참고) — 종목명이 없어도 이 종목 자신의
  // 오늘 등락률 숫자가 본문에 실제로 언급되면(=이 종목의 가격 반응을 다루는 기사) 살린다.
  it('종목명이 없어도 이 종목 자신의 오늘 등락률이 본문에 있으면 유지(07/31 전례 보존)', () => {
    const items: NewsCandidate[] = [{ title: '美 반도체주 급반등…필라델피아지수 8.19% 상승' }];
    expect(filterUnrelated(items, '005930', '삼성전자', 8.19)).toHaveLength(1);
    expect(filterUnrelated(items, '005930', '삼성전자', 15.0)).toHaveLength(0); // 삼성전자 자신의 등락률이 다르면(숫자 불일치) 더는 예외가 아님
  });

  it('여러 건 중 일부만 걸러내고 순서는 유지', () => {
    const items: NewsCandidate[] = [
      { title: '현대차, 신형 전기차 공개' },
      { title: '스노우플레이크, 실적 상향에 급등' },
      { title: '현대차 노조 파업 여파에 내수 41% 급감' },
    ];
    const result = filterUnrelated(items, '005380', '현대차');
    expect(result.map((r) => r.title)).toEqual(['현대차, 신형 전기차 공개', '현대차 노조 파업 여파에 내수 41% 급감']);
  });

  it('전부 무관하면 빈 배열(무관한 기사로 억지로 채우지 않음)', () => {
    const items: NewsCandidate[] = [
      { title: "코스피, 외인·기관 '팔자'에 4% 급락…6600선으로 후퇴" },
    ];
    expect(filterUnrelated(items, '402340', 'SK스퀘어')).toHaveLength(0);
  });

  it('summary(스니펫)에만 종목명이 있어도 유지', () => {
    const items: NewsCandidate[] = [
      { title: '반도체 업황 훈풍', summary: '이 중 삼성전자는 목표가가 상향됐다' },
    ];
    expect(filterUnrelated(items, '005930', '삼성전자')).toHaveLength(1);
  });
});

// 2026-09-04 비용 절감: 후보 상한·파싱 견고화
import { buildSelectionList, parseSelectionIndices, NEWS_SELECTION_CANDIDATE_CAP, NEWS_SELECTION_TTL_MS } from './news-selection';

describe('buildSelectionList — 휴리스틱 정렬 후 상위 80건 상한', () => {
  const mk = (n: number, title: string, summary = '') => ({ title: `${title}${n}`, summary, date: undefined as string | undefined });
  it('상한 초과분은 뒤(점수 낮고 오래된 순서)부터 잘리고 ★ 후보는 앞쪽에 남는다', () => {
    const cands = Array.from({ length: 190 }, (_, i) => mk(i, '일반 기사 '));
    cands[150] = mk(150, '특징주 급등 ', '오늘 8.7% 급등'); // 키워드 +2, 등락률 매칭 +3 → ★
    const { scored, list, truncated } = buildSelectionList(cands, 8.7);
    expect(scored).toHaveLength(NEWS_SELECTION_CANDIDATE_CAP);
    expect(truncated).toBe(190 - NEWS_SELECTION_CANDIDATE_CAP);
    expect(scored[0].c.title).toBe('특징주 급등 150');
    expect(list.split('\n')[0].startsWith('0: ★ ')).toBe(true);
    expect(list.split('\n')).toHaveLength(NEWS_SELECTION_CANDIDATE_CAP);
  });
  it('상한 이하면 전부 포함, 인덱스는 0부터 연속', () => {
    const { scored, list, truncated } = buildSelectionList([mk(1, 'a'), mk(2, 'b'), mk(3, 'c')], 0);
    expect(scored).toHaveLength(3); expect(truncated).toBe(0);
    expect(list.split('\n').map((l) => l.split(':')[0])).toEqual(['0', '1', '2']);
  });
});

describe('parseSelectionIndices — 구조화 출력 + 구형 배열 + 프리앰블/이중 배열', () => {
  it('구조화 출력 객체', () => { expect(parseSelectionIndices('{"indices":[2,5,72]}')).toEqual([2, 5, 72]); });
  it('구형 배열 그대로', () => { expect(parseSelectionIndices('[2, 5, 6]')).toEqual([2, 5, 6]); });
  it('프리앰블 뒤 배열, 배열이 둘이면 첫 번째만', () => {
    expect(parseSelectionIndices('분석 결과:\n[1,2]\n\n참고: [9,9,9]')).toEqual([1, 2]);
    expect(parseSelectionIndices('```json\n[3,7]\n```')).toEqual([3, 7]);
  });
  it('숫자 아닌 배열/없음 → null', () => {
    expect(parseSelectionIndices('["a"]')).toBeNull();
    expect(parseSelectionIndices('관련 기사가 없습니다')).toBeNull();
    expect(parseSelectionIndices('{"indices":"x"}')).toBeNull();
  });
  it('기본 TTL 상수는 20분', () => { expect(NEWS_SELECTION_TTL_MS).toBe(20 * 60 * 1000); });
});
