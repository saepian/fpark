import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NotificationsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.then((s) => s.getAll()),
        setAll: (pairs) =>
          cookieStore.then((s) => {
            pairs.forEach(({ name, value, options }) => s.set(name, value, options));
          }),
      },
    },
  );
}

export async function GET(): Promise<NextResponse<NotificationsResponse>> {
  const supabase = makeSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ notifications: [], unreadCount: 0, isPro: false });
  }

  const { data: userData } = await supabase
    .from('users')
    .select('subscription_plan')
    .eq('id', user.id)
    .single();

  const isPro = userData?.subscription_plan === 'pro';
  if (!isPro) {
    return NextResponse.json({ notifications: [], unreadCount: 0, isPro: false });
  }

  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(20);

  const list = notifications ?? [];
  const unreadCount = list.filter((n: { is_read: boolean }) => !n.is_read).length;

  return NextResponse.json({ notifications: list, unreadCount, isPro: true });
}

export async function PATCH(request: NextRequest) {
  const supabase = makeSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, markAllRead } = await request.json();

  if (markAllRead) {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
  } else if (id) {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', user.id);
  }

  return NextResponse.json({ success: true });
}
