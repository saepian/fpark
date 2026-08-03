import { adminClient } from '@/lib/supabase-admin';

// auth.admin.listUsers()는 실패해도 throw하지 않고 { data, error } 형태로 조용히 돌아온다.
// error를 체크하지 않으면 일시적 API 장애가 "유저 없음"으로 오인되어 크론이 200 OK로
// 조용히 스킵되는 사고로 이어진다 (2026-07-23 morning-briefing 발송 스킵 사고 원인).
// 페이지당 1회 재시도 후에도 실패하면 error 레벨 로그를 남기고 예외를 던진다.
export async function listAllAuthUserEmails(logPrefix: string): Promise<Map<string, string>> {
  const emailMap = new Map<string, string>();
  let page = 1;
  while (true) {
    let { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error(`${logPrefix} listUsers 실패 (page ${page}) — 1회 재시도:`, error.message);
      ({ data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 }));
    }
    if (error) {
      console.error(`${logPrefix} listUsers 최종 실패 (page ${page}, 재시도 포함) — 발송 중단:`, error.message);
      throw new Error(`listUsers failed: ${error.message}`);
    }
    const pageUsers = data?.users ?? [];
    for (const u of pageUsers) emailMap.set(u.id, u.email ?? '');
    if (pageUsers.length < 1000) break;
    page++;
  }
  return emailMap;
}

export interface AuthUserSummary {
  email:        string;
  lastSignInAt: string | null;
}

// listAllAuthUserEmails와 동일한 페이지네이션+재시도 패턴이지만 email 대신 last_sign_in_at도
// 함께 반환한다 — app/api/admin/users/route.ts가 { page: 1, perPage: 1000 } 단발 호출만
// 쓰던 탓에 회원이 1000명을 넘으면 조용히 잘리던 문제를 고치기 위해 추가(2026-08-03).
export async function listAllAuthUsers(logPrefix: string): Promise<Map<string, AuthUserSummary>> {
  const userMap = new Map<string, AuthUserSummary>();
  let page = 1;
  while (true) {
    let { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error(`${logPrefix} listUsers 실패 (page ${page}) — 1회 재시도:`, error.message);
      ({ data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 }));
    }
    if (error) {
      console.error(`${logPrefix} listUsers 최종 실패 (page ${page}, 재시도 포함) — 조회 중단:`, error.message);
      throw new Error(`listUsers failed: ${error.message}`);
    }
    const pageUsers = data?.users ?? [];
    for (const u of pageUsers) userMap.set(u.id, { email: u.email ?? '', lastSignInAt: u.last_sign_in_at ?? null });
    if (pageUsers.length < 1000) break;
    page++;
  }
  return userMap;
}
