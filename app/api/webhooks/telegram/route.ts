// 텔레그램 봇 업데이트 수신 — 마이페이지 딥링크(t.me/{bot}?start={token})로 사용자가
// 봇과 /start 대화를 시작하면 텔레그램이 그 payload(연동 토큰)를 실어 여기로 보낸다.
// 토큰으로 fpark 유저를 찾아 telegram_chat_id를 저장하면 연동 완료.
//
// 보안: setWebhook 등록 시(scripts/telegram-set-webhook.ts) secret_token을 같이 넘겨뒀고,
// 텔레그램은 그 값을 모든 웹훅 요청에 X-Telegram-Bot-Api-Secret-Token 헤더로 그대로
// 되돌려준다 — app/api/webhooks/dodo와 동일하게 처리 전 이 헤더부터 검증하고, 불일치하면
// body도 안 읽고 401로 즉시 차단한다.
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { sendTelegramMessage, webhookSecret } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token');
  let expectedSecret: string;
  try {
    expectedSecret = webhookSecret();
  } catch (e) {
    console.error('[webhooks/telegram]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }
  if (receivedSecret !== expectedSecret) {
    console.warn('[webhooks/telegram] 시크릿 토큰 불일치 — 텔레그램이 아닌 요청으로 판단, 거부');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 텔레그램은 200이 아닌 응답을 재시도 대상으로 취급한다 — 우리가 이해 못 하는
  // update 종류(채널 게시물, 콜백쿼리 등)나 파싱 실패도 전부 200으로 조용히 흡수해
  // 불필요한 재시도 폭주를 막는다. 실제로 처리해야 할 실패(토큰 매칭 등)만 아래에서
  // 텔레그램 쪽으로 안내 메시지를 보내는 방식으로 사용자에게 알린다.
  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = (update as { message?: { chat?: { id?: number }; text?: string } } | undefined)?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;
  if (!chatId || typeof text !== 'string' || !text.startsWith('/start')) {
    return NextResponse.json({ ok: true });
  }

  const token = text.slice('/start'.length).trim();
  const chatIdStr = String(chatId);

  if (!token) {
    await sendTelegramMessage(chatIdStr, 'fpark.com 마이페이지에서 "텔레그램 연동하기" 버튼으로 다시 시작해주세요.');
    return NextResponse.json({ ok: true });
  }

  const { data: tokenRow } = await adminClient
    .from('telegram_link_tokens')
    .select('user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (!tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at) < new Date()) {
    console.warn('[webhooks/telegram] 유효하지 않은/만료된 연동 토큰:', token);
    await sendTelegramMessage(chatIdStr, '연동 링크가 만료됐거나 이미 사용됐습니다. fpark.com 마이페이지에서 다시 시도해주세요.');
    return NextResponse.json({ ok: true });
  }

  const { error: updateErr } = await adminClient
    .from('users')
    .update({ telegram_chat_id: chatIdStr, telegram_linked_at: new Date().toISOString() })
    .eq('id', tokenRow.user_id);

  if (updateErr) {
    console.error('[webhooks/telegram] users 업데이트 실패:', updateErr.message);
    await sendTelegramMessage(chatIdStr, '연동 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    return NextResponse.json({ ok: true });
  }

  // 1회용 — 소진 표시(재사용/재전송 시 위 만료 체크에 걸리게).
  await adminClient.from('telegram_link_tokens').update({ used_at: new Date().toISOString() }).eq('token', token);

  console.log(`[webhooks/telegram] 연동 완료: user=${tokenRow.user_id} chat=${chatIdStr}`);
  await sendTelegramMessage(
    chatIdStr,
    'fpark 텔레그램 알림이 연동됐습니다! 🎉\n\n관심종목의 주가·수급 알림을 앞으로 여기로도 받아보실 수 있어요.',
  );

  return NextResponse.json({ ok: true });
}
