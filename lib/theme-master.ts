// KIS 테마 마스터 파일(theme_code.mst.zip) 다운로드 + cp949 파싱 + market_cache 캐시 (2026-09-04).
//
// 파일 포맷(2026-09-04 실측, 5,528행/302테마/2,333종목): 한 행 = [테마코드 3자][테마명][종목코드
// 우측 9자 폭]. 공식 레퍼런스(open-trading-api stocks_info/theme_code.py)는 row[-10:]으로
// 개행 포함 10자를 잘라 rstrip하므로, 개행을 뗀 뒤엔 우측 9자가 종목코드 필드다. 같은 저장소의
// sector_code.py(idxcode.mst)는 업종명 슬라이스가 코드 2자리를 이름에 섞는 버그가 있어 여기선
// 레퍼런스를 그대로 옮기지 않고 실측 포맷대로 직접 파싱한다.
// 파일은 매일 08:45 KST경 갱신된다(last-modified 실측) — 10:05 크론 시점엔 당일본.

import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { cacheJsonResult } from '@/lib/kis-api';
import { SECTOR_GROUPS, MEGA_CAP_SECTOR_OVERRIDE, resolvePrimarySector, type SectorGroup } from '@/lib/sector-groups';

export const THEME_MASTER_URL = 'https://new.real.download.dws.co.kr/common/master/theme_code.mst.zip';
// 24h로 두면 "어제 10:05 캐시"가 오늘 10:05에 아직 신선(23h59m)해서 하루 묵은 사본을 쓰게 된다.
// 20h면 매일 10:05 실행마다 반드시 새로 받는다.
export const THEME_MASTER_CACHE_KEY = 'theme_master';
export const THEME_MASTER_CACHE_TTL_MS = 20 * 60 * 60 * 1000;

export interface ThemeEntry {
  code: string;
  name: string;
  tickers: string[];
}

export interface ThemeMaster {
  fetchedAt: string;
  themes: ThemeEntry[];
}

// 디코딩된 텍스트 → 테마 목록. 순수 함수(vitest 대상).
export function parseThemeMasterText(text: string): ThemeEntry[] {
  const themes = new Map<string, ThemeEntry>();
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length < 3 + 1 + 9) continue;
    const code = rawLine.slice(0, 3);
    const ticker = rawLine.slice(-9).trim();
    const name = rawLine.slice(3, -9).trim();
    if (!/^\d{3}$/.test(code) || !/^\d{6}$/.test(ticker) || !name) continue;
    const entry = themes.get(code) ?? { code, name, tickers: [] };
    if (!entry.tickers.includes(ticker)) entry.tickers.push(ticker);
    themes.set(code, entry);
  }
  return [...themes.values()];
}

export async function downloadThemeMaster(): Promise<ThemeMaster> {
  const res = await fetch(THEME_MASTER_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`테마 마스터 다운로드 실패 [${res.status}]`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.mst')) ?? zip.getEntries()[0];
  if (!entry) throw new Error('테마 마스터 zip에 항목이 없음');
  const themes = parseThemeMasterText(iconv.decode(entry.getData(), 'cp949'));
  if (themes.length < 100) throw new Error(`테마 마스터 파싱 결과가 비정상(${themes.length}개 테마)`);
  return { fetchedAt: new Date().toISOString(), themes };
}

export async function fetchThemeMasterCached(): Promise<{ master: ThemeMaster; isCached: boolean }> {
  const { data, isCached } = await cacheJsonResult<ThemeMaster>(THEME_MASTER_CACHE_KEY, THEME_MASTER_CACHE_TTL_MS, downloadThemeMaster, { lockTtlMs: 20_000 });
  return { master: data, isCached };
}

// 종목코드 → 소속 섹터 그룹 id 목록. 한 종목이 여러 그룹에 속할 수 있다(lib/sector-groups.ts 주석).
export function buildTickerSectorIndex(master: ThemeMaster, groups: SectorGroup[] = SECTOR_GROUPS): Map<string, string[]> {
  const themeByCode = new Map(master.themes.map((t) => [t.code, t]));
  const index = new Map<string, string[]>();
  for (const g of groups) {
    for (const code of g.themeCodes) {
      const theme = themeByCode.get(code);
      if (!theme) continue;
      for (const ticker of theme.tickers) {
        const list = index.get(ticker) ?? [];
        if (!list.includes(g.id)) list.push(g.id);
        index.set(ticker, list);
      }
    }
  }
  return index;
}

// 종목코드 → 대표 섹터 id 1개(lib/sector-groups.ts resolvePrimarySector 규칙). 오버라이드 맵의 종목은
// 마스터에 소속 테마가 없어도 포함된다. aggregateSectorFlows가 쓰는 형태(Map<ticker, ids[]>)와 맞추기
// 위해 값은 길이 1 배열.
export function buildTickerPrimarySectorIndex(master: ThemeMaster, groups: SectorGroup[] = SECTOR_GROUPS): Map<string, string[]> {
  const multi = buildTickerSectorIndex(master, groups);
  const primary = new Map<string, string[]>();
  for (const [ticker, ids] of multi) {
    const id = resolvePrimarySector(ticker, ids, groups);
    if (id) primary.set(ticker, [id]);
  }
  for (const ticker of Object.keys(MEGA_CAP_SECTOR_OVERRIDE)) {
    if (!primary.has(ticker)) {
      const id = resolvePrimarySector(ticker, [], groups);
      if (id) primary.set(ticker, [id]);
    }
  }
  return primary;
}

// 그룹 정의가 마스터에 없는 테마코드를 가리키면(KIS가 코드를 폐기한 경우) 로그로 알린다.
export function findMissingThemeCodes(master: ThemeMaster, groups: SectorGroup[] = SECTOR_GROUPS): string[] {
  const codes = new Set(master.themes.map((t) => t.code));
  return groups.flatMap((g) => g.themeCodes.filter((c) => !codes.has(c)));
}
