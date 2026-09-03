// lib/preferred-stock-master.ts를 채우는 데 쓴 생성 스크립트 — 새 우선주가 상장되거나
// 목록을 다시 검증하고 싶을 때 재실행한다.
//
// 배경: /api/search가 005935(삼성전자우) 같은 우선주를 못 찾던 문제(2026-08-28)의
// 원인은 stock_master를 채우는 두 데이터소스(공공데이터포털 GetKrxListedInfoService,
// KRX kind.krx.co.kr corpList.do 스크래핑)가 전부 "상장법인목록"(법인 단위 1행)이라
// 우선주(증권 단위로 별도 상장)를 원천적으로 안 내려주기 때문이었다.
//
// 새 공공데이터포털 서비스를 등록하는 대신(서비스키가 서비스별 개별 등록이라 즉시 불가),
// 이미 보유한 KIS API의 search-stock-info(CTPF1604R, lib/kis-api.ts의
// fetchNameFromKisSearch)로 해결한다 — 이 엔드포인트는 "정확한 티커 하나 → 공식명"을
// 돌려주는 단건 조회라 전체 목록을 나열할 순 없지만, 후보 티커가 실존하는지 검증하는
// 용도로는 정확하다(모든 확정은 반드시 이 함수를 거친다).
//
// 2026-09-03 확장: 8/28엔 접미사 5/7(1·2차 우선주)만, KOSPI만 스캔했다 — 그 한계로
// 3차 우선주(접미사 9)·KOSDAQ 우선주·알파벳 접미사(예: CJ4우(전환) 00104K) 종목을
// 놓치고 있었다. 두 방식을 병행한다:
//
//   1단계(체계적 생성): stock_master의 KOSPI+KOSDAQ 보통주(코드 '0'로 끝남) 각각에
//   접미사 5/7/9를 붙여 KIS로 검증 — 8/28과 같은 방식에 접미사 9와 KOSDAQ을 추가한 것.
//   숫자 접미사만 잡을 수 있다는 한계는 그대로.
//
//   2단계(다른 데이터소스 대조 — 알파벳 접미사 보완): 공공데이터포털/KRX corpList.do는
//   증권 단위 목록이 아예 없고, KRX data.krx.co.kr의 MDC 마켓데이터 API(정식 목록 API)는
//   OTP+세션 발급 절차가 있는 Akamai 보호 뒤에 있어 스크래핑이 막힘을 실측 확인(2026-09-03,
//   generateOTP.cmd 500에러/fileServlet 403). 대신 finance.naver.com의 시가총액순
//   목록(sise_market_sum.naver?sosok=0|1)이 코스피·코스닥 전 종목(우선주·ETF·ETN 포함,
//   페이지당 50건, KOSPI 55페이지·KOSDAQ 45페이지 정도)을 공개 HTML로 제공하는 걸 확인—
//   이름에 "우"가 (맨 앞이 아니게) 들어가고 코드가 "0"으로 안 끝나는 행을 후보로 추린 뒤
//   ETN/ETF류 오탐(예: 이름에 "다우존스"가 있어 "우"를 포함하지만 무관한 ETN)을
//   키워드로 제외한다. 이 1차 필터는 노이즈가 섞여도 되는 후보 생성용일 뿐 — 최종
//   확정은 반드시 1단계와 동일하게 fetchNameFromKisSearch로 한다.
//
// 실행: npx tsx --env-file=.env.local scripts/generate-preferred-stock-list.ts
// 결과를 콘솔에 TypeScript 배열 리터럴로 출력하니, lib/preferred-stock-master.ts의
// KOSPI_PREFERRED_RAW/KOSDAQ_PREFERRED_RAW 배열에 수동 검토 후 반영한다(자동 배포 아님).
import { createClient } from '@supabase/supabase-js';
import { fetchNameFromKisSearch } from '../lib/kis-api';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type Found = { ticker: string; name: string; market: 'KOSPI' | 'KOSDAQ' };

// ── 1단계: 체계적 접미사 생성(5/7/9) — KOSPI+KOSDAQ 보통주 기준 ──────────────────
async function scanBySuffix(): Promise<Found[]> {
  const found: Found[] = [];
  const suffixes = ['5', '7', '9'];
  for (const market of ['KOSPI', 'KOSDAQ'] as const) {
    const { data, error } = await supabase
      .from('stock_master')
      .select('ticker, name')
      .eq('market', market)
      .like('ticker', '%0');
    if (error) throw error;
    console.log(`[1단계] ${market} 보통주(코드 '0'로 끝남) 후보 모수: ${data!.length}개`);

    let checked = 0;
    for (const row of data!) {
      const base = row.ticker.slice(0, 5);
      for (const suf of suffixes) {
        const candidate = base + suf;
        checked++;
        const name = await fetchNameFromKisSearch(candidate);
        if (name && name.includes('우')) {
          found.push({ ticker: candidate, name, market });
          console.log(`  확인: ${candidate} = ${name} (← ${row.ticker} ${row.name}, ${market})`);
        }
        if (checked % 300 === 0) console.log(`  ... ${market} ${checked}건 확인`);
      }
    }
  }
  return found;
}

// ── 2단계: Naver 시가총액순 목록 스크래핑 — 알파벳 접미사 등 숫자 규칙으로 못 잡는 케이스 ──
async function fetchNaverPage(sosok: 0 | 1, page: number): Promise<{ code: string; name: string }[]> {
  const res = await fetch(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const html = new TextDecoder('euc-kr').decode(buf);
  const re = /\/item\/main\.naver\?code=([0-9A-Za-z]+)"[^>]*>([^<]+)</g;
  const rows: { code: string; name: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) rows.push({ code: m[1], name: m[2].trim() });
  return rows;
}

function looksLikePreferred(code: string, name: string): boolean {
  if (!/^[0-9]{5}[0-9A-Za-z]$/.test(code) || code.endsWith('0')) return false;
  if (/ETN|ETF|선물|인버스|레버리지|합성|\bTR\b/.test(name)) return false;
  return /우(?:$|[A-Z0-9(])/.test(name);
}

async function scanByNaverCrossCheck(alreadyFound: Set<string>): Promise<Found[]> {
  const results: Found[] = [];
  for (const [sosok, market, maxPages] of [[0, 'KOSPI', 55], [1, 'KOSDAQ', 45]] as const) {
    const all: { code: string; name: string }[] = [];
    for (let p = 1; p <= maxPages; p++) {
      const rows = await fetchNaverPage(sosok, p);
      if (rows.length === 0) break;
      all.push(...rows);
      await new Promise((r) => setTimeout(r, 150));
    }
    console.log(`[2단계] ${market} Naver 전종목 ${all.length}건 수집`);
    const candidates = all.filter((r) => looksLikePreferred(r.code, r.name) && !alreadyFound.has(r.code));
    console.log(`[2단계] ${market} 우선주 후보(1단계에서 못 찾은 것만): ${candidates.length}건`);

    for (const c of candidates) {
      const kisName = await fetchNameFromKisSearch(c.code);
      if (kisName && kisName.includes('우')) {
        results.push({ ticker: c.code, name: kisName, market });
        console.log(`  확인: ${c.code} = ${kisName} (Naver: ${c.name}, ${market})`);
      }
    }
  }
  return results;
}

async function main() {
  const stepwise = await scanBySuffix();
  const stepwiseTickers = new Set(stepwise.map((f) => f.ticker));
  const crossChecked = await scanByNaverCrossCheck(stepwiseTickers);

  const all = [...stepwise, ...crossChecked].sort((a, b) => a.ticker.localeCompare(b.ticker));
  console.log(`\n총 확정 ${all.length}건 (1단계 ${stepwise.length}건 + 2단계 추가 ${crossChecked.length}건)`);

  for (const market of ['KOSPI', 'KOSDAQ'] as const) {
    console.log(`\n// lib/preferred-stock-master.ts의 ${market}_PREFERRED_RAW 배열 내용:`);
    for (const f of all.filter((x) => x.market === market)) {
      console.log(`  { ticker: '${f.ticker}', name: '${f.name}' },`);
    }
  }
}

main();
