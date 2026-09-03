import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';

export const dynamic = 'force-dynamic';

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

// ── DELETE: 저장 취소 — :id는 saved_reports.id ──────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('saved_reports')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id); // RLS가 이미 보장하지만 명시적으로도 남긴다

  if (error) {
    console.error('[SAVED-REPORTS] 삭제 실패:', error.message);
    return NextResponse.json({ error: '저장 취소 중 오류가 발생했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ── GET: 저장된 리포트 원본 조회 — :id는 stock_diagnosis/portfolio_diagnosis의 id
// (saved_reports.id가 아니라 source_id) — ?type=stock|portfolio로 어느 테이블인지 지정.
// 인증만 확인하고 checkPlan/deductCredit/Claude 호출이 전혀 없는 순수 읽기 전용이라,
// 이 경로로 들어오면 사용횟수(월간/일간 카운트)가 애초에 증가하지 않는다 — "예외 처리"가
// 아니라 카운팅 로직 자체가 없는 별도 경로로 보내는 설계(2026-09-03 설계 확정).
// 저장 여부와 무관하게 본인이 만든 리포트라면 이 id로 언제든 다시 볼 수 있다 —
// saved_reports는 "저장내역 패널에 오늘 뜨는지"만 결정할 뿐, 원본 열람 권한은 항상
// stock_diagnosis/portfolio_diagnosis의 RLS(본인만 조회)가 그대로 보장한다.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reportType = req.nextUrl.searchParams.get('type');
  if (reportType !== 'stock' && reportType !== 'portfolio') {
    return NextResponse.json({ error: 'type 쿼리 파라미터는 stock 또는 portfolio여야 합니다.' }, { status: 400 });
  }

  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 이 소스가 지금도 저장돼있는지(그리고 그 saved_reports.id) — 프론트가 저장 버튼을
  // "저장됨" 상태로 정확히 표시하고, 취소 시 어느 saved_reports 행을 지울지 알아야 한다.
  // savedId로 진입했다고 항상 "지금도 저장 상태"라고 가정할 수 없다(자정 지나 만료됐거나
  // 저장 취소 후 북마크/히스토리로 재방문한 경우가 있을 수 있음) — 매번 다시 조회한다.
  const savedRowPromise = supabase
    .from('saved_reports')
    .select('id')
    .eq('user_id', user.id)
    .eq('report_type', reportType)
    .eq('source_id', id)
    .maybeSingle();

  if (reportType === 'stock') {
    const [{ data, error }, { data: savedRow }] = await Promise.all([
      supabase
        .from('stock_diagnosis')
        .select('id, ticker, name, avg_price, quantity, buy_date, report_date, result')
        .eq('id', id)
        .maybeSingle(),
      savedRowPromise,
    ]);
    if (error) {
      console.error('[SAVED-REPORTS] 기업분석 원본 조회 실패:', error.message);
      return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: '리포트를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({
      id:            data.id,
      ticker:        data.ticker,
      name:          data.name,
      avgPrice:      data.avg_price,
      quantity:      data.quantity,
      buyDate:       data.buy_date,
      reportDate:    data.report_date,
      result:        data.result,
      savedReportId: savedRow?.id ?? null,
    });
  }

  const [{ data, error }, { data: savedRow }] = await Promise.all([
    supabase
      .from('portfolio_diagnosis')
      .select('id, report_date, result')
      .eq('id', id)
      .maybeSingle(),
    savedRowPromise,
  ]);
  if (error) {
    console.error('[SAVED-REPORTS] 포트폴리오분석 원본 조회 실패:', error.message);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: '리포트를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({
    id:            data.id,
    reportDate:    data.report_date,
    result:        data.result,
    savedReportId: savedRow?.id ?? null,
  });
}
