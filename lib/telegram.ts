// 텔레그램 봇 연동 — BotFather로 만든 봇 하나(TELEGRAM_BOT_TOKEN)로 딥링크 연동 흐름과
// 실시간 알림 발송(sendMessage)을 모두 처리한다. 웹훅 요청이 실제 텔레그램에서 온 것인지는
// setWebhook 등록 시 넘긴 secret_token을 X-Telegram-Bot-Api-Secret-Token 헤더로 되돌려주는
// 텔레그램의 표준 검증 방식을 쓴다(app/api/webhooks/telegram/route.ts에서 비교).

const TELEGRAM_API_BASE = 'https://api.telegram.org';

// 연동 토큰(마이페이지에서 발급 → t.me 딥링크 payload → 웹훅에서 소진) 유효기간.
export const LINK_TOKEN_TTL_MS = 10 * 60_000; // 10분

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.');
  return token;
}

// 판별 유니온(discriminated union)이 아니라 평탄한 shape으로 선언 — 이 프로젝트
// tsconfig가 strict:false(strictNullChecks 꺼짐)라 `if (!result.ok)` 같은 판별 유니온
// narrowing이 안정적으로 동작하지 않는다(실측: description 접근에서 타입 에러). 호출부가
// narrowing 없이 그냥 `result.ok`로 분기하고 `result.description`은 항상 접근 가능하게 한다.
export type SendResult = { ok: boolean; errorCode?: number; description?: string };

// 자유 형식 텍스트 발송 — stock-alerts 크론의 알림 메시지, 웹훅의 연동 성공/실패 안내
// 둘 다 이 함수 하나로 보낸다. 실패해도 예외를 던지지 않고 결과를 반환 — 호출부(크론)가
// 한 유저 발송 실패로 나머지 유저 처리를 막지 않게 하기 위함.
export async function sendTelegramMessage(chatId: string, text: string): Promise<SendResult> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!data.ok) {
      return { ok: false, errorCode: data.error_code, description: data.description };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) };
  }
}

// error_code 403(Forbidden: bot was blocked by the user 등)은 그 chat_id로 더 이상
// 보낼 수 없다는 뜻 — 호출부(stock-alerts 크론)가 이 신호로 telegram_chat_id를 자동
// 정리(연동 해제)해 매 사이클 조용히 실패만 반복 쌓이는 좀비 상태를 막는다.
export function isBlockedByUser(result: SendResult): boolean {
  return result.ok === false && result.errorCode === 403;
}

let cachedBotUsername: string | null = null;

// 마이페이지가 딥링크(t.me/{username}?start={token})를 만들 때 필요 — 봇 유저네임을
// 환경변수로 따로 안 받고 getMe로 조회해 항상 실제 토큰과 일치하게 한다. 프로세스
// 생애주기 동안 안 바뀌는 값이라 인메모리 캐시.
export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken()}/getMe`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!data.ok) return null;
    cachedBotUsername = data.result.username as string;
    return cachedBotUsername;
  } catch {
    return null;
  }
}

// 1회성 설정 스크립트(scripts/telegram-set-webhook.ts)와 웹훅 라우트 양쪽에서 같은
// 값을 참조해야 해서 헬퍼로 뺐다 — 하나는 setWebhook 호출 시 secret_token으로 등록하고,
// 다른 하나는 수신 헤더와 비교한다.
export function webhookSecret(): string {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET이 설정되지 않았습니다.');
  return secret;
}
