/**
 * 텔레그램 봇에 fpark 웹훅 URL을 등록하는 1회성 설정 스크립트.
 * TELEGRAM_BOT_TOKEN·TELEGRAM_WEBHOOK_SECRET이 .env.local에 있어야 한다.
 * 실행: npx tsx scripts/telegram-set-webhook.ts https://fpark.com/api/webhooks/telegram
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const [key, ...vals] = line.split('=');
  if (key?.trim() && vals.length && !process.env[key.trim()]) process.env[key.trim()] = vals.join('=').trim();
});

const url = process.argv[2];
if (!url) {
  console.error('사용법: npx tsx scripts/telegram-set-webhook.ts <웹훅 URL>');
  console.error('예:   npx tsx scripts/telegram-set-webhook.ts https://fpark.com/api/webhooks/telegram');
  process.exit(1);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token) { console.error('TELEGRAM_BOT_TOKEN이 .env.local에 없습니다.'); process.exit(1); }
if (!secret) { console.error('TELEGRAM_WEBHOOK_SECRET이 .env.local에 없습니다.'); process.exit(1); }

// tsx가 이 파일을 CJS로 트랜스파일해 top-level await을 못 써서 IIFE로 감싼다.
(async () => {
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message'] }),
  });
  const data = await res.json();
  console.log('setWebhook 응답:', JSON.stringify(data, null, 2));
  if (!data.ok) process.exit(1);

  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json());
  console.log('현재 웹훅 상태:', JSON.stringify(info.result, null, 2));

  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
  if (me.ok) console.log(`봇 유저네임: @${me.result.username} — 딥링크: https://t.me/${me.result.username}?start=<token>`);
})();
