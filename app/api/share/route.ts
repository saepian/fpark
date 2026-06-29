import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { type, data } = await req.json();
    if (!type || !data) return NextResponse.json({ error: 'invalid' }, { status: 400 });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: row, error } = await supabase
      .from('shared_reports')
      .insert({ type, data, expires_at: expiresAt })
      .select('id')
      .single();

    if (error) {
      console.error('[share] supabase error:', error.code, error.message, error.details);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }
    return NextResponse.json({ id: row.id });
  } catch (e) {
    console.error('[share] unexpected error:', e);
    return NextResponse.json({ error: 'server error', detail: String(e) }, { status: 500 });
  }
}
