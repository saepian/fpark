import { NextResponse } from 'next/server';
import { generateAndSavePick, getDailyPickSupabase } from '@/lib/daily-pick';
import { fetchStockPrice } from '@/lib/kis-api';

export const dynamic = 'force-dynamic';

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

  // 오늘 데이터 없으면 즉시 생성
  if (!pick) {
    try {
      await generateAndSavePick();
      const { data: newData } = await supabase
        .from('daily_picks')
        .select('*')
        .eq('date', today)
        .maybeSingle();
      pick = newData;
    } catch (e) {
      console.error('[DAILY-PICK] 즉시 생성 실패:', e);
      return NextResponse.json(null);
    }
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
