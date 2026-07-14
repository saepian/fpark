import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { isAdminEmail } from '@/lib/admin-auth';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';
import type { Database } from '@/lib/database.types';
import AdminTabs from './AdminTabs';

// 서버 사이드 접근 제어 — 이전에는 이 레이아웃이 'use client'라 인증/권한 체크가
// 전혀 없었고, 각 페이지가 클라이언트에서 /api/admin/* 를 호출한 뒤 401을 받아야만
// 리다이렉트했다. API는 이미 isAdminEmail로 막혀 있어 데이터 유출은 없었지만, 페이지
// 자체는 비로그인/비관리자에게도 그대로 200으로 로드됐다(2026-07-15 보안 점검 발견).
// 서버 컴포넌트 최상단에서 먼저 막아 페이지 진입 자체를 차단한다.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {}, // 서버 컴포넌트는 쿠키를 쓸 수 없음(읽기 전용 세션 확인만 필요)
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect(loginUrlWithRedirect('/admin/users'));
  if (!isAdminEmail(user.email)) redirect('/');

  return (
    <div className="min-h-screen bg-[#0a0c12]">
      <AdminTabs />
      {children}
    </div>
  );
}
