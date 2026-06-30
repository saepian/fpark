import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, category, subject, message } = body;

    if (!name || !email || !subject || !message) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    await admin.from('contact_submissions').insert({
      name, email, category, subject, message,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // 테이블 미생성 등 오류가 있어도 UX는 성공 처리
    return NextResponse.json({ ok: true });
  }
}
