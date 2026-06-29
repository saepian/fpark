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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ id: row.id });
  } catch {
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
