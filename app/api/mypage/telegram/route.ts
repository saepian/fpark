import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-admin';
import { getBotUsername, LINK_TOKEN_TTL_MS } from '@/lib/telegram';
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

// 연동 시작 — 유저별 1회용 짧은 토큰을 발급하고, t.me 딥링크를 돌려준다. 프론트가 이
// 링크로 새 탭을 열면 텔레그램 앱에서 봇과의 대화가 "/start {token}"으로 자동 시작되고,
// app/api/webhooks/telegram이 그 payload로 이 유저를 특정해 연동을 완료한다.
export async function POST() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const username = await getBotUsername();
  if (!username) {
    return NextResponse.json({ error: '텔레그램 봇 정보를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString();

  const { error } = await adminClient
    .from('telegram_link_tokens')
    .insert({ token, user_id: user.id, expires_at: expiresAt });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deepLink: `https://t.me/${username}?start=${token}` });
}

// 연동 해제 — telegram_chat_id를 지운다. 기존에 발급된(아직 쓰이지 않은) 연동 토큰은
// 그냥 TTL대로 만료되게 둔다(별도 정리 불필요 — 어차피 재연동 시 새 토큰을 또 발급함).
export async function DELETE() {
  const supabase = makeSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await adminClient
    .from('users')
    .update({ telegram_chat_id: null, telegram_linked_at: null })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
