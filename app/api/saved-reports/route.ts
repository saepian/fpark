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

type ReportType = 'stock' | 'portfolio';

// 오늘(KST) 00:00 절대시각 — app/api/cron/notifications-cleanup/route.ts와 동일 계산 방식
// (조회 시점 필터링이 "저장내역은 오늘 하루만" 요구사항의 1차 방어선, 크론 물리삭제는
// 위생관리용 2차 방어선 — 2026-09-03 설계 확정).
function todayKstCutoff(): string {
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0];
  return `${todayKst}T00:00:00+09:00`;
}

// ── POST: 저장 ──────────────────────────────────────────────────────────────
// unique(user_id, report_type, source_id) 위반(23505)은 "이미 저장돼있음"으로 보고
// idempotent하게 200을 반환한다 — 버튼을 두 번 눌러도 에러가 아니라 같은 결과.
export async function POST(request: NextRequest) {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { reportType, sourceId } = body as { reportType?: ReportType; sourceId?: string };
  if (reportType !== 'stock' && reportType !== 'portfolio') {
    return NextResponse.json({ error: 'reportType은 stock 또는 portfolio여야 합니다.' }, { status: 400 });
  }
  if (!sourceId || typeof sourceId !== 'string') {
    return NextResponse.json({ error: 'sourceId가 필요합니다.' }, { status: 400 });
  }

  // 소유권 확인 — saved_reports 자체의 RLS는 "이 행의 user_id가 나인가"만 보장하고
  // source_id가 실제로 내 stock_diagnosis/portfolio_diagnosis 행인지는 안 막아준다.
  // 원본 테이블도 RLS(본인만 조회)라 여기서 조회가 되면 이미 소유권이 확인된 것.
  const sourceTable = reportType === 'stock' ? 'stock_diagnosis' : 'portfolio_diagnosis';
  const { data: sourceRow, error: sourceError } = await supabase
    .from(sourceTable)
    .select('id')
    .eq('id', sourceId)
    .maybeSingle();
  if (sourceError) {
    console.error('[SAVED-REPORTS] 원본 조회 실패:', sourceError.message);
    return NextResponse.json({ error: '원본 리포트 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
  if (!sourceRow) {
    return NextResponse.json({ error: '저장하려는 리포트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('saved_reports')
    .insert({ user_id: user.id, report_type: reportType, source_id: sourceId })
    .select('id, saved_at')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      // 이미 저장돼있음 — 기존 행을 그대로 idempotent 응답으로 반환
      const { data: existing } = await supabase
        .from('saved_reports')
        .select('id, saved_at')
        .eq('user_id', user.id)
        .eq('report_type', reportType)
        .eq('source_id', sourceId)
        .maybeSingle();
      return NextResponse.json({ id: existing?.id, savedAt: existing?.saved_at, alreadySaved: true });
    }
    console.error('[SAVED-REPORTS] 저장 실패:', insertError.message);
    return NextResponse.json({ error: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ id: inserted.id, savedAt: inserted.saved_at, alreadySaved: false });
}

// ── GET: 오늘자 저장내역 목록(패널용) — 기업분석/포트폴리오분석 구분해서 반환 ──────
export async function GET() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: saved, error } = await supabase
    .from('saved_reports')
    .select('id, report_type, source_id, saved_at')
    .eq('user_id', user.id)
    .gte('saved_at', todayKstCutoff())
    .order('saved_at', { ascending: false });

  if (error) {
    console.error('[SAVED-REPORTS] 목록 조회 실패:', error.message);
    return NextResponse.json({ error: '목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }

  const stockSaved     = (saved ?? []).filter((r) => r.report_type === 'stock');
  const portfolioSaved = (saved ?? []).filter((r) => r.report_type === 'portfolio');

  const [stockRows, portfolioRows] = await Promise.all([
    stockSaved.length > 0
      ? supabase.from('stock_diagnosis').select('id, ticker, name, report_date').in('id', stockSaved.map((r) => r.source_id))
      : Promise.resolve({ data: [] as { id: string; ticker: string; name: string; report_date: string | null }[] }),
    portfolioSaved.length > 0
      ? supabase.from('portfolio_diagnosis').select('id, report_date, result').in('id', portfolioSaved.map((r) => r.source_id))
      : Promise.resolve({ data: [] as { id: string; report_date: string | null; result: unknown }[] }),
  ]);

  const stockById = new Map((stockRows.data ?? []).map((r) => [r.id, r]));
  const portfolioById = new Map((portfolioRows.data ?? []).map((r) => [r.id, r]));

  const stock = stockSaved
    .map((s) => {
      const src = stockById.get(s.source_id);
      if (!src) return null; // 원본이 삭제된 등 예외적 상황 — 목록에서 조용히 제외
      return {
        savedReportId: s.id,
        sourceId:      s.source_id,
        ticker:        src.ticker,
        name:          src.name,
        reportDate:    src.report_date,
        savedAt:       s.saved_at,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const portfolio = portfolioSaved
    .map((s) => {
      const src = portfolioById.get(s.source_id);
      if (!src) return null;
      const result = src.result as { holdings?: unknown[]; totalProfitRate?: number } | null;
      return {
        savedReportId:   s.id,
        sourceId:        s.source_id,
        reportDate:      src.report_date,
        holdingsCount:   result?.holdings?.length ?? null,
        totalProfitRate: result?.totalProfitRate ?? null,
        savedAt:         s.saved_at,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ stock, portfolio });
}
