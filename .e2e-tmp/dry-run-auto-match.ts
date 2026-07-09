/**
 * bank-transfer-auto-match dry-run 진단 스크립트 — 대기중 신청, CODEF 입금내역,
 * 매칭 판정 결과를 나란히 출력한다. 실제 크론 라우트(app/api/cron/bank-transfer-auto-match)와
 * 동일한 lib 함수(matchPendingPayments, getCodefAccountList/getCodefTransactionHistory)를
 * 그대로 재사용하므로 라우트가 실제로 계산할 결과와 동일하다. 승인/DB 쓰기는 하지 않음(조회만).
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY + ALLOW_PROD_ADMIN_CLIENT_IN_DEV=true 설정 후
 *   npx tsx .e2e-tmp/dry-run-auto-match.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const [key, ...vals] = line.split('=');
  if (key?.trim() && vals.length) process.env[key.trim()] = vals.join('=').trim();
});

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function main() {
  const { adminClient } = await import('../lib/supabase-admin');
  const { getCodefAccountList, getCodefTransactionHistory } = await import('../lib/codef-api');
  const { matchPendingPayments } = await import('../lib/codef-payment-matching');

  const { data: pendingRows, error: pendingError } = await adminClient
    .from('bank_transfer_requests')
    .select('id, user_id, plan, amount, depositor_name, status, requested_at')
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  if (pendingError) throw pendingError;

  console.log('=== 대기중(pending) 결제 신청 ===');
  console.log(JSON.stringify(pendingRows, null, 2));

  if (!pendingRows || pendingRows.length === 0) {
    console.log('\n대기중 신청이 없습니다 — 여기서 종료.');
    return;
  }

  const { data: connectedAccount, error: caError } = await adminClient
    .from('codef_connected_accounts')
    .select('connected_id, bank_name')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (caError || !connectedAccount) throw caError ?? new Error('연결된 CODEF 계좌 없음');

  const accountList = await getCodefAccountList(connectedAccount.connected_id);
  const account = accountList[0]?.resAccount;
  if (!account) throw new Error('CODEF 계좌 목록에서 계좌번호를 찾을 수 없음');

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 86_400_000);
  const transactions = await getCodefTransactionHistory({
    connectedId: connectedAccount.connected_id,
    account,
    startDate:   yyyymmdd(startDate),
    endDate:     yyyymmdd(endDate),
  });

  const deposits = transactions.filter((t) => Number(t.resAccountIn) > 0);
  console.log('\n=== 최근 7일 CODEF 입금내역 ===');
  console.log(JSON.stringify(deposits, null, 2));

  const requests = pendingRows.map((r) => ({
    id:            r.id,
    amount:        r.amount,
    depositorName: r.depositor_name,
    requestedAt:   r.requested_at,
  }));

  const decisions = matchPendingPayments(requests, transactions);

  console.log('\n=== 매칭 판정 결과 (requestId별) ===');
  for (const d of decisions) {
    const req = pendingRows.find((r) => r.id === d.requestId)!;
    console.log(`\n[신청 ${d.requestId}]`);
    console.log('  신청 금액:', req.amount, '/ 신청자 등록명(depositor_name):', JSON.stringify(req.depositor_name), '/ 신청 시각:', req.requested_at);
    console.log('  판정:', d.decision);
    console.log('  사유:', d.reason);
    if (d.decision === 'manual_review') {
      console.log('  조건 충족 후보 건수:', d.candidateCount);
    } else {
      console.log('  매칭된 입금 키:', d.depositKey);
    }
  }

  console.log('\n=== 신청 vs 입금 비교 테이블 (금액+적요 정확 일치 기준) ===');
  console.table(
    pendingRows.map((r) => {
      const matched = deposits.find(
        (dep) =>
          Number(dep.resAccountIn) === r.amount &&
          dep.resAccountDesc3.trim().toLowerCase() === r.depositor_name.trim().toLowerCase(),
      );
      return {
        requestId:     r.id,
        신청금액:      r.amount,
        신청자등록명:  r.depositor_name,
        조회된입금액:  matched?.resAccountIn ?? '(없음)',
        적요텍스트:    matched ? JSON.stringify(matched.resAccountDesc3) : '(없음)',
        일치여부:      matched ? 'O' : 'X',
      };
    }),
  );
}

main().catch((e) => {
  console.error('\n실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
