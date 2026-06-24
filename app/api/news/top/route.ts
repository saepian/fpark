import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(11);

  if (error) {
    console.error('[NEWS/TOP API] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const [hero = null, ...top] = data ?? [];
  return NextResponse.json({ hero, top });
}
