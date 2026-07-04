import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NotificationsResponse } from '@/lib/types';
import type { Database } from '@/lib/database.types';

export const dynamic = 'force-dynamic';

function makeSupabase() {
  const cookieStore = cookies();
  return createServerClient<Database>(
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
    .select('plan')
    .eq('id', user.id)
    .maybeSingle();

  const isPro = userData?.plan === 'pro';
  if (!isPro) {
    return NextResponse.json({ notifications: [], unreadCount: 0, isPro: false });
  }

  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    // created_at 동률(같은 크론 배치에서 여러 threshold가 동시에 upsert된 경우) 시
    // threshold가 큰(더 심한 조건) 알림이 먼저 오도록 2차 정렬
    .order('threshold', { ascending: false })
    .limit(50);

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
