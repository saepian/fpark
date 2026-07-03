import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const admin  = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const resend = new Resend(process.env.RESEND_API_KEY!);

const ADMIN_EMAIL = 'saepian2@gmail.com';
const FROM        = 'Finance Park <noreply@fpark.com>';

const RATE_LIMIT_MAX        = 5;               // IP당 시간당 최대 제출 횟수
const RATE_LIMIT_WINDOW_MS  = 60 * 60 * 1000;   // 1시간

function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function adminEmailHtml(params: {
  name: string; email: string; category: string; subject: string; message: string; dbSaveFailed: boolean;
}): string {
  const { name, email, category, subject, message, dbSaveFailed } = params;
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>Finance Park 문의</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px 48px">
    ${dbSaveFailed ? `
    <div style="background:#7c1d1d;border:1px solid #ef4444;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#fecaca;font-size:12px;font-weight:600">
      ⚠️ 이 문의는 DB 저장에 실패했습니다 — 이 이메일이 유일한 기록입니다.
    </div>` : ''}
    <div style="font-size:20px;font-weight:800;color:#818cf8;margin-bottom:24px">Finance Park</div>
    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:12px;padding:24px">
      <h2 style="margin:0 0 20px;color:#e2e8f0;font-size:16px;font-weight:700">새 문의가 접수되었습니다</h2>
      <table style="width:100%;border-collapse:collapse">
        ${[
          ['이름', name],
          ['이메일', email],
          ['문의 유형', category || '미선택'],
          ['제목', subject],
        ].map(([label, value]) => `
        <tr style="border-bottom:1px solid #1e2537">
          <td style="padding:10px 0;color:#64748b;font-size:12px;font-weight:600;width:80px;vertical-align:top">${escapeHtml(label)}</td>
          <td style="padding:10px 0;color:#e2e8f0;font-size:13px">${escapeHtml(value)}</td>
        </tr>`).join('')}
      </table>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid #1e2537">
        <p style="margin:0 0 8px;color:#64748b;font-size:12px;font-weight:600">문의 내용</p>
        <p style="margin:0;color:#cbd5e1;font-size:13.5px;line-height:1.8;white-space:pre-wrap">${escapeHtml(message)}</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function replyEmailHtml(name: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>문의 접수 확인</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px 48px">

    <div style="text-align:center;padding:28px 0 20px">
      <div style="font-size:22px;font-weight:800;color:#818cf8;letter-spacing:-.02em">Finance Park</div>
    </div>

    <div style="background:#0d1117;border:1px solid #1e2537;border-radius:12px;padding:28px 24px;text-align:center">
      <div style="width:52px;height:52px;border-radius:50%;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.3);display:inline-flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:16px">✅</div>
      <h2 style="margin:0 0 10px;color:#e2e8f0;font-size:17px;font-weight:700">문의가 접수되었습니다</h2>
      <p style="margin:0;color:#94a3b8;font-size:13.5px;line-height:1.8">
        안녕하세요, <strong style="color:#e2e8f0">${escapeHtml(name)}</strong>님.<br>
        문의해 주셔서 감사합니다.<br>
        영업일 기준 <strong style="color:#e2e8f0">1~2일 이내</strong>에 답변 드리겠습니다.
      </p>
    </div>

    <div style="margin-top:20px;background:#0d1117;border:1px solid #1e2537;border-radius:12px;padding:16px 20px">
      <p style="margin:0;color:#475569;font-size:12px;line-height:1.7">
        본 메일은 문의 접수 확인을 위해 자동 발송된 메일입니다.<br>
        추가 문의 사항은 <a href="mailto:${ADMIN_EMAIL}" style="color:#818cf8;text-decoration:none">${ADMIN_EMAIL}</a>로 연락해 주세요.
      </p>
    </div>

    <div style="text-align:center;margin-top:24px">
      <a href="https://fpark.com" style="display:inline-block;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#fff;text-decoration:none;padding:11px 24px;border-radius:10px;font-size:13px;font-weight:600">
        fpark.com 바로가기 →
      </a>
    </div>
  </div>
</body>
</html>`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, category, subject, message, website } = body as {
      name: string; email: string; category: string; subject: string; message: string; website?: string;
    };

    // 허니팟 — 실사용자에게는 안 보이는 필드라 값이 있으면 봇으로 간주.
    // 탐지 사실을 알리지 않기 위해 정상 접수된 것처럼 200을 반환하되 아무 것도 하지 않음.
    if (website?.trim()) {
      console.warn('[CONTACT] 허니팟 필드 감지 — 봇으로 간주하고 무시:', getClientIp(req));
      return NextResponse.json({ ok: true });
    }

    if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    const ip = getClientIp(req);

    // 1. Rate limiting — IP당 시간당 RATE_LIMIT_MAX건 초과 시 차단
    //    조회 자체가 실패해도(예: 마이그레이션 전) 정상 사용자를 막지 않도록 fail-open
    if (ip !== 'unknown') {
      const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
      const { count, error: countError } = await admin
        .from('contact_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('ip_address', ip)
        .gte('created_at', since);

      if (countError) {
        console.error('[CONTACT] rate limit 조회 실패:', countError.message);
      } else if ((count ?? 0) >= RATE_LIMIT_MAX) {
        console.warn(`[CONTACT] rate limit 초과 — IP: ${ip}, 최근 1시간 ${count}건`);
        return NextResponse.json({ error: '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
      }
    }

    // 2. DB 저장 (실패해도 이메일 발송은 계속 진행하되, 관리자 이메일에 실패 사실을 명시)
    let dbSaveFailed = false;
    const { error: insertError } = await admin
      .from('contact_submissions')
      .insert({ name, email, category, subject, message, ip_address: ip });
    if (insertError) {
      dbSaveFailed = true;
      console.error('[CONTACT] DB 저장 실패:', insertError.message, insertError.details ?? '');
    }

    // 3. 관리자 수신 이메일
    const adminSubject = category
      ? `[Finance Park 문의] ${category} - ${subject}`
      : `[Finance Park 문의] ${subject}`;

    const [adminResult, replyResult] = await Promise.allSettled([
      resend.emails.send({
        from: FROM,
        to: [ADMIN_EMAIL],
        subject: adminSubject,
        html: adminEmailHtml({ name, email, category, subject, message, dbSaveFailed }),
        replyTo: email,
      }),
      resend.emails.send({
        from: FROM,
        to: [email],
        subject: '[Finance Park] 문의가 접수되었습니다',
        html: replyEmailHtml(name),
      }),
    ]);

    if (adminResult.status === 'rejected') {
      console.error('[CONTACT] 관리자 이메일 발송 실패:', adminResult.reason);
      return NextResponse.json({ error: '이메일 발송에 실패했습니다.' }, { status: 500 });
    }
    if (adminResult.value.error) {
      console.error('[CONTACT] 관리자 이메일 오류:', adminResult.value.error);
      return NextResponse.json({ error: '이메일 발송에 실패했습니다.' }, { status: 500 });
    }

    if (replyResult.status === 'rejected') {
      console.warn('[CONTACT] 자동 회신 발송 실패:', replyResult.reason);
    }

    console.log(`[CONTACT] 발송 완료 — 관리자: ${ADMIN_EMAIL}, 회신: ${email}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[CONTACT] 오류:', e);
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
