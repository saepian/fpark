import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { Database } from '@/lib/database.types';
import { sanitizeRedirect } from '@/lib/auth-redirect';
import { resolvePostAuthRedirect } from '@/lib/post-auth-redirect';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as any;
  const next = sanitizeRedirect(searchParams.get('next'));

  if (token_hash && type) {
    const cookieStore = await cookies();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      const userId = data.user?.id;
      const finalNext = userId
        ? await resolvePostAuthRedirect(userId, next, {
            email: data.user?.email,
            name: (data.user?.user_metadata?.name as string | undefined) ?? null,
          })
        : next;
      return NextResponse.redirect(`https://fpark.com${finalNext}`);
    }
  }

  return NextResponse.redirect('https://fpark.com/?error=auth_failed');
}
