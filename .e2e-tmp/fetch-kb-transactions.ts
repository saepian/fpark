/**
 * 등록된 KB국민은행 기업계좌(connectedId)로 최근 입출금 내역을 조회.
 *
 * 기본은 항상 DRY RUN(조회 설정만 출력, 네트워크/DB 접근 없음).
 * 실제 조회는 --live 플래그와 KB_FETCH_CONFIRM=YES 환경변수가 "둘 다" 있어야 실행된다.
 * register-kb-account.ts와 동일한 이중 게이트 — 거래내역 조회도 CODEF 토큰 캐시
 * 조회/저장 때문에 내부적으로 프로덕션 Supabase(service-role)에 접근하므로 동일 수준의
 * 안전장치를 둔다(.env.local에 확인 플래그가 남아 있어도 --live 없이는 실행되지 않음).
 *
 * 실행:
 *   DRY RUN:   npx tsx .e2e-tmp/fetch-kb-transactions.ts
 *   실제 조회: KB_FETCH_CONFIRM=YES npx tsx .e2e-tmp/fetch-kb-transactions.ts --live
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// .env.local 로드 (tsx는 dotenv 자동 로드 안 함) — register-kb-account.ts와 동일 패턴
const envPath = resolve(process.cwd(), '.env.local');
readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const [key, ...vals] = line.split('=');
  if (key?.trim() && vals.length) process.env[key.trim()] = vals.join('=').trim();
});

const isLive = process.argv.includes('--live');

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function main() {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 30 * 86_400_000);
  const startStr = yyyymmdd(startDate);
  const endStr = yyyymmdd(endDate);

  console.log('=== 조회 설정 ===');
  console.log('조회 기간:', startStr, '~', endStr, '(최근 30일)');

  if (!isLive) {
    console.log('\n=== DRY RUN 완료 — 네트워크/DB 호출 없음 ===');
    console.log('실제 조회를 실행하려면: KB_FETCH_CONFIRM=YES npx tsx .e2e-tmp/fetch-kb-transactions.ts --live');
    return;
  }

  if (process.env.KB_FETCH_CONFIRM !== 'YES') {
    throw new Error('[fetch-kb-transactions] --live 플래그는 있지만 KB_FETCH_CONFIRM=YES가 없습니다. 중단합니다.');
  }

  const { adminClient } = await import('../lib/supabase-admin');
  const { data: accounts, error } = await adminClient
    .from('codef_connected_accounts')
    .select('connected_id, bank_name, business_registration_number')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!accounts || accounts.length === 0) {
    throw new Error('[fetch-kb-transactions] codef_connected_accounts에 등록된 계좌가 없습니다.');
  }
  const { connected_id: connectedId, bank_name: bankName } = accounts[0];
  console.log('\n=== DB에서 조회한 연결 계좌 ===');
  console.log('connectedId:', connectedId, '/ bank:', bankName);

  const { getCodefAccountList, getCodefTransactionHistory } = await import('../lib/codef-api');

  console.log('\n=== 계좌 목록 조회 (계좌번호 확인) ===');
  const accountList = await getCodefAccountList(connectedId);
  console.log(JSON.stringify(accountList, null, 2));

  const account = accountList[0]?.resAccount;
  if (!account) {
    throw new Error('[fetch-kb-transactions] 계좌 목록 조회 결과에서 계좌번호(resAccount)를 찾을 수 없습니다.');
  }

  console.log('\n=== 거래내역 조회 (최근 30일) ===');
  const transactions = await getCodefTransactionHistory({
    connectedId,
    account,
    startDate: startStr,
    endDate: endStr,
  });

  console.log(`총 ${transactions.length}건`);
  console.log(JSON.stringify(transactions, null, 2));

  // 특정 텍스트가 desc1~4 중 어디에 들어오는지 확인 (TX_SEARCH_TEXT로 재정의 가능).
  // resTrHistoryList 배열 요소는 JSON.parse 결과 그대로라 CodefTransaction 타입에 없는
  // 필드가 실제로 와도 여기서 다 잡힌다 — known 필드에 없으면 원본 응답까지 덤프해서 확인.
  const searchText = process.env.TX_SEARCH_TEXT || 'TEST0709';
  console.log(`\n=== "${searchText}" 텍스트 검색 ===`);
  let found = false;
  transactions.forEach((tx, i) => {
    for (const [field, value] of Object.entries(tx as Record<string, unknown>)) {
      if (typeof value === 'string' && value.includes(searchText)) {
        console.log(`거래 #${i} 필드 "${field}" 에서 발견: "${value}"`);
        found = true;
      }
    }
  });

  if (!found) {
    console.log('resTrHistoryList의 어떤 필드에서도 찾지 못함 — CODEF 원본 응답 전체를 재조회해 출력합니다.');
    const { getCodefAccessToken, CODEF_BASE, KB_ORGANIZATION_CODE } = await import('../lib/codef-api');
    const token = await getCodefAccessToken();
    const res = await fetch(`${CODEF_BASE}/v1/kr/bank/b/account/transaction-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Authorization:  `Bearer ${token}`,
      },
      body: JSON.stringify({
        connectedId,
        organization: KB_ORGANIZATION_CODE,
        account,
        startDate: startStr,
        endDate:   endStr,
        orderBy:     '0',
        inquiryType: '0',
      }),
      cache: 'no-store',
    });
    const rawText = await res.text();
    const decoded = decodeURIComponent(rawText.replace(/\+/g, ' '));
    console.log('\n=== CODEF 원본 응답 (percent-decode만 적용, 미가공) ===');
    console.log(decoded);
    console.log(`\n원본 응답에 "${searchText}" 포함 여부:`, decoded.includes(searchText));
  }
}

main().catch((e) => {
  console.error('\n실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
