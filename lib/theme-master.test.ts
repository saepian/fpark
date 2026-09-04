import { describe, it, expect } from 'vitest';
import { parseThemeMasterText, buildTickerSectorIndex, findMissingThemeCodes, type ThemeMaster } from './theme-master';

// 2026-09-04 실제 theme_code.mst에서 뽑은 행 형태(테마코드 3자 + 테마명 + 우측 9자 폭 종목코드).
const SAMPLE = [
  '0272018 신규 상장주                        027360   ',
  '0272018 신규 상장주                        110790   ',
  '004반도체/반도체장비                       005930   ',
  '004반도체/반도체장비                       000660   ',
  '004반도체/반도체장비                       005930   ', // 중복 종목 — 한 번만
  '076조선                                    042660   ',
  '231HBM                                     005930   ',
  'XX잘못된행',
  '',
].join('\r\n');

describe('parseThemeMasterText', () => {
  it('테마코드/테마명/종목코드를 실측 포맷대로 파싱하고 중복·불량 행을 걸러낸다', () => {
    const themes = parseThemeMasterText(SAMPLE);
    expect(themes.map((t) => t.code)).toEqual(['027', '004', '076', '231']);
    expect(themes.find((t) => t.code === '027')).toEqual({ code: '027', name: '2018 신규 상장주', tickers: ['027360', '110790'] });
    expect(themes.find((t) => t.code === '004')?.tickers).toEqual(['005930', '000660']);
    // 레퍼런스 sector_code.py식 슬라이스 버그(코드 일부가 이름에 섞임)가 없어야 한다
    expect(themes.every((t) => !/^\d/.test(t.name) || t.name.startsWith('2018'))).toBe(true);
  });
});

describe('buildTickerSectorIndex / findMissingThemeCodes', () => {
  const master: ThemeMaster = { fetchedAt: 'x', themes: parseThemeMasterText(SAMPLE) };
  const groups = [
    { id: 'semicon', name: '반도체', themeCodes: ['004', '231'] },
    { id: 'ship', name: '조선', themeCodes: ['076', '999'] },
  ];
  it('종목 → 소속 그룹 목록(중복 없이)을 만든다', () => {
    const idx = buildTickerSectorIndex(master, groups);
    expect(idx.get('005930')).toEqual(['semicon']); // 004와 231 둘 다 반도체지만 한 번만
    expect(idx.get('000660')).toEqual(['semicon']);
    expect(idx.get('042660')).toEqual(['ship']);
    expect(idx.get('027360')).toBeUndefined();
  });
  it('마스터에 없는 테마코드를 보고한다', () => {
    expect(findMissingThemeCodes(master, groups)).toEqual(['999']);
  });
});

describe('buildTickerPrimarySectorIndex — 종목당 대표 섹터 1개', () => {
  it('오버라이드 맵 우선, 그 외는 테마수 최소 그룹, 동률이면 그룹 순서', async () => {
    const { buildTickerPrimarySectorIndex } = await import('./theme-master');
    const { resolvePrimarySector } = await import('./sector-groups');
    const master: ThemeMaster = { fetchedAt: 'x', themes: [
      { code: '004', name: '반도체/반도체장비', tickers: ['005930', '000660', '111111'] },
      { code: '906', name: '스마트폰', tickers: ['005930', '009150', '111111'] },
      { code: '231', name: 'HBM', tickers: ['005930'] },
      { code: '076', name: '조선', tickers: ['042660'] },
    ] };
    const idx = buildTickerPrimarySectorIndex(master);
    expect(idx.get('005930')).toEqual(['semicon']); // 오버라이드
    expect(idx.get('009150')).toEqual(['itparts']); // 오버라이드
    expect(idx.get('042660')).toEqual(['ship']);
    // 111111: 반도체(테마 7개) vs 스마트폰/IT부품(테마 7개) 동률 → SECTOR_GROUPS 순서상 반도체
    expect(idx.get('111111')).toEqual(['semicon']);
    expect([...idx.values()].every((v) => v.length === 1)).toBe(true);
    // 오버라이드 종목은 마스터에 없어도 귀속
    expect(idx.get('373220')).toEqual(['battery']);
    // 규칙: 테마수 최소 그룹 우선
    const groups = [{ id: 'big', name: 'B', themeCodes: ['1', '2', '3'] }, { id: 'small', name: 'S', themeCodes: ['4'] }];
    expect(resolvePrimarySector('X', ['big', 'small'], groups, {})).toBe('small');
    expect(resolvePrimarySector('X', ['big'], groups, { X: 'nonexistent' })).toBe('big'); // 무효 오버라이드는 무시
    expect(resolvePrimarySector('X', [], groups, {})).toBeNull();
  });
});
