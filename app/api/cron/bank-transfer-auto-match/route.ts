// 계좌이체 자동 매칭 — CODEF 입금내역과 대기중(pending) 신청을 금액+적요(이름) 조합으로
// 매칭해 유니크하게 확정되는 건만 자동 승인한다. 판정 로직 자체는 lib/codef-payment-matching.ts의
// matchPendingPayments()(순수 함수, vitest로 커버)이고 이 라우트는 데이터 연결만 담당한다.
// 승인 후속 처리(Pro 활성화 등)는 관리자 수동 승인과 동일하게 lib/bank-transfer-approval.ts를 공유.
//
// BANK_TRANSFER_AUTO_MATCH_DRY_RUN 기본값은 dry-run(true 취급) — 분류 결과만 응답/로그로
// 남기고 실제 승인은 실행하지 않는다. 결과를 검토한 뒤 Vercel 환경변수에
// BANK_TRANSFER_AUTO_MATCH_DRY_RUN=false를 명시적으로 설정해야 실제 자동 승인이 켜진다.

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { approveBankTransferRequest } from '@/lib/bank-transfer-approval';
import { getCodefAccountList, getCodefTransactionHistory } from '@/lib/codef-api';
import {
  matchPendingPayments,
  type PendingPaymentRequest,
  type CodefDeposit,
} from '@/lib/codef-payment-matching';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOOKBACK_DAYS = 7;

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/bank-transfer-auto-match] CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron/bank-transfer-auto-match] Unauthorized:', authHeader ? 'wrong token' : 'missing Authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = process.env.BANK_TRANSFER_AUTO_MATCH_DRY_RUN !== 'false';

  const { data: pendingRows, error: pendingError } = await adminClient
    .from('bank_transfer_requests')
    .select('id, amount, depositor_real_name, requested_at')
    .eq('status', 'pending');

  if (pendingError) {
    console.error('[cron/bank-transfer-auto-match] 대기 신청 조회 실패:', pendingError);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }

  const requests: PendingPaymentRequest[] = (pendingRows ?? []).map((r) => ({
    id:            r.id,
    amount:        r.amount,
    depositorName: r.depositor_real_name,
    requestedAt:   r.requested_at,
  }));

  if (requests.length === 0) {
    console.log('[cron/bank-transfer-auto-match] 대기중 신청 없음 — 종료');
    return NextResponse.json({ ok: true, dryRun, pendingCount: 0, decisions: [] });
  }

  const { data: connectedAccount, error: caError } = await adminClient
    .from('codef_connected_accounts')
    .select('connected_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (caError || !connectedAccount) {
    console.error('[cron/bank-transfer-auto-match] 연결된 CODEF 계좌 없음:', caError);
    return NextResponse.json({ error: '연결된 CODEF 계좌 없음' }, { status: 500 });
  }

  const accountList = await getCodefAccountList(connectedAccount.connected_id);
  const account = accountList[0]?.resAccount;
  if (!account) {
    console.error('[cron/bank-transfer-auto-match] CODEF 계좌 목록에서 계좌번호를 찾을 수 없음');
    return NextResponse.json({ error: 'CODEF 계좌 조회 실패' }, { status: 500 });
  }

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - LOOKBACK_DAYS * 86_400_000);
  const transactions = await getCodefTransactionHistory({
    connectedId: connectedAccount.connected_id,
    account,
    startDate:   yyyymmdd(startDate),
    endDate:     yyyymmdd(endDate),
  });

  const deposits: CodefDeposit[] = transactions.map((t) => ({
    resAccountTrDate: t.resAccountTrDate,
    resAccountTrTime: t.resAccountTrTime,
    resAccountIn:     t.resAccountIn,
    resAccountDesc3:  t.resAccountDesc3,
  }));

  const decisions = matchPendingPayments(requests, deposits);
  const autoApproveDecisions = decisions.filter((d) => d.decision === 'auto_approve');
  const manualDecisions = decisions.filter((d) => d.decision === 'manual_review');

  for (const d of decisions) {
    console.log(`[cron/bank-transfer-auto-match] ${d.decision} — requestId:${d.requestId} reason:${d.reason}`);
  }

  let approvedCount = 0;
  let approveFailedCount = 0;
  if (!dryRun) {
    for (const d of autoApproveDecisions) {
      const result = await approveBankTransferRequest(d.requestId, 'approve', 'auto-match-cron');
      if (result.ok) {
        approvedCount++;
        console.log(`[cron/bank-transfer-auto-match] 자동 승인 완료 — requestId:${d.requestId} depositKey:${d.depositKey}`);
      } else {
        approveFailedCount++;
        console.error(`[cron/bank-transfer-auto-match] 자동 승인 실패 — requestId:${d.requestId}:`, result.error);
      }
    }
  }

  console.log(
    `[cron/bank-transfer-auto-match] 완료 — dryRun:${dryRun} 대기:${requests.length} ` +
    `자동승인대상:${autoApproveDecisions.length} 수동검토:${manualDecisions.length} ` +
    `실제승인:${approvedCount} 승인실패:${approveFailedCount}`,
  );

  return NextResponse.json({
    ok: true,
    dryRun,
    pendingCount:      requests.length,
    autoApproveCount:  autoApproveDecisions.length,
    manualReviewCount: manualDecisions.length,
    approvedCount,
    approveFailedCount,
    decisions,
  });
}
