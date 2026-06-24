import { NextResponse } from 'next/server';
import { batchSummarize } from '@/lib/summarize';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const articles = [
      { title: '삼성전자 3분기 영업이익 10조 돌파', content: '삼성전자가 3분기 반도체 수요 회복에 힘입어 영업이익 10조원을 기록했다.' },
      { title: '한국은행 기준금리 동결', content: '한국은행 금융통화위원회가 기준금리를 3.5%로 동결했다.' },
    ];

    const summaries = await batchSummarize(articles);

    return NextResponse.json({
      success: true,
      model: 'claude-haiku-4-5-20251001',
      results: articles.map((a, i) => ({ title: a.title, summary: summaries[i] })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[TEST-CLAUDE] 에러:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
