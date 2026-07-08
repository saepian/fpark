import { adminClient } from '@/lib/supabase-admin';

export type OnboardingFlag =
  | 'onboarding_watchlist_added'
  | 'onboarding_report_viewed'
  | 'onboarding_alert_enabled';

// 신규 가입자 온보딩 체크리스트 진행 플래그 갱신 — 이미 완료된 항목은 재호출돼도
// 덮어쓰지 않도록(예: 값을 되돌리거나 updated_at성 필드를 계속 갱신하는 부작용 방지)
// 먼저 현재 값을 확인한 뒤에만 true로 바꾼다. 호출부(watchlist/diagnosis/mypage 라우트)에서는
// 응답을 기다리지 않는 부가 효과이므로 반드시 next/server의 after()로 감싸서 호출할 것 —
// await 없이 던지면 응답 직후 서버리스 실행 컨텍스트가 얼어붙어 fetch가 끊기는 문제가
// 이 세션에서 이미 여러 번 확인됐다(app/api/stock/[ticker]/analysis 등).
export async function markOnboardingFlag(userId: string, flag: OnboardingFlag): Promise<void> {
  try {
    const { data, error: selectError } = await adminClient
      .from('users')
      .select(flag)
      .eq('id', userId)
      .maybeSingle();
    if (selectError) {
      console.error(`[ONBOARDING] ${flag} 조회 실패:`, selectError.message);
      return;
    }
    if (data && (data as Record<string, boolean>)[flag]) return; // 이미 완료 — 덮어쓰지 않음

    // 계산된 프로퍼티 키({ [flag]: true })는 supabase-js의 Update 타입과 매칭이 안 돼
    // switch로 리터럴 키를 명시한다.
    const update =
      flag === 'onboarding_watchlist_added' ? { onboarding_watchlist_added: true } :
      flag === 'onboarding_report_viewed'   ? { onboarding_report_viewed: true } :
      { onboarding_alert_enabled: true };

    const { error } = await adminClient.from('users').update(update).eq('id', userId);
    if (error) console.error(`[ONBOARDING] ${flag} 갱신 실패:`, error.message);
  } catch (e) {
    console.error(`[ONBOARDING] ${flag} 갱신 예외:`, e);
  }
}
