import { createHmac } from 'crypto';

function secret(): string {
  return process.env.CRON_SECRET ?? '';
}

export function makeUnsubToken(userId: string): string {
  const sig = createHmac('sha256', secret()).update(userId).digest('hex');
  return Buffer.from(`${userId}.${sig}`).toString('base64url');
}

export function verifyUnsubToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const dotIdx = decoded.indexOf('.');
    if (dotIdx === -1) return null;
    const userId   = decoded.slice(0, dotIdx);
    const received = decoded.slice(dotIdx + 1);
    const expected = createHmac('sha256', secret()).update(userId).digest('hex');
    const a = Buffer.from(received, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return null;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0 ? userId : null;
  } catch {
    return null;
  }
}
