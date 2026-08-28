// lib/preferred-stock-master.ts를 채우는 데 쓴 일회성 생성 스크립트 — 새 우선주가
// 상장되거나 목록을 다시 검증하고 싶을 때 재실행한다.
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
// 용도로는 정확하다.
//
// 방법: 한국 우선주 코드 관례(보통주 코드의 마지막 자리를 5=1차 우선주, 7=2차
// 우선주(주로 "2우B")로 바꾼 코드)를 이용해, stock_master에 이미 있는 KOSPI 보통주
// (코드가 '0'으로 끝나는 종목) 각각에 대해 두 후보 티커를 만들고 KIS로 검증한다.
// 이름에 "우"가 포함되면 우선주로 확정한다.
//
// 실행: npx tsx --env-file=.env.local scripts/generate-preferred-stock-list.ts
// 결과를 콘솔에 TypeScript 배열 리터럴로 출력하니, lib/preferred-stock-master.ts의
// KOSPI_PREFERRED_RAW 배열을 통째로 교체하면 된다(수동 검토 후 반영 — 자동 배포 아님).
//
// 한계: 접미사 5/7만 검사한다 — 드물게 3차 우선주(접미사 9 등)나 알파벳 접미사
// (예: CJ4우(전환) 00104K)를 쓰는 종목은 이 스크립트로 못 잡는다. 그런 경우를
// 발견하면 lib/preferred-stock-master.ts에 수동으로 추가할 것.
import { createClient } from '@supabase/supabase-js';
import { fetchNameFromKisSearch } from '../lib/kis-api';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data, error } = await supabase
    .from('stock_master')
    .select('ticker, name')
    .eq('market', 'KOSPI')
    .like('ticker', '%0');
  if (error) throw error;
  console.log(`KOSPI 보통주(코드 '0'로 끝남) 후보 모수: ${data!.length}개`);

  const found: { ticker: string; name: string }[] = [];
  const suffixes = ['5', '7'];
  let checked = 0;

  for (const row of data!) {
    const base = row.ticker.slice(0, 5);
    for (const suf of suffixes) {
      const candidate = base + suf;
      checked++;
      const name = await fetchNameFromKisSearch(candidate);
      if (name && name.includes('우')) {
        found.push({ ticker: candidate, name });
        console.log(`  확인: ${candidate} = ${name} (← ${row.ticker} ${row.name})`);
      }
      if (checked % 200 === 0) console.log(`... ${checked}건 확인, ${found.length}건 발견`);
    }
  }

  found.sort((a, b) => a.ticker.localeCompare(b.ticker));
  console.log(`\n총 확인 ${checked}건, 우선주 확정 ${found.length}건`);
  console.log('\n// lib/preferred-stock-master.ts의 KOSPI_PREFERRED_RAW 배열 내용:');
  for (const f of found) {
    console.log(`  { ticker: '${f.ticker}', name: '${f.name}' },`);
  }
}

main();
