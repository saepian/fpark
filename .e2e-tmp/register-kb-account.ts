/**
 * KB국민은행 기업 공동인증서 CODEF 계좌 등록 — 3단계.
 *
 * 기본은 항상 DRY RUN(인증서 로드/만료일 검증 + 전송 필드 미리보기만, 네트워크/DB 접근 없음).
 * 실제 등록은 --live 플래그와 KB_REGISTER_CONFIRM=YES 환경변수가 "둘 다" 있어야 실행된다.
 * .env.local에 KB_REGISTER_CONFIRM=YES가 이미 저장돼 있어도 --live 없이는 절대 실행되지
 * 않도록 이중 게이트를 둔 것 — 이 파일을 그냥 실행하는 것만으로 실수로 실제 등록/DB 쓰기가
 * 일어나는 사고를 막기 위함(lib/supabase-admin.ts의 adminClient 가드와 같은 취지).
 *
 * 실행:
 *   DRY RUN:   npx tsx .e2e-tmp/register-kb-account.ts
 *   실제 등록: KB_REGISTER_CONFIRM=YES npx tsx .e2e-tmp/register-kb-account.ts --live
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { X509Certificate } from 'crypto';

// .env.local 로드 (tsx는 dotenv 자동 로드 안 함) — scripts/backfill-images.ts와 동일 패턴
const envPath = resolve(process.cwd(), '.env.local');
readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const [key, ...vals] = line.split('=');
  if (key?.trim() && vals.length) process.env[key.trim()] = vals.join('=').trim();
});

const isLive = process.argv.includes('--live');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[register-kb-account] ${name}가 .env.local에 없습니다.`);
  return v;
}

async function main() {
  const derPath = requireEnv('KB_CERT_DER_PATH');
  const keyPath = requireEnv('KB_CERT_KEY_PATH');
  const businessRegNo = requireEnv('KB_BUSINESS_REG_NO');
  const certPassword = requireEnv('KB_CERT_PASSWORD');

  const derBuf = readFileSync(resolve(derPath));
  const keyBuf = readFileSync(resolve(keyPath));

  console.log('=== 인증서 파일 검증 ===');
  console.log('der 경로:', derPath, `(${derBuf.length} bytes)`);
  console.log('key 경로:', keyPath, `(${keyBuf.length} bytes)`);

  const cert = new X509Certificate(derBuf);
  console.log('subject:', cert.subject.split('\n').join(', '));
  console.log('validFrom:', cert.validFrom);
  console.log('validTo:', cert.validTo);

  const now = new Date();
  const notAfter = new Date(cert.validTo);
  const notBefore = new Date(cert.validFrom);
  if (now > notAfter) {
    throw new Error(`[register-kb-account] 인증서가 만료되었습니다 (validTo: ${cert.validTo})`);
  }
  if (now < notBefore) {
    throw new Error(`[register-kb-account] 인증서 유효기간이 아직 시작되지 않았습니다 (validFrom: ${cert.validFrom})`);
  }
  const daysRemaining = Math.floor((notAfter.getTime() - now.getTime()) / 86_400_000);
  console.log(`상태: 유효함 (만료까지 ${daysRemaining}일 남음)`);

  // lib/codef-api.ts는 top-level에서 process.env를 읽지 않으므로 이 시점에 import해도 안전하지만,
  // .env.local 로드 이후로 늦춰서 순서 문제 가능성 자체를 없앤다.
  const { previewKbCorporateAccountFields, registerKbCorporateAccount } = await import('../lib/codef-api');

  const preview = previewKbCorporateAccountFields(businessRegNo, '1');
  console.log('\n=== 전송될 필드 미리보기 (민감정보 제외) ===');
  console.log(preview);

  if (!isLive) {
    console.log('\n=== DRY RUN 완료 — 네트워크/DB 호출 없음 ===');
    console.log('실제 등록을 실행하려면: KB_REGISTER_CONFIRM=YES npx tsx .e2e-tmp/register-kb-account.ts --live');
    return;
  }

  if (process.env.KB_REGISTER_CONFIRM !== 'YES') {
    throw new Error('[register-kb-account] --live 플래그는 있지만 KB_REGISTER_CONFIRM=YES가 없습니다. 중단합니다.');
  }

  console.log('\n=== 실제 등록 실행 ===');
  const result = await registerKbCorporateAccount({
    businessRegistrationNumber: businessRegNo,
    certPassword,
    certType: '1',
    derFileBase64: derBuf.toString('base64'),
    keyFileBase64: keyBuf.toString('base64'),
  });
  console.log('connectedId:', result.connectedId);

  const { adminClient } = await import('../lib/supabase-admin');
  const { error } = await adminClient.from('codef_connected_accounts').insert({
    connected_id: result.connectedId,
    bank_name: 'KB국민은행',
    business_registration_number: businessRegNo,
  });
  if (error) {
    console.error('[register-kb-account] DB 저장 실패:', error);
    throw error;
  }
  console.log('codef_connected_accounts 테이블에 저장 완료');
}

main().catch((e) => {
  console.error('\n실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
