import { NextResponse } from 'next/server';
import { getDailyPickSupabase } from '@/lib/daily-pick';
import { fetchStockPrice } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// 종목 선정 자체는 app/api/cron/daily-pick(매일 스케줄)이 전담한다.
// 여기서는 저장된 결과를 읽기만 함 — KIS 스캔·Claude 호출 같은 무거운 생성 작업을
// 사용자 요청 경로에서 동기 실행하면 504로 이어지므로 절대 다시 붙이지 말 것.
export async function GET() {
  const supabase = getDailyPickSupabase();
  const today = new Date().toISOString().split('T')[0];

  // 오늘 선정 종목 조회
  const { data, error } = await supabase
    .from('daily_picks')
    .select('*')
    .eq('date', today)
    .maybeSingle();

  if (error) {
    // 테이블이 없는 경우 graceful하게 처리 (PGRST205 = table not found)
    if (error.code === 'PGRST205' || error.message?.includes('daily_picks')) {
      console.warn('[DAILY-PICK] daily_picks 테이블 없음. Supabase SQL Editor에서 테이블을 생성해주세요.');
      return NextResponse.json(null);
    }
    console.error('[DAILY-PICK] DB 조회 오류:', error);
    return NextResponse.json(null);
  }

  let pick = data;

  // 오늘자가 아직 없으면(크론 실행 전, 또는 그날 조건 충족 종목이 없어 row 자체가
  // 안 만들어진 경우) 가장 최근에 성공한 row로 대체 — 프론트가 날짜로 구분해 표시
  if (!pick) {
    const { data: latest } = await supabase
      .from('daily_picks')
      .select('*')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    pick = latest;
  }

  if (!pick) return NextResponse.json(null);

  // 현재가 실시간 업데이트
  try {
    const price = await fetchStockPrice(pick.ticker);
    return NextResponse.json({
      ...pick,
      currentPrice: price.price,
      currentChangeRate: price.changeRate,
    });
  } catch {
    return NextResponse.json({
      ...pick,
      currentPrice: pick.price_at_pick,
      currentChangeRate: 0,
    });
  }
}
