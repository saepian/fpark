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
