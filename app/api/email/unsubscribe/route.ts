import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { verifyUnsubToken } from '@/lib/unsubscribe-token';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token');

  if (!token) {
    return new NextResponse(errorHtml('잘못된 링크입니다.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // HMAC 서명 검증 — UUID 직접 노출 없이 안전하게 userId 추출
  const userId = verifyUnsubToken(token);
  if (!userId) {
    return new NextResponse(errorHtml('유효하지 않은 링크입니다.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const { error } = await adminClient
    .from('users')
    .update({ email_alert_enabled: false })
    .eq('id', userId);

  if (error) {
    console.error('[UNSUBSCRIBE] DB 오류:', error.message);
    return new NextResponse(errorHtml('처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new NextResponse(successHtml(), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function successHtml(): string {
  return page(
    '✅',
    '이메일 수신이 해제되었습니다',
    'Finance Park 일일 리포트가 더 이상 발송되지 않습니다.',
    '<a href="https://fpark.com/mypage" style="color:#818cf8;font-size:13px;text-decoration:underline">마이페이지에서 재설정하기 →</a>',
  );
}

function errorHtml(msg: string): string {
  return page('❌', '오류가 발생했습니다', msg, '');
}

function page(icon: string, title: string, body: string, extra: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Finance Park</title>
</head>
<body style="margin:0;padding:0;background:#060810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
  <div style="text-align:center;max-width:320px;padding:24px">
    <p style="font-size:36px;margin:0 0 12px">${icon}</p>
    <h1 style="color:#e2e8f0;font-size:18px;font-weight:600;margin:0 0 8px">${title}</h1>
    <p style="color:#64748b;font-size:14px;margin:0 0 20px;line-height:1.6">${body}</p>
    ${extra}
  </div>
</body>
</html>`;
}
