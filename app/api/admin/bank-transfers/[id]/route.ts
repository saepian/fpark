// 관리자용 — 계좌이체(무통장입금) 신청 승인/거절/재활성화
// action='approve': 대기중(pending) 신청 승인 — request_type이 'new'면 최초 구독 시작,
//   'renewal'이면 기존 next_billed_at을 기준으로 다음 주기 연장(구독 시작일은 불변).
// action='reject': 대기중 신청 거절 — 유저 구독 상태는 건드리지 않음(만료는 별도 크론이 처리).
// action='reactivate': 만료(expired)된 신청을 관리자가 뒤늦게 되살릴 때 — 오늘부터 새 주기.
//
// 주의: 크레딧 시스템(stock_credits/portfolio_credits, lib/credits.ts)과는 완전히 별개 —
// 이 라우트는 credits 컬럼을 전혀 건드리지 않는다.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-auth';
import { approveBankTransferRequest } from '@/lib/bank-transfer-approval';
import type { Database } from '@/lib/database.types';

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.then(s => s.getAll()),
        setAll: (pairs) => cookieStore.then(s => {
          pairs.forEach(({ name, value, options }) => s.set(name, value, options));
        }),
      },
    },
  );
}

type Action = 'approve' | 'reject' | 'reactivate';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { action } = await request.json() as { action?: Action };
  if (action !== 'approve' && action !== 'reject' && action !== 'reactivate') {
    return NextResponse.json({ error: '잘못된 action' }, { status: 400 });
  }

  if (action === 'reject') {
    const { data: reqRow, error: fetchError } = await adminClient
      .from('bank_transfer_requests')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !reqRow) {
      return NextResponse.json({ error: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (reqRow.status !== 'pending') {
      return NextResponse.json({ error: `이미 처리된 신청입니다 (상태: ${reqRow.status})` }, { status: 409 });
    }

    const { error } = await adminClient
      .from('bank_transfer_requests')
      .update({ status: 'rejected', processed_at: new Date().toISOString(), processed_by: user.email })
      .eq('id', id);
    if (error) {
      console.error('[admin/bank-transfers] 거절 처리 실패:', error);
      return NextResponse.json({ error: '처리 실패' }, { status: 500 });
    }
    console.log(`[admin/bank-transfers] 거절 — requestId:${id} by:${user.email}`);
    return NextResponse.json({ ok: true, status: 'rejected' });
  }

  // ── 승인 / 재활성화 — 자동 매칭 크론과 동일한 승인 로직을 공유(lib/bank-transfer-approval.ts) ──
  const result = await approveBankTransferRequest(id, action, user.email!);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json({ ok: true, status: 'approved' });
}
