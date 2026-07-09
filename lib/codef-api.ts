// CODEF API(계좌 거래내역 자동 조회) 연동 — 계좌이체 결제/환불 자동 승인용.
// 토큰 발급/캐싱은 lib/kis-api.ts의 getAccessToken()과 동일한 3단계 구조를 그대로 재사용한다:
//   1) 인메모리 캐시(동일 invocation 내 재사용)
//   2) Supabase 영속 캐시(codef_tokens, serverless invocation 간 공유)
//   3) 위 둘 다 없거나 만료 임박일 때만 CODEF에 신규 발급 요청
// (2026-07-08 계좌이체 자동승인 작업 1~2단계 — 계정 등록/거래내역 조회는 아직 미구현)

import crypto from 'crypto';
import { adminClient as supabaseAdmin } from './supabase-admin';

// 계좌 등록/거래내역 조회 등 실제 데이터 API용 Host — 데모버전. 정식(운영) 계약 전환 시
// 반드시 https://api.codef.io 로 변경할 것 (CODEF_CLIENT_ID/SECRET/PUBLIC_KEY도 운영용
// 값으로 함께 교체 필요 — .env.local 주석 참고). 3단계(계정 등록) 구현 시 사용 예정.
export const CODEF_BASE = 'https://development.codef.io';

// 토큰 발급 전용 Host — 데모/운영 구분 없이 항상 이 고정 주소를 사용한다
// (공식 SDK(codef-node 등) 기준. development/api.codef.io와는 별개의 OAuth 서버).
const CODEF_OAUTH_URL = 'https://oauth.codef.io/oauth/token';

// 인메모리 캐시: 동일 invocation 내 중복 발급 방지
let tokenCache: { token: string; expiresAt: number } | null = null;
// 동시 발급 요청 중복 방지
let tokenFetchPromise: Promise<string> | null = null;

export async function getCodefAccessToken(): Promise<string> {
  // 1) 인메모리 캐시
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  // 2) 동시 발급 요청 중복 방지
  if (tokenFetchPromise) return tokenFetchPromise;

  tokenFetchPromise = (async () => {
    // 3) Supabase 영속 캐시 (serverless invocation 간 공유)
    try {
      const { data: tokenData } = await supabaseAdmin
        .from('codef_tokens')
        .select('access_token, expired_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (tokenData?.access_token && tokenData?.expired_at) {
        const expiresAt = new Date(tokenData.expired_at);
        const remainingMs = expiresAt.getTime() - Date.now();
        const remainingMinutes = Math.floor(remainingMs / 60000);
        console.log('[CODEF] 토큰 상태:', {
          supabaseToken: true,
          expiresAt: tokenData.expired_at,
          remainingMinutes,
        });
        if (remainingMs > 10 * 60 * 1000) {
          console.log('[CODEF] 캐시된 토큰 재사용');
          tokenCache = { token: tokenData.access_token, expiresAt: expiresAt.getTime() };
          return tokenData.access_token;
        }
        console.log('[CODEF] 토큰 만료 임박 (10분 미만), 재발급');
      } else {
        console.log('[CODEF] 토큰 상태:', { supabaseToken: false });
      }
    } catch (e) {
      console.log('[CODEF] 토큰 캐시 조회 실패, 새로 발급:', e instanceof Error ? e.message : e);
    }

    // 4) CODEF에서 신규 발급
    // 동시에 여러 인스턴스가 "재발급 필요"를 판단할 수 있으므로, 짧은 지터 후
    // 한 번 더 Supabase를 확인해 다른 프로세스가 이미 새 토큰을 저장했는지 확인한다.
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    try {
      const { data: recheck } = await supabaseAdmin
        .from('codef_tokens')
        .select('access_token, expired_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (recheck?.access_token && recheck?.expired_at) {
        const remainingMs = new Date(recheck.expired_at).getTime() - Date.now();
        if (remainingMs > 10 * 60 * 1000) {
          console.log('[CODEF] 재확인 중 다른 프로세스가 재발급한 토큰 발견, 재사용');
          tokenCache = { token: recheck.access_token, expiresAt: new Date(recheck.expired_at).getTime() };
          return recheck.access_token;
        }
      }
    } catch {
      // 재확인 실패는 무시하고 정상적으로 신규 발급 진행
    }

    console.log('[CODEF] 새 토큰 발급 요청');
    const clientId     = process.env.CODEF_CLIENT_ID;
    const clientSecret = process.env.CODEF_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('[CODEF] CODEF_CLIENT_ID/CODEF_CLIENT_SECRET이 설정되지 않았습니다.');
    }
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const res = await fetch(CODEF_OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept:         'application/json',
        Authorization:  `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'read' }).toString(),
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CODEF 토큰 발급 실패 [${res.status}]: ${text}`);
    }

    const data = await res.json();
    // CODEF access_token은 약 1주일(604,799초) 유효 — expires_in을 그대로 신뢰하되,
    // 응답에 없는 예외 상황 대비 기본값도 1주일로 둔다(KIS의 24시간과 다름).
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 604_799) * 1000);
    tokenCache = { token: data.access_token, expiresAt: expiresAt.getTime() };

    // 5) 기존 토큰 전체 삭제 후 새 토큰 저장
    try {
      await supabaseAdmin.from('codef_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabaseAdmin.from('codef_tokens').insert({
        access_token: data.access_token,
        expired_at:   expiresAt.toISOString(),
      });
      console.log('[CODEF] 새 토큰 저장 완료, 만료:', expiresAt.toISOString());
    } catch (e) {
      console.error('[CODEF] 토큰 저장 실패:', e);
    }

    return data.access_token;
  })().finally(() => {
    tokenFetchPromise = null;
  });

  return tokenFetchPromise;
}

// 캐시된 토큰이 CODEF에 의해 조기 무효화되었을 때(예: 다른 프로세스의 재발급) 강제로
// 새 토큰을 발급받도록 인메모리·Supabase 캐시를 모두 비운다.
export async function invalidateCodefAccessToken(): Promise<void> {
  tokenCache = null;
  try {
    await supabaseAdmin.from('codef_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  } catch (e) {
    console.error('[CODEF] 토큰 캐시 삭제 실패:', e);
  }
}

// ── 3단계: 계정 등록(계좌 연결) — KB국민은행 기업(법인) 인증서 방식 ──────────────
// 2026-07-08 CODEF 공식 문서 원문 기준으로 확정된 값:
//   clientType: "B"(기업/법인), loginType: "0"(공동인증서 방식),
//   organization: "0004"(KB국민은행 — 금융결제원 표준 은행코드 "004"를 4자리로
//   zero-pad한 값. CODEF 공식 SDK 예제에서도 "organization":"0004" = 국민은행으로
//   명시적으로 확인함. organization은 기관 자체를 식별하고 개인/기업 구분은
//   clientType이 담당하는 구조라 기업뱅킹도 동일 코드를 쓴다).
// identity 필드에 사업자등록번호를 전달(법인 계좌라 개인 주민번호 대신 사용).
// 인증서 파일 형태가 아직 미확정이라 두 방식(der+key 분리 / pfx 통합) 모두 받을 수
// 있게 구현 — certType으로 분기.

export const KB_ORGANIZATION_CODE = '0004';

// CODEF가 발급한 공개키(PEM 헤더 없는 base64 body)를 RSA/ECB/PKCS1Padding으로
// 암호화하는 데 쓸 수 있도록 PEM 형식으로 감싼다.
function encryptWithCodefPublicKey(plaintext: string): string {
  const rawKey = process.env.CODEF_PUBLIC_KEY;
  if (!rawKey) throw new Error('[CODEF] CODEF_PUBLIC_KEY가 설정되지 않았습니다.');
  const pemBody = rawKey.match(/.{1,64}/g)?.join('\n') ?? rawKey;
  const pem = `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----`;
  const encrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(plaintext, 'utf-8'),
  );
  return encrypted.toString('base64');
}

export interface RegisterKbCorporateAccountParams {
  businessRegistrationNumber: string; // identity — 사업자등록번호(하이픈 없이 숫자만 권장)
  certPassword:               string; // 인증서 비밀번호(평문) — 이 함수 안에서만 RSA 암호화 후 즉시 폐기, 로그 금지
  certType:                   '1' | 'pfx';
  derFileBase64?:             string; // certType "1"(der+key 분리 방식)일 때 필수
  keyFileBase64?:             string; // certType "1"일 때 필수
  certFileBase64?:            string; // certType "pfx"(통합 파일)일 때 필수
}

export interface RegisterAccountResult {
  connectedId: string;
  raw: unknown;
}

// 실제 전송될 비민감 필드만 모은 미리보기 — registerKbCorporateAccount()가 내부적으로
// 이 값에 password/derFile/keyFile/certFile만 추가해서 그대로 전송하므로, 여기 보이는
// 값이 곧 실제 요청 값과 100% 동일함(별도로 값을 베껴 적어 어긋날 위험 없음).
export interface KbCorporateAccountPreview {
  countryCode:  string;
  businessType: string;
  clientType:   string;
  organization: string;
  loginType:    string;
  certType:     '1' | 'pfx';
  identity:     string; // 사업자등록번호
}

export function previewKbCorporateAccountFields(
  businessRegistrationNumber: string,
  certType: '1' | 'pfx',
): KbCorporateAccountPreview {
  return {
    countryCode:  'KR',
    businessType: 'BK',
    clientType:   'B',
    organization: KB_ORGANIZATION_CODE,
    loginType:    '0',
    certType,
    identity:     businessRegistrationNumber,
  };
}

// 주의: 이 함수는 실제 KB국민은행 기업계좌를 CODEF에 연결하는 실사용 함수다.
// 호출 전 반드시 사용자 확인을 받을 것 — 임시 실행 스크립트에서만 호출하고,
// 이 파일 자체는 API를 자동으로 호출하지 않는다(export만 할 뿐 아무것도 실행하지 않음).
export async function registerKbCorporateAccount(
  params: RegisterKbCorporateAccountParams,
): Promise<RegisterAccountResult> {
  const { businessRegistrationNumber, certPassword, certType, derFileBase64, keyFileBase64, certFileBase64 } = params;

  if (certType === '1' && (!derFileBase64 || !keyFileBase64)) {
    throw new Error('[CODEF] certType "1"(der+key 분리 방식)에는 derFileBase64/keyFileBase64가 모두 필요합니다.');
  }
  if (certType === 'pfx' && !certFileBase64) {
    throw new Error('[CODEF] certType "pfx"에는 certFileBase64가 필요합니다.');
  }

  const token = await getCodefAccessToken();
  const encryptedPassword = encryptWithCodefPublicKey(certPassword);

  const account: Record<string, unknown> = {
    ...previewKbCorporateAccountFields(businessRegistrationNumber, certType),
    password: encryptedPassword,
  };
  if (certType === '1') {
    account.derFile = derFileBase64;
    account.keyFile = keyFileBase64;
  } else {
    account.certFile = certFileBase64;
  }

  // 주의: password/derFile/keyFile/certFile은 민감정보라 절대 로그에 남기지 않는다.
  console.log('[CODEF] 계정 등록 요청 — organization:', KB_ORGANIZATION_CODE, 'clientType: B, certType:', certType);

  const res = await fetch(`${CODEF_BASE}/v1/account/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({ accountList: [account] }),
    cache: 'no-store',
  });

  const rawText = await res.text();
  if (!res.ok) {
    console.error('[CODEF] 계정 등록 실패 status:', res.status);
    throw new Error(`CODEF 계정 등록 실패 [${res.status}]`);
  }

  // CODEF는 계정 등록 응답을 application/x-www-form-urlencoded 스타일로 percent-encode해서
  // 반환한다(공백은 '+') — 순수 JSON이 아니라 URL 디코딩을 먼저 해야 한다.
  const text = decodeURIComponent(rawText.replace(/\+/g, ' '));

  let data: {
    result?: { code?: string; message?: string };
    data?: {
      connectedId?: string;
      successList?: unknown[];
      errorList?: { code?: string; message?: string }[];
    };
  };
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('[CODEF] 계정 등록 응답 파싱 실패:', e instanceof Error ? e.message : e, '— decoded:', text);
    throw new Error('[CODEF] 계정 등록 응답 파싱 실패');
  }

  const errorList = data?.data?.errorList ?? [];
  if (errorList.length > 0) {
    const reasons = errorList.map((e) => `${e.code}: ${e.message}`).join(' / ');
    console.error('[CODEF] 계정 등록 실패 —', data?.result?.message, '/', reasons);
    throw new Error(`[CODEF] 계정 등록 실패 — ${reasons}`);
  }

  const connectedId = data?.data?.connectedId;
  if (!connectedId) {
    console.error('[CODEF] 계정 등록 응답에 connectedId 없음 — result:', data?.result);
    throw new Error('[CODEF] connectedId를 응답에서 찾을 수 없습니다.');
  }

  console.log('[CODEF] 계정 등록 성공, connectedId 발급 완료');
  return { connectedId, raw: data };
}

// ── 4단계: 거래내역 조회 ────────────────────────────────────────────────────
// CODEF는 대부분 HTTP 200을 반환하고 대신 응답 바디의 result.code로 성패를 구분한다
// ("CF-00000" = 성공). 3단계(계정 등록)와 마찬가지로 응답 바디 전체가
// percent-encode되어 오므로 decodeURIComponent가 여기서도 반드시 필요하다.
function parseCodefResponse<T>(rawText: string, context: string): T {
  const text = decodeURIComponent(rawText.replace(/\+/g, ' '));
  let parsed: { result?: { code?: string; message?: string }; data?: T };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.error(`[CODEF] ${context} 응답 파싱 실패:`, e instanceof Error ? e.message : e, '— decoded:', text);
    throw new Error(`[CODEF] ${context} 응답 파싱 실패`);
  }
  if (parsed.result?.code && parsed.result.code !== 'CF-00000') {
    throw new Error(`[CODEF] ${context} 실패 — ${parsed.result.code}: ${parsed.result.message}`);
  }
  if (!parsed.data) {
    throw new Error(`[CODEF] ${context} 응답에 data가 없습니다 — result: ${JSON.stringify(parsed.result)}`);
  }
  return parsed.data;
}

// resAccountDesc1~4: 적요/거래메모 필드 — 은행·거래유형에 따라 어느 필드에
// 입금자가 입력한 텍스트(통장표시내용)가 들어오는지 달라진다. 공식 문서(CODEF
// 개발자 포털)가 JS 렌더링 SPA라 자동으로 열람할 수 없었고, CODEF 공식 SDK
// (codef-python) README의 예시 응답 기준으로 필드명만 확정했다 — 실제 값 배치는
// .e2e-tmp/fetch-kb-transactions.ts로 실계좌 조회해 확인할 것.
export interface CodefTransaction {
  resAccountTrDate:     string; // 거래일자 YYYYMMDD
  resAccountTrTime:     string; // 거래시각 HHMMSS
  resAccountIn:         string; // 입금액 ("0"이면 입금 아님)
  resAccountOut:        string; // 출금액 ("0"이면 출금 아님)
  resAfterTranBalance:  string; // 거래 후 잔액
  resAccountDesc1:      string; // 적요1
  resAccountDesc2:      string; // 적요2
  resAccountDesc3:      string; // 적요3
  resAccountDesc4:      string; // 적요4
}

// 실계좌(2026-07-09) 응답 기준으로 확정 — 문서(JS 렌더링 SPA)가 보여준 구버전 예시와
// 달리 계좌는 상품군별(resDepositTrust/resForeignCurrency/resFund/resLoan)로 분류돼
// 배열로 온다. 결제 매칭용 입출금계좌는 resDepositTrust에 담긴다.
export interface CodefDepositAccount {
  resAccount:          string; // 계좌번호(하이픈 없음) — transaction-list 호출 시 필요
  resAccountDisplay:   string; // 계좌번호(하이픈 포함, 표시용)
  resAccountName:      string;
  resAccountBalance:   string;
  resAccountCurrency:  string;
  resAccountNickName:  string;
  resAccountStartDate: string;
  resAccountEndDate:   string;
  resLastTranDate:     string;
}

interface CodefAccountListRaw {
  resDepositTrust?:    CodefDepositAccount[];
  resForeignCurrency?: CodefDepositAccount[];
  resFund?:            CodefDepositAccount[];
  resLoan?:            CodefDepositAccount[];
}

// 은행 법인 보유계좌 목록 조회 — connectedId에 연결된 일반 입출금계좌(resDepositTrust)만
// 뽑아서 반환한다. 외화/펀드/대출 계좌는 결제 매칭 대상이 아니라 제외.
export async function getCodefAccountList(
  connectedId: string,
  organization: string = KB_ORGANIZATION_CODE,
): Promise<CodefDepositAccount[]> {
  const token = await getCodefAccessToken();

  const res = await fetch(`${CODEF_BASE}/v1/kr/bank/b/account/account-list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({ connectedId, organization }),
    cache: 'no-store',
  });

  const rawText = await res.text();
  if (!res.ok) {
    console.error('[CODEF] 계좌 목록 조회 실패 status:', res.status);
    throw new Error(`CODEF 계좌 목록 조회 실패 [${res.status}]`);
  }

  const data = parseCodefResponse<CodefAccountListRaw | CodefAccountListRaw[]>(rawText, '계좌 목록 조회');
  const results = Array.isArray(data) ? data : [data];
  return results.flatMap((r) => r.resDepositTrust ?? []);
}

export interface GetCodefTransactionHistoryParams {
  connectedId: string;
  account:     string; // getCodefAccountList()의 resAccount 값
  startDate:   string; // YYYYMMDD
  endDate:     string; // YYYYMMDD
  organization?: string;
  // orderBy/inquiryType 정확한 값 의미는 공식 문서 미열람으로 미확정 — CODEF 공식
  // SDK 샘플의 placeholder만 확인했다. 기본값 '0'으로 시도하고, CODEF가 값 오류를
  // 반환하면 에러 메시지에 유효한 값이 함께 오는 경우가 많아 그에 맞춰 조정할 것.
  orderBy?:      string;
  inquiryType?:  string;
}

// 은행 법인 수시입출 거래내역 조회 — 특정 계좌번호의 지정 기간 거래내역을 조회한다.
export async function getCodefTransactionHistory(
  params: GetCodefTransactionHistoryParams,
): Promise<CodefTransaction[]> {
  const {
    connectedId,
    account,
    startDate,
    endDate,
    organization = KB_ORGANIZATION_CODE,
    orderBy = '0',
    inquiryType = '0',
  } = params;

  const token = await getCodefAccessToken();

  const res = await fetch(`${CODEF_BASE}/v1/kr/bank/b/account/transaction-list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({ connectedId, organization, account, startDate, endDate, orderBy, inquiryType }),
    cache: 'no-store',
  });

  const rawText = await res.text();
  if (!res.ok) {
    console.error('[CODEF] 거래내역 조회 실패 status:', res.status);
    throw new Error(`CODEF 거래내역 조회 실패 [${res.status}]`);
  }

  const data = parseCodefResponse<{ resTrHistoryList?: CodefTransaction[] }>(rawText, '거래내역 조회');
  return data.resTrHistoryList ?? [];
}
