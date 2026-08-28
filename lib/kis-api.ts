import type { StockPrice, StockInfo, ChartDataPoint, MarketIndexData, MoverStock, AlertStock } from './types';
import type { Json } from './database.types';
import { adminClient as supabaseAdmin } from './supabase-admin';
import { supabase } from './supabase';
import { findClosestPastClose, isKoreanMarketOpen } from './market-utils';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

// 종목명 로컬 fallback — 실제로는 fallback이 아니라 사실상 1차 소스다: KIS의
// inquire-price(FHKST01010100)는 hts_kor_isnm/prdt_abrv_name 필드를 어떤 종목을
// 조회해도 아예 내려주지 않으므로(2026-07-09 실API 호출로 확인), resolveStockName()이
// 항상 이 테이블로 폴백한다. 즉 이 테이블에 오타/오매핑이 있으면 100% 그대로 노출된다.
//
// 2026-07-09 "SK스퀘어가 SK스페셜티로 표시됨" 버그 조사 중 KRX 상장법인목록(공식)과
// KIS search-stock-info(CTPF1604R)로 전수 대조한 결과, 이 테이블에 같은 유형(코드는
// 맞는데 완전히 다른 회사명이 매핑됨)의 오류가 13건 더 있어 함께 수정함 — 아래 각 항목
// 주석 참고. 수정 근거는 두 소스(KRX corpList.do 다운로드 + KIS search-stock-info)가
// 정확히 일치하는 것만 반영했다(단순 정식명↔약칭 차이인 현대차/포스코홀딩스/KT 등은
// 실제로는 오류가 아니라서 그대로 둠).
export const STOCK_NAMES: Record<string, string> = {
  '005930': '삼성전자',
  '000660': 'SK하이닉스',
  '005380': '현대차',
  '000270': '기아',
  '005490': '포스코홀딩스',
  '035420': 'NAVER',
  '035720': '카카오',
  '000990': 'DB하이텍',
  '042700': '한미반도체',
  '086520': '에코프로',
  '373220': 'LG에너지솔루션',
  '207940': '삼성바이오로직스',
  '051910': 'LG화학',
  '006400': '삼성SDI',
  '028260': '삼성물산',
  '012330': '현대모비스',
  '003670': '포스코퓨처엠',
  '009150': '삼성전기',
  '032830': '삼성생명',
  '015760': '한국전력',
  '034730': 'SK',
  '017670': 'SK텔레콤',
  '030200': 'KT',
  '055550': '신한지주',
  '105560': 'KB금융',
  '086790': '하나금융지주',
  '316140': '우리금융지주',
  '003490': '대한항공',
  '011200': 'HMM',
  '096770': 'SK이노베이션',
  '010950': 'S-Oil',
  '018260': '삼성에스디에스',
  '000810': '삼성화재',
  '033780': 'KT&G',
  '009830': '한화솔루션',
  '051600': '한전KPS',
  '010130': '고려아연',
  '024110': '기업은행',
  '128940': '한미약품',
  '008770': '호텔신라',
  '003550': 'LG',
  '097950': 'CJ제일제당',
  '047050': '포스코인터내셔널',
  '004020': '현대제철',
  '005440': '현대지에프홀딩스', // 2026-07-09 수정: 잘못 '현대글로비스'로 매핑(실제 현대글로비스 코드는 086280)
  '006280': '녹십자',
  '000100': '유한양행',
  '007070': 'GS리테일',
  '001800': '오리온홀딩스',
  '088350': '한화생명', // 2026-07-09 수정: 잘못 'NH투자증권'으로 매핑(실제 NH투자증권 코드는 005940)
  '008560': '메리츠증권', // 2026-07-09 수정: 메리츠금융지주 완전자회사화 이후 정식명은 메리츠증권
  '011790': 'SKC',
  '001040': 'CJ',
  '004990': '롯데지주',
  '139480': '이마트',
  '021240': '코웨이',
  '263750': '펄어비스',
  '247540': '에코프로비엠',
  '196170': '알테오젠',
  '018290': '브이티', // 2026-07-09 수정: 잘못 '레이'로 매핑(실제 레이 코드는 228670)
  '091990': '셀트리온헬스케어',
  '214150': '클래시스',
  '145020': '휴젤',
  '357780': '솔브레인',
  '028300': 'HLB',
  '122630': 'KODEX 레버리지',
  '294870': 'HDC현대산업개발',
  '045390': '대아티아이',
  '058470': '리노공업',
  '041510': 'SM',
  '068270': '셀트리온',
  '095340': 'ISC',
  '039030': '이오테크닉스',
  '057540': '옴니시스템', // 2026-07-09 수정: 잘못 '셀트리온제약'으로 매핑(실제 셀트리온제약 코드는 068760)
  '263720': '디앤씨미디어',
  '383310': '에코프로에이치엔', // 2026-07-09 수정: 잘못 '에코프로머티리얼즈'로 매핑(실제 코드는 450080)
  '241560': '두산밥캣',
  '047310': '파워로직스',
  '950130': '엑세스바이오', // 2026-07-09 수정: 잘못 '엑스페릭스'로 매핑(실제 엑스페릭스 코드는 317770)
  '066970': 'L&F',
  '052690': '한전기술',
  '101360': '에코앤드림',
  '251270': '넷마블',
  '027360': '아주IB투자',
  '065500': '오리엔트정공', // 2026-07-09 수정: 잘못 '오에스아이소프트'로 매핑(국내 상장사 아님, 오매핑)
  '094360': '칩스앤미디어',
  '131970': '두산테스나', // 2026-07-09 수정: 잘못 '테크윙'으로 매핑(실제 테크윙 코드는 089030)
  '060150': '인선이엔티', // 2026-07-09 수정: 잘못 'SIMPAC'으로 매핑(실제 SIMPAC 코드는 009160)
  '140860': '파크시스템스',
  '312610': '에이에프더블류',
  '236200': '슈프리마',
  '039440': '에스티아이',
  '220180': '핸디소프트', // 2026-07-09 수정: 잘못 '한컴라이프케어'로 매핑(실제 한컴라이프케어 코드는 372910)
  '293490': '카카오게임즈',
  '140410': '메지온',
  '189300': '인텔리안테크', // 2026-07-09 수정: 잘못 '인터로조'로 매핑(실제 인터로조 코드는 119610)
  '323990': '박셀바이오', // 2026-07-09 수정: 잘못 '파나진'으로 매핑(오매핑, 파나진은 비상장/코드 상이)
  '402340': 'SK스퀘어', // 2026-07-09 수정: 이번에 신고된 버그 — 잘못 'SK스페셜티'(반도체 특수가스 회사, 완전히 다른 회사)로 매핑돼 있었음
  '048410': '현대바이오',
};

// KIS name이 빈 문자열인 경우 search-stock-info(CTPF1604R)로 보완 (process 내 캐시)
const nameCache = new Map<string, string>();

async function fetchNameFromKisSearch(ticker: string): Promise<string | null> {
  if (nameCache.has(ticker)) return nameCache.get(ticker)!;
  try {
    const token = await getAccessToken();
    await acquireKisRateSlot();
    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/search-stock-info`);
    url.searchParams.set('PRDT_TYPE_CD', '300');
    url.searchParams.set('PDNO', ticker);

    const res = await fetch(url.toString(), {
      headers: headers(token, 'CTPF1604R'),
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.rt_cd !== '0') return null;

    const name = (data.output?.prdt_abrv_name || data.output?.prdt_name || '').trim();
    if (name) {
      nameCache.set(ticker, name);
      return name;
    }
  } catch {
    // 조회 실패는 무시
  }
  return null;
}

// KIS 응답(o) → 종목명 해석: hts_kor_isnm/prdt_abrv_name → STOCK_NAMES → search-stock-info → (최후) ticker
async function resolveStockName(ticker: string, o: any): Promise<string> {
  const kisName = ((o.hts_kor_isnm || o.prdt_abrv_name || '') as string).trim();
  if (kisName) return kisName;
  if (STOCK_NAMES[ticker]) return STOCK_NAMES[ticker];

  const searchName = await fetchNameFromKisSearch(ticker);
  if (searchName) {
    console.log(`[KIS] ${ticker} 이름을 search-stock-info로 조회: ${searchName}`);
    return searchName;
  }
  console.warn(`[KIS] ${ticker} 종목명 조회 실패, ticker 코드로 표시`);
  return ticker;
}

// 인메모리 캐시: 동일 invocation 내 중복 발급 방지
let tokenCache: { token: string; expiresAt: number } | null = null;
// 동시 발급 요청 중복 방지
let tokenFetchPromise: Promise<string> | null = null;
// 최근 발급 시도 실패 기록 — KIS는 발급 엔드포인트 자체에 "1분당 1회" 제한이 있어
// (EGW00133), 실패 직후 곧바로 재시도하면 100% 다시 같은 이유로 실패한다. 이 쿨다운이
// 없으면 하나의 invocation이 여러 종목을 순회하며 매번 getAccessToken()을 호출할 때마다
// KIS에 다시 발급을 시도해 스스로 rate limit을 계속 유발하는 악순환이 생긴다
// (2026-07-10 13시대 대량 재발급 실패 사고 원인 중 하나 — 상세 진단 기록은 이 커밋
// 메시지 참고).
let lastIssueFailure: { at: number; error: Error } | null = null;
const ISSUE_FAILURE_COOLDOWN_MS = 65_000;

// 2026-07-10 M2 사고 대응: 여러 서버리스 인스턴스가 거의 동시에 "재발급 필요"를
// 판단하면 KIS의 "1분당 1회" 발급 제한(EGW00133)에 서로 부딪혀 전부 실패하고,
// 그 상태가 계속 반복돼 사실상 유효한 토큰이 하나도 없는 상태가 지속됐다
// (지터+재확인 정도로는 막기엔 충돌 창이 너무 넓었다).
//
// kis_tokens 테이블의 PK 유일성만으로(새 테이블/마이그레이션 없이) 분산 락을
// 구현한다 — 고정된 음수 id(-1, 실제 토큰 id는 항상 양수라 절대 안 겹침) 행을
// "먼저 insert에 성공한 프로세스만" 만들 수 있고, 나머지는 그 즉시 PK 충돌
// 에러로 알 수 있다(2026-07-10 실측으로 확인). 락 보유자가 비정상 종료해도
// 무한히 막히지 않도록 TTL을 두고, TTL이 지난 락은 다음 프로세스가 정리하고
// 다시 시도한다.
const LOCK_ID = -1;
const LOCK_TTL_MS = 8_000; // KIS 발급 왕복 + 여유를 넉넉히 덮는 시간

async function acquireIssueLock(): Promise<boolean> {
  const deadline = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const { error } = await supabaseAdmin
    .from('kis_tokens')
    .insert({ id: LOCK_ID, access_token: 'LOCK', expired_at: deadline });
  if (!error) return true;

  // 이미 락 행이 있다 — 아직 유효한(TTL 안 지난) 락인지 확인
  const { data: existing } = await supabaseAdmin
    .from('kis_tokens')
    .select('expired_at')
    .eq('id', LOCK_ID)
    .maybeSingle();
  if (existing && new Date(existing.expired_at).getTime() > Date.now()) {
    return false; // 다른 프로세스가 유효하게 락을 쥐고 있음
  }

  // TTL이 지난 락(이전 홀더가 릴리즈 없이 비정상 종료) — 정리하고 한 번만 재시도
  await supabaseAdmin.from('kis_tokens').delete().eq('id', LOCK_ID);
  const { error: retryError } = await supabaseAdmin
    .from('kis_tokens')
    .insert({ id: LOCK_ID, access_token: 'LOCK', expired_at: deadline });
  return !retryError;
}

async function releaseIssueLock(): Promise<void> {
  try {
    await supabaseAdmin.from('kis_tokens').delete().eq('id', LOCK_ID);
  } catch (e) {
    console.error('[KIS] 발급 락 해제 실패:', e);
  }
}

export async function getAccessToken(opts?: { waitForLock?: boolean }): Promise<string> {
  const waitForLock = opts?.waitForLock ?? true;

  // 1) 인메모리 캐시
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  // 2) 동시 발급 요청 중복 방지
  // 주의: 이미 다른 호출이 발급을 진행 중이라면(락 대기 포함) 그 프로미스를 그대로
  // 공유한다 — 이 호출이 waitForLock:false여도, 같은 인스턴스 안에서 이미 시작된
  // 대기를 중간에 끊을 수는 없다. 실질적으로는 흔치 않은 동시 호출 케이스라
  // 별도 처리하지 않는다.
  if (tokenFetchPromise) return tokenFetchPromise;

  // 2.5) 방금 발급을 시도했다가 실패했다면(주로 KIS "1분당 1회" 제한), 쿨다운이
  // 끝나기 전까지는 같은 에러를 즉시 다시 던진다 — KIS에 또 요청을 보내봐야 100%
  // 같은 이유로 다시 실패하므로, 이 invocation 안에서 뒤이어 여러 종목을 처리하며
  // 반복 호출되는 getAccessToken()이 매번 KIS를 두드리는 것을 막는다.
  if (lastIssueFailure && Date.now() - lastIssueFailure.at < ISSUE_FAILURE_COOLDOWN_MS) {
    throw lastIssueFailure.error;
  }

  tokenFetchPromise = (async () => {
    // 3) Supabase 영속 캐시 (serverless invocation 간 공유) — id>0 조건으로
    // 발급 락 sentinel 행(id=-1)은 제외한다.
    try {
      const { data: tokenData } = await supabaseAdmin
        .from('kis_tokens')
        .select('access_token, expired_at')
        .gt('id', 0)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }) // created_at 동률 시 결정적 순서 보장
        .limit(1)
        .single();

      if (tokenData?.access_token && tokenData?.expired_at) {
        const expiresAt = new Date(tokenData.expired_at);
        const now = new Date();
        const remainingMs = expiresAt.getTime() - now.getTime();
        const remainingMinutes = Math.floor(remainingMs / 60000);
        console.log('[KIS] 토큰 상태:', {
          supabaseToken: true,
          expiresAt: tokenData.expired_at,
          remainingMinutes,
        });
        if (remainingMs > 10 * 60 * 1000) {
          console.log('[KIS] 캐시된 토큰 재사용');
          tokenCache = { token: tokenData.access_token, expiresAt: expiresAt.getTime() };
          return tokenData.access_token;
        }
        console.log('[KIS] 토큰 만료 임박 (10분 미만), 재발급');
      } else {
        console.log('[KIS] 토큰 상태:', { supabaseToken: false });
      }
    } catch (e) {
      console.log('[KIS] 토큰 캐시 조회 실패, 새로 발급:', e instanceof Error ? e.message : e);
    }

    // 4) 발급 락 획득 시도 — 이걸 획득한 프로세스만 실제로 KIS에 발급을 요청한다.
    // 획득 못 하면 다른 프로세스가 지금 발급 중이라는 뜻이므로, KIS를 또 두드려
    // rate limit을 더 악화시키는 대신 짧게 폴링하며 그 프로세스가 저장할 새
    // 토큰을 기다린다(최대 약 LOCK_TTL_MS만큼).
    const gotLock = await acquireIssueLock();
    if (!gotLock) {
      // 짧은 타임아웃을 가진 라우트(waitForLock:false)는 최대 9.6초짜리 폴링을
      // 기다리다가 자기 라우트의 타임아웃에 걸려 요청째로 잘리느니, 즉시 실패를
      // 반환해 호출부가 캐시/폴백으로 바로 넘어가게 한다.
      if (!waitForLock) {
        console.log('[KIS] 다른 프로세스가 발급 중 — waitForLock:false라 즉시 폴백');
        const err = new KisTokenIssueError('다른 프로세스가 토큰 발급 중 (대기하지 않음)');
        throw err;
      }
      console.log('[KIS] 다른 프로세스가 발급 중 — 대기 후 재확인');
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));
        try {
          const { data: waited } = await supabaseAdmin
            .from('kis_tokens')
            .select('access_token, expired_at')
            .gt('id', 0)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(1)
            .single();
          if (waited?.access_token && waited?.expired_at) {
            const remainingMs = new Date(waited.expired_at).getTime() - Date.now();
            if (remainingMs > 10 * 60 * 1000) {
              console.log('[KIS] 대기 중 다른 프로세스가 발급한 토큰 확인, 재사용');
              tokenCache = { token: waited.access_token, expiresAt: new Date(waited.expired_at).getTime() };
              return waited.access_token;
            }
          }
        } catch {
          // 무시하고 다음 폴링 시도
        }
      }
      const err = new KisTokenIssueError('다른 프로세스가 토큰 발급 중이라 대기했지만 시간 내에 완료되지 않았습니다');
      lastIssueFailure = { at: Date.now(), error: err };
      throw err;
    }

    try {
      console.log('[KIS] 새 토큰 발급 요청');
      const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: process.env.KIS_APP_KEY,
          appsecret: process.env.KIS_APP_SECRET,
        }),
        cache: 'no-store',
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new KisTokenIssueError(`KIS 토큰 발급 실패 [${res.status}]: ${text}`);
        lastIssueFailure = { at: Date.now(), error: err };
        throw err;
      }

      const data = await res.json();
      const expiresAt = new Date(Date.now() + (data.expires_in ?? 86400) * 1000);
      tokenCache = { token: data.access_token, expiresAt: expiresAt.getTime() };
      lastIssueFailure = null;

      // 5) 새 토큰 저장 — 예전엔 기존 행을 전부 지우고 새로 넣었는데, 그러면 재발급
      // 이력이 하나도 안 남아 "오늘 몇 번, 몇 시에 재발급됐는지"를 나중에 확인할 방법이
      // Vercel 로그(보존 기간이 짧음)뿐이었다(2026-07-08 재발급 빈도 조사 때 직접 겪음).
      // 이제는 지우지 않고 계속 쌓되, 최근 50건만 남기고 오래된 건 정리한다 — 조회는
      // 여전히 created_at 최신 1건만 보므로 캐시 동작에는 영향 없음.
      try {
        // insert()의 반환값(error)을 확인하지 않고 무조건 "저장 완료"를 로그로
        // 남기던 버그가 있었다 — Supabase-js는 DB 에러(예: PK 충돌)를 던지지
        // 않고 { error }로만 알려주는데, 이걸 체크 안 하면 매번 저장이 실패해도
        // 로그는 계속 성공이라고 거짓말을 한다(2026-07-10 kis_tokens.id 시퀀스
        // 미설정으로 실제 이 버그가 발생해, 로그만 성공이고 DB엔 새 토큰이 단
        // 한 번도 저장되지 않던 것을 발견).
        const { error: insertError } = await supabaseAdmin.from('kis_tokens').insert({
          access_token: data.access_token,
          expired_at: expiresAt.toISOString(),
        });
        if (insertError) {
          console.error('[KIS] 토큰 저장 실패(insert 에러):', insertError);
        } else {
          console.log('[KIS] 새 토큰 저장 완료, 만료:', expiresAt.toISOString());

          const { data: history } = await supabaseAdmin
            .from('kis_tokens')
            .select('id')
            .gt('id', 0)
            .order('created_at', { ascending: false })
            .range(50, 1000);
          if (history && history.length > 0) {
            await supabaseAdmin.from('kis_tokens').delete().in('id', history.map((r) => r.id));
          }
        }
      } catch (e) {
        console.error('[KIS] 토큰 저장 실패:', e);
      }

      return data.access_token;
    } finally {
      await releaseIssueLock();
    }
  })().finally(() => {
    tokenFetchPromise = null;
  });

  return tokenFetchPromise;
}

// 캐시된 토큰이 KIS에 의해 (다른 프로세스의 재발급 등으로) 조기 무효화된 경우
// 강제로 새 토큰을 발급받도록 캐시를 비운다.
//
// 2026-07-10 사고: 예전엔 여기서 `.delete().neq('id', 0)`로 kis_tokens 테이블
// 전체를 지웠다. 이 인스턴스가 들고 있던 (오래된) in-memory 토큰이 무효화됐다고
// 해서 Supabase에 저장된 "현재" 토큰까지 나쁘다는 보장은 없는데 — 오히려 다른
// 프로세스가 그 사이 정상적으로 재발급해 저장해 둔 새 토큰까지 함께 지워버렸다.
// 그러면 그 새 토큰을 쓰려던 다른 인스턴스도 다음 호출에서 "토큰 없음"을 만나
// 또 재발급을 시도하고, 그 재발급이 방금 것을 다시 무효화하고 — 하는 식으로
// 인스턴스 여러 개가 서로의 토큰을 계속 무효화시키는 사슬이 만들어졌다(짧게는
// 1분 간격으로 재발급이 반복된 원인). 이제는 "이 토큰이 나쁘다"고 알고 있는
// 경우 그 토큰과 정확히 일치하는 행만 지운다 — badToken을 모르면(레거시 호출부)
// 로컬에 캐시돼 있던 토큰으로 대체하고, 그마저도 없으면 Supabase는 건드리지
// 않는다(이미 다른 프로세스가 갱신했을 수 있으므로).
export async function invalidateAccessToken(badToken?: string): Promise<void> {
  const target = badToken ?? tokenCache?.token ?? null;
  tokenCache = null;
  if (!target) return;
  try {
    const { data, error } = await supabaseAdmin
      .from('kis_tokens')
      .delete()
      .eq('access_token', target)
      .select('id');
    if (error) throw error;
    // 2026-07-10 사고 후속 진단용 — 어떤 토큰이 왜 지워졌는지 추적하기 위해
    // 성공 시에도 남긴다(기존엔 실패 시에만 로그가 있었음).
    console.warn('[KIS] 토큰 삭제됨(조기 만료 감지):', {
      tokenTail: target.slice(-12),
      deletedRowIds: data?.map((r) => r.id) ?? [],
      badTokenExplicit: !!badToken,
    });
  } catch (e) {
    console.error('[KIS] 토큰 캐시 삭제 실패:', e);
  }
}

function headers(token: string, trId: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=UTF-8',
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
  };
}

function signedChange(abs: string, signCode: string): number {
  const isDown = signCode === '4' || signCode === '5';
  return Math.abs(parseFloat(abs)) * (isDown ? -1 : 1);
}

function formatMarketCap(avlsUk: number): string {
  // hts_avls 단위: 억원
  const jo = avlsUk / 10000;
  if (jo >= 1) return `${jo.toFixed(1)}T`;
  return `${avlsUk.toLocaleString()}B`;
}

function formatTradingValue(pbmnWon: number): string {
  // acml_tr_pbmn 단위: 원
  const uk = pbmnWon / 100_000_000;
  return `${uk.toFixed(1)}B`;
}

// KIS가 캐시된 토큰을 조기 무효화했을 때 반환하는 코드 (다른 프로세스의 재발급 등으로 발생)
const EXPIRED_TOKEN_CODES = new Set(['EGW00123', 'EGW00121']);

// KIS 초당 거래건수 초과 — 토큰 만료와 원인이 완전히 다르므로(계정 전체의 순간 처리량
// 초과 vs 이 토큰 개별 무효화) EXPIRED_TOKEN_CODES와 별도로 분리해 관리한다.
const RATE_LIMIT_CODE = 'EGW00201';

// 개별 API 호출에서 "이 토큰이 조기 만료됐다"고 감지된 경우 — 다른 프로세스가 이미
// 새 토큰을 발급했다는 뜻이라, 캐시를 비우고 다시 시도하면 대개 성공한다
// (withKisTokenRetry가 처리).
export class KisTokenExpiredError extends Error {}

// getAccessToken() 자체가 KIS로부터 새 토큰 발급을 거부당한 경우(주로 EGW00133
// "1분당 1회" 레이트리밋). KisTokenExpiredError와 의도적으로 구분한다 — 이건 "다른
// 프로세스가 이미 새 토큰을 갖고 있다"는 뜻이 아니라 "지금은 아무도 새 토큰을 못
// 받는다"는 뜻이라, 즉시 재시도해도 똑같이 실패할 뿐이다. withKisTokenRetry는
// KisTokenExpiredError만 잡아 재시도하므로 이 타입은 자동으로 재시도 대상에서
// 제외된다 — 실패가 또 다른 실패(무의미한 재시도)를 유발하지 않도록.
export class KisTokenIssueError extends Error {}

// KIS 응답의 msg_cd가 토큰 조기 만료 코드인 경우 KisTokenExpiredError를 던진다.
// 호출부는 rt_cd 체크보다 먼저 이 함수를 호출해 토큰 만료를 구분해야 한다.
export function assertKisTokenValid(data: any, label: string): void {
  const msgCd = data?.msg_cd as string | undefined;
  if (msgCd && EXPIRED_TOKEN_CODES.has(msgCd)) {
    throw new KisTokenExpiredError(`${label} 토큰 조기 만료(${msgCd})`);
  }
}

// KisTokenExpiredError 발생 시 토큰을 무효화하고 fn()을 한 번만 재시도한다.
// ranking/movers/alerts 등 kis-api.ts 밖에서 직접 KIS를 호출하는 라우트에서 사용.
export async function withKisTokenRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof KisTokenExpiredError) {
      console.warn('[KIS]', e.message, '- 토큰 재발급 후 재시도');
      await invalidateAccessToken();
      return await fn();
    }
    throw e;
  }
}

// 전역 KIS 레이트리미터 — KIS_APP_KEY를 쓰는 모든 호출자(대시보드/관심종목 라우트,
// market-cache-warm/daily-alert-email/stock-alerts 크론)가 서버리스 인스턴스 경계를
// 넘어 공유해야 하는 상태라 인메모리로는 불가능하다. 2026-08-24 실측: 단독 호출자는
// 로컬 청크 스로틀링(3개/250ms)만으로 0건 실패, 여러 청크를 간격 없이 겹쳐 쏘면(=여러
// 인스턴스가 동시에 KIS를 두드리는 상황 재현) 즉시 EGW00201 발생 — 매번 다른 종목이
// 무작위로 걸려 특정 티커 문제가 아님을 확인. kis_tokens의 발급 락(sentinel row INSERT
// 충돌)과 같은 결로, Postgres 단일 행 `FOR UPDATE` 잠금을 이용한 토큰버킷으로 여러
// 인스턴스의 호출을 초당 한도 아래로 직렬화한다.
//
// 초당 15개(버스트 15)는 KIS가 공식 문서화한 계정별 한도가 아니라, 2026-08-24 실측
// 버스트 테스트(간격 없이 30건을 쏘면 4건 실패 시작)에서 잡은 보수적 추정치 — 더 정확한
// 값을 알게 되면 이 상수만 조정하면 된다.
const KIS_RATE_LIMIT_PER_SEC = 15;
const KIS_RATE_LIMIT_BURST = 15;
const RATE_SLOT_MAX_WAIT_MS = 5000;

export async function acquireKisRateSlot(): Promise<void> {
  const deadline = Date.now() + RATE_SLOT_MAX_WAIT_MS;
  for (;;) {
    const { data, error } = await supabaseAdmin.rpc('kis_acquire_rate_slot', {
      p_rate: KIS_RATE_LIMIT_PER_SEC,
      p_burst: KIS_RATE_LIMIT_BURST,
    });
    if (error) {
      // 리미터 자체가 죽었다고 KIS 조회 전체를 막을 수는 없다 — 게이트 없이 진행한다
      // (로컬 청크 스로틀링 + queryPrice의 EGW00201 재시도가 안전망으로 남는다).
      console.warn('[KIS] 레이트리미터 RPC 실패, 게이트 없이 진행:', error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed) return;
    if (Date.now() >= deadline) {
      console.warn('[KIS] 레이트리미터 대기 시간 초과, 게이트 없이 진행');
      return;
    }
    const waitMs = Math.min(Math.max(Number(row?.wait_ms) || 70, 30), 1000);
    await new Promise((r) => setTimeout(r, waitMs + Math.random() * 20));
  }
}

// 국내주식 시세 조회 — FID_COND_MRKT_DIV_CODE는 KOSPI/KOSDAQ 무관하게 항상 'J' 고정
// ('Q'는 KIS가 무조건 거부하는 값이라 재시도 낭비 방지 차원에서 제거)
async function queryPrice(
  ticker: string,
  _retried = false,
  opts?: { waitForLock?: boolean },
  _rateRetried = false,
): Promise<any> {
  const token = await getAccessToken(opts);
  await acquireKisRateSlot();

  const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
  url.searchParams.set('FID_INPUT_ISCD', ticker);

  const res = await fetch(url.toString(), {
    headers: headers(token, 'FHKST01010100'),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || data.rt_cd !== '0') {
    const msgCd = data?.msg_cd as string | undefined;
    if (!_retried && msgCd && EXPIRED_TOKEN_CODES.has(msgCd)) {
      console.warn(`[KIS] ${ticker} 캐시 토큰 조기 만료 감지(${msgCd}), 토큰 재발급 후 재시도`);
      await invalidateAccessToken(token); // 방금 실패에 쓰인 토큰만 지정해서 지움(다른 프로세스의 최신 토큰 보호)
      return queryPrice(ticker, true, opts, _rateRetried);
    }
    // 전역 게이트를 통과했는데도 초당 한도에 걸린 잔여 케이스(여러 인스턴스의 타이밍이
    // 우연히 겹친 경우 등) — 토큰만료와는 원인이 달라 재시도 카운터를 분리해 관리한다.
    // 재시도도 다시 게이트를 거치므로(재귀 호출 상단의 acquireKisRateSlot) 무한정 KIS를
    // 두드리지 않는다.
    if (!_rateRetried && msgCd === RATE_LIMIT_CODE) {
      const delay = 200 + Math.random() * 300;
      console.warn(`[KIS] ${ticker} 초당 거래건수 초과(${msgCd}), ${Math.round(delay)}ms 후 재시도`);
      await new Promise((r) => setTimeout(r, delay));
      return queryPrice(ticker, _retried, opts, true);
    }
    // "종목이 없다"는 특정 원인 하나로 단정하지 않는다 — 토큰/레이트리밋 등 다른
    // 이유일 수 있어 msg_cd/msg1을 그대로 노출해야 나중에 원인 추적이 된다
    // (2026-07-10 사고 때 이 메시지가 "종목 없음"으로만 보여서 원인 파악이 늦어졌다).
    throw new Error(`KIS 시세 조회 실패: ${ticker} [HTTP ${res.status}]${data?.msg_cd ? ` (${data.msg_cd})` : ''}${data?.msg1 ? ` ${data.msg1}` : ''}`);
  }

  return data.output;
}

export async function fetchStockPrice(ticker: string, opts?: { waitForLock?: boolean }): Promise<StockPrice> {
  const o = await queryPrice(ticker, false, opts);
  const name = await resolveStockName(ticker, o);
  // rprs_mrkt_kor_name 예시: "KOSPI200"(코스피), "KOSDAQ"/"KSQ150"(코스닥)
  const marketLabel = String(o.rprs_mrkt_kor_name ?? '');
  const market: 'KOSPI' | 'KOSDAQ' = /KOSDAQ|KSQ/i.test(marketLabel) ? 'KOSDAQ' : 'KOSPI';

  return {
    ticker,
    name,
    price: parseInt(o.stck_prpr, 10),
    change: signedChange(o.prdy_vrss, o.prdy_vrss_sign),
    changeRate: signedChange(o.prdy_ctrt, o.prdy_vrss_sign),
    volume: parseInt(o.acml_vol, 10),
    tradingValue: formatTradingValue(parseInt(o.acml_tr_pbmn, 10)),
    sector: (o.bstp_kor_isnm ?? '').trim(),
    market,
  };
}

export async function fetchStockInfo(ticker: string): Promise<StockInfo> {
  const o = await queryPrice(ticker);
  return {
    ticker,
    week52High: parseInt(o.w52_hgpr, 10),
    week52Low: parseInt(o.w52_lwpr, 10),
    marketCap: formatMarketCap(parseInt(o.hts_avls, 10)),
    per: parseFloat(o.per) || 0,
    pbr: parseFloat(o.pbr) || 0,
    sector: (o.bstp_kor_isnm ?? '').trim(),
  };
}

// fetchStockPrice + fetchStockInfo가 둘 다 동일한 inquire-price 응답(queryPrice)에서
// 서로 다른 필드만 골라 쓰던 걸 한 호출로 합친 것 — 시세와 52주고저/시총/PER/PBR을
// 동시에 필요로 하는 호출부(대시보드 홀딩스 등)가 KIS 호출을 두 번 하지 않게 한다.
export async function fetchStockQuote(ticker: string, opts?: { waitForLock?: boolean }): Promise<StockPrice & Pick<StockInfo, 'week52High' | 'week52Low' | 'marketCap' | 'per' | 'pbr'>> {
  const o = await queryPrice(ticker, false, opts);
  const name = await resolveStockName(ticker, o);
  const marketLabel = String(o.rprs_mrkt_kor_name ?? '');
  const market: 'KOSPI' | 'KOSDAQ' = /KOSDAQ|KSQ/i.test(marketLabel) ? 'KOSDAQ' : 'KOSPI';

  return {
    ticker,
    name,
    price: parseInt(o.stck_prpr, 10),
    change: signedChange(o.prdy_vrss, o.prdy_vrss_sign),
    changeRate: signedChange(o.prdy_ctrt, o.prdy_vrss_sign),
    volume: parseInt(o.acml_vol, 10),
    tradingValue: formatTradingValue(parseInt(o.acml_tr_pbmn, 10)),
    sector: (o.bstp_kor_isnm ?? '').trim(),
    market,
    week52High: parseInt(o.w52_hgpr, 10),
    week52Low: parseInt(o.w52_lwpr, 10),
    marketCap: formatMarketCap(parseInt(o.hts_avls, 10)),
    per: parseFloat(o.per) || 0,
    pbr: parseFloat(o.pbr) || 0,
  };
}

// inquire-daily-itemchartprice 실제 호출 — FID_INPUT_DATE_1/2로 넓은 범위를 요청해도
// KIS가 응답을 최근 100건(거래일)으로 잘라서 돌려준다(2026-07-30 실측 확인: 1년 범위로
// 요청해도 최근 ~5개월치만 옴). fetchDailyChart(기간 탭)와 fetchChartNear(특정 과거일
// 근방 조회) 둘 다 이 100건 캡 안에서만 신뢰할 수 있으므로, 넓은 범위가 필요한 쪽은
// 호출부가 알아서 좁은 창을 골라 요청해야 한다.
async function fetchChartRangeRaw(
  ticker: string,
  startDate: Date,
  endDate: Date,
  label: string,
): Promise<ChartDataPoint[]> {
  // 토큰 조기 만료 감지가 없던 함수 — 만료된 토큰으로 J/Q를 번갈아 시도해봐야 둘 다
  // 같은 이유로 실패할 뿐이라, 감지 즉시 상위 withKisTokenRetry가 재발급 후 한 번
  // 다시 시도하게 한다(2026-07-10 코드 리뷰에서 발견).
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();

    const fmt = (d: Date) =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

    for (const mktCode of ['J', 'Q']) {
      const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`);
      url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
      url.searchParams.set('FID_INPUT_ISCD', ticker);
      url.searchParams.set('FID_INPUT_DATE_1', fmt(startDate));
      url.searchParams.set('FID_INPUT_DATE_2', fmt(endDate));
      url.searchParams.set('FID_PERIOD_DIV_CODE', 'D');
      url.searchParams.set('FID_ORG_ADJ_PRC', '0');

      await acquireKisRateSlot();
      const res = await fetch(url.toString(), {
        headers: headers(token, 'FHKST03010100'),
        cache:   'no-store',
        signal:  AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const data = await res.json();
      assertKisTokenValid(data, label);
      if (data.rt_cd !== '0' || !Array.isArray(data.output2) || data.output2.length === 0) continue;

      // KIS는 최신순 → 오래된순으로 반환. 차트용으로 역순 정렬
      return data.output2
        .filter((item: any) => item.stck_clpr && item.stck_clpr !== '0')
        .reverse()
        .map((item: any) => ({
          date: `${item.stck_bsop_date.slice(0, 4)}-${item.stck_bsop_date.slice(4, 6)}-${item.stck_bsop_date.slice(6, 8)}`,
          open: parseInt(item.stck_oprc, 10),
          high: parseInt(item.stck_hgpr, 10),
          low: parseInt(item.stck_lwpr, 10),
          close: parseInt(item.stck_clpr, 10),
          volume: parseInt(item.acml_vol, 10),
          tradingValue: Number(item.acml_tr_pbmn) || undefined,
        }));
    }

    throw new Error(`차트 데이터를 찾을 수 없습니다: ${ticker}`);
  });
}

// 2026-08-28: 1년치 일봉(fetchDailyChart(ticker, '1Y'))이 dashboard/risk, stock/[ticker]/chart,
// portfolio-diagnosis/dashboard/analysis(정량지표) 3곳에서 캐시 공유 없이 각자 KIS를 독립
// 호출하던 중복을 여기(fetchDailyChart 자체)로 끌어내려 정리 — app/api/stock/[ticker]/chart
// 라우트가 쓰던 market_cache TTL 패턴을 그대로 재사용한다(장중 5분/장외 1시간, 과거 봉은
// 하루 1회만 바뀌므로 분 단위 정밀도 불필요). 대시보드를 먼저 본 뒤 곧바로 같은 종목으로
// 기업분석/포트폴리오분석을 실행해도 이제 캐시를 공유해 KIS 재조회가 생략된다.
// 1W/1M/3M는 호출부가 적고(사용자가 직접 고른 기간 탭, 섹터 peer 비교 등) 캐시로 얻는
// 이득보다 신선도가 더 중요하다고 판단해 기존처럼 캐시 없이 항상 라이브 조회한다.
const CHART_1Y_CACHE_TTL_MS_OPEN   = 5 * 60_000;  // 장중 5분
const CHART_1Y_CACHE_TTL_MS_CLOSED = 60 * 60_000; // 장외 1시간
const chartCacheKey = (ticker: string, period: string) => `stock_chart_${ticker}_${period}`;

// 라이브 조회가 완전히 실패했을 때(재시도까지 소진) 마지막으로 캐시된 값이라도 대신
// 내려주고 싶은 호출부(app/api/stock/[ticker]/chart 등)를 위해 export — TTL과 무관하게
// 캐시가 존재하는지만 확인한다(신선도 판단은 호출부 책임).
export async function loadDailyChartCache(
  ticker: string,
  period: '1W' | '1M' | '3M' | '1Y'
): Promise<{ data: ChartDataPoint[]; updatedAt: string } | null> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', chartCacheKey(ticker, period))
      .single();
    if (!cache?.data) return null;
    return { data: cache.data as unknown as ChartDataPoint[], updatedAt: cache.updated_at };
  } catch {
    return null;
  }
}

async function saveDailyChartCache(ticker: string, period: '1Y', data: ChartDataPoint[]): Promise<void> {
  try {
    const { error } = await supabase
      .from('market_cache')
      .upsert({ key: chartCacheKey(ticker, period), data: data as unknown as Json, updated_at: new Date().toISOString() });
    if (error) console.warn(`[fetchDailyChart] ${ticker}(${period}) 캐시 저장 실패:`, error.message);
  } catch (e) {
    console.warn(`[fetchDailyChart] ${ticker}(${period}) 캐시 저장 예외:`, e instanceof Error ? e.message : e);
  }
}

export async function fetchDailyChart(
  ticker: string,
  period: '1W' | '1M' | '3M' | '1Y'
): Promise<ChartDataPoint[]> {
  if (period === '1Y') {
    const ttlMs = isKoreanMarketOpen() ? CHART_1Y_CACHE_TTL_MS_OPEN : CHART_1Y_CACHE_TTL_MS_CLOSED;
    const fresh = await loadDailyChartCache(ticker, period);
    if (fresh && Date.now() - new Date(fresh.updatedAt).getTime() < ttlMs) {
      return fresh.data;
    }
  }

  const endDate = new Date();
  const startDate = new Date();
  switch (period) {
    case '1W': startDate.setDate(endDate.getDate() - 7); break;
    case '1M': startDate.setMonth(endDate.getMonth() - 1); break;
    case '3M': startDate.setMonth(endDate.getMonth() - 3); break;
    case '1Y': startDate.setFullYear(endDate.getFullYear() - 1); break;
  }
  const data = await fetchChartRangeRaw(ticker, startDate, endDate, `fetchDailyChart(${ticker})`);

  if (period === '1Y') {
    await saveDailyChartCache(ticker, period, data);
  }

  return data;
}

// 종목분석 페이지 "1년 전 대비" 배지 전용 — fetchDailyChart('1Y')는 100건 캡 때문에
// 실제로는 최근 ~5개월치만 반환해 1년 전 시점에 닿지 못한다(위 fetchChartRangeRaw 주석
// 참고). targetDate 좌우로 좁은 창만 요청해 100건 캡 안에서 정확히 그 근방 종가를 받는다.
// 과거 방향 14일 여유는 설/추석 등 최대 5일 연휴 + 주말이 겹쳐도 직전 거래일을 찾기에
// 충분하다.
export async function fetchChartNear(ticker: string, targetDate: Date): Promise<ChartDataPoint[]> {
  const endDate = new Date(targetDate);
  const startDate = new Date(targetDate);
  startDate.setDate(startDate.getDate() - 14);
  try {
    return await fetchChartRangeRaw(ticker, startDate, endDate, `fetchChartNear(${ticker})`);
  } catch {
    return [];
  }
}

// 2026-08-03: PriceChangeTable "기간 중 최고가/최저가"가 near12(12개월 전 근방 14일
// 창)·near6(6개월 전 근방 14일 창)·main(1Y 요청해도 실제로는 최근 ~100거래일)을
// 병합해서 max/min을 구하는데, 세 조각이 서로 이어지지 않아 사이 구간(near12~near6
// 사이 약 6개월, near6~main 사이 약 1개월)에 공백이 생기고 그 구간의 실제 고점/저점이
// 조용히 누락되는 버그를 S-Oil(010950)로 실측 확인(2026-03-04 고가 177,100원이 세
// 조각 어디에도 없어 156,500원으로 낮게 계산됨). fetchChartNear가 endDate를 과거로
// 옮겨도 "그 endDate 기준 최근 ~100거래일"을 정확히 돌려준다는 점(오늘 기준이 아님)을
// 이용해, 오늘부터 targetDate까지 청크의 시작일을 다음 청크의 종료일로 삼아 뒤로
// 연쇄 호출하면 빈틈없이 이어붙일 수 있다. 청크당 거래일 수를 하드코딩으로 가정하지
// 않고 실제 응답의 최초 날짜를 다음 앵커로 쓰므로 종목별 캡 편차에 안전하다.
export async function fetchChartBackTo(
  ticker: string,
  targetDate: Date,
  maxChunks = 4,
): Promise<ChartDataPoint[]> {
  const targetStr = targetDate.toISOString().slice(0, 10);
  const merged = new Map<string, ChartDataPoint>();
  let cursorEnd = new Date();

  for (let i = 0; i < maxChunks; i++) {
    const cursorStart = new Date(cursorEnd);
    cursorStart.setFullYear(cursorStart.getFullYear() - 2); // 넉넉히 잡아도 KIS가 알아서 최근 구간으로 잘라 반환
    let chunk: ChartDataPoint[];
    try {
      chunk = await fetchChartRangeRaw(ticker, cursorStart, cursorEnd, `fetchChartBackTo(${ticker})#${i}`);
    } catch {
      break;
    }
    if (chunk.length === 0) break;

    for (const p of chunk) merged.set(p.date, p);

    const earliest = chunk[0].date; // fetchChartRangeRaw는 이미 오름차순 정렬
    if (earliest <= targetStr) break; // targetDate까지 도달 완료

    const nextEnd = new Date(earliest);
    nextEnd.setDate(nextEnd.getDate() - 1);
    cursorEnd = nextEnd;
  }

  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchMarketIndex(
  indexCode: string,
  signal?: AbortSignal,
  opts?: { waitForLock?: boolean }
): Promise<MarketIndexData> {
  // 토큰 조기 만료 감지가 없던 함수 — /api/market이 지수 14개를 매번 호출하는 만큼
  // 만료 임박 구간에 가장 자주 걸리던 지점이었다(2026-07-10 코드 리뷰에서 발견).
  return withKisTokenRetry(async () => {
    const token = await getAccessToken(opts);

    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-index-price`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'U');
    url.searchParams.set('FID_INPUT_ISCD', indexCode);

    const res = await fetch(url.toString(), {
      headers: headers(token, 'FHPUP02100000'),
      cache: 'no-store',
      signal,
    });

    if (!res.ok) throw new Error(`지수 조회 실패 [${res.status}]`);

    const data = await res.json();
    assertKisTokenValid(data, `fetchMarketIndex(${indexCode})`);
    if (data.rt_cd !== '0') throw new Error(`지수 오류: ${data.msg1}`);

    const o = data.output;
    return {
      value: parseFloat(o.bstp_nmix_prpr),
      change: signedChange(o.bstp_nmix_prdy_vrss, o.prdy_vrss_sign),
      changeRate: signedChange(o.bstp_nmix_prdy_ctrt, o.prdy_vrss_sign),
    };
  });
}

interface IndexPoint { date: string; close: number }

// inquire-daily-indexchartprice 실제 호출 1회 — inquire-daily-itemchartprice(종목 차트)와
// 마찬가지로 요청 범위와 무관하게 KIS가 최근 일부 구간만 반환할 수 있다(2026-08-03 실측
// 확인: KOSPI 1년 전/6개월 전을 각각 요청해도 실제 반환 startDate가 둘 다 동일하게
// ~2.5개월 전 — fetchChartRangeRaw와 동일한 부류의 문제). 이 함수는 "한 번의 요청"만
// 담당하고, 실제 반환 범위가 요청과 다를 수 있다는 판단은 호출부(fetchIndexBackTo)가 한다.
async function fetchIndexRangeRaw(
  indexCode: string,
  startDate: Date,
  endDate: Date,
  label: string,
): Promise<IndexPoint[]> {
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();
    const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'U');
    url.searchParams.set('FID_INPUT_ISCD', indexCode);
    url.searchParams.set('FID_INPUT_DATE_1', fmt(startDate));
    url.searchParams.set('FID_INPUT_DATE_2', fmt(endDate));
    url.searchParams.set('FID_PERIOD_DIV_CODE', 'D');

    const res = await fetch(url.toString(), {
      headers: headers(token, 'FHKUP03500100'),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    assertKisTokenValid(data, label);
    if (data.rt_cd !== '0') return [];

    return (data.output2 ?? [])
      .filter((r: any) => r.bstp_nmix_prpr && r.stck_bsop_date)
      .reverse() // 오래된순 정렬
      .map((r: any) => ({
        date: `${r.stck_bsop_date.slice(0,4)}-${r.stck_bsop_date.slice(4,6)}-${r.stck_bsop_date.slice(6,8)}`,
        close: parseFloat(r.bstp_nmix_prpr),
      }));
  });
}

// fetchChartBackTo(종목 차트)와 동일한 방식 — endDate를 과거로 옮겨가며 연쇄 호출해
// targetDate까지 빈틈없이 이어붙인다. 청크 길이를 하드코딩으로 가정하지 않고 실제
// 응답의 최초 날짜를 다음 앵커로 쓴다. 포트폴리오/기업분석의 벤치마크 비교는 매수일이
// 몇 년 전일 수도 있어 종목 차트(maxChunks=4)보다 상한을 넉넉히(8청크 ≈ 3년 안팎) 둔다.
async function fetchIndexBackTo(
  indexCode: string,
  targetDate: Date,
  maxChunks = 8,
): Promise<IndexPoint[]> {
  const targetStr = targetDate.toISOString().slice(0, 10);
  const merged = new Map<string, IndexPoint>();
  let cursorEnd = new Date();

  for (let i = 0; i < maxChunks; i++) {
    const cursorStart = new Date(cursorEnd);
    cursorStart.setFullYear(cursorStart.getFullYear() - 2);
    let chunk: IndexPoint[];
    try {
      chunk = await fetchIndexRangeRaw(indexCode, cursorStart, cursorEnd, `fetchIndexBackTo(${indexCode})#${i}`);
    } catch {
      break;
    }
    if (chunk.length === 0) break;

    for (const p of chunk) merged.set(p.date, p);

    const earliest = chunk[0].date;
    if (earliest <= targetStr) break;

    const nextEnd = new Date(earliest);
    nextEnd.setDate(nextEnd.getDate() - 1);
    cursorEnd = nextEnd;
  }

  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// 지수(예: KOSPI 0001)의 특정 기간 등락률 — 벤치마크 비교용 (판단 없이 수치만 제공).
// 2026-08-03: 예전엔 단일 호출로 fromDate~toDate를 요청해 KIS가 뭘 반환하든 그대로
// "요청한 라벨"(1년 전/6개월 전 등)을 붙여 반환했다 — 요청 범위가 넓을수록 KIS가
// 조용히 잘라서 실제로는 훨씬 짧은 구간(~2.5개월)만 오는데도 라벨은 그대로였다.
// fetchIndexBackTo로 fromDate까지 연쇄 백필한 뒤, 실제 fromDate 이후 데이터 중 가장
// 이른 지점을 "시작점"으로 써서 라벨과 실제 데이터 범위가 항상 일치하게 한다.
export async function fetchIndexRangeChange(
  indexCode: string,
  fromDate: Date,
  toDate: Date,
): Promise<{ startValue: number; endValue: number; changeRate: number; startDate: string; endDate: string } | null> {
  try {
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = toDate.toISOString().slice(0, 10);
    const rows = await fetchIndexBackTo(indexCode, fromDate);
    const inRange = rows.filter((r) => r.date >= fromStr && r.date <= toStr);
    if (inRange.length < 2) return null;

    const first = inRange[0];
    const last  = inRange[inRange.length - 1];
    if (!(first.close > 0) || !(last.close > 0)) return null;

    return {
      startValue: first.close,
      endValue: last.close,
      changeRate: ((last.close - first.close) / first.close) * 100,
      startDate: first.date,
      endDate: last.date,
    };
  } catch (e) {
    console.error('[KIS] fetchIndexRangeChange 실패:', e);
    return null;
  }
}


// 인기 종목 20개 당일 시세 조회 후 등락률 정렬 → 급등/급락 대체
// [ticker, market] — J=KOSPI, Q=KOSDAQ, X=both 시도
export const CURATED_TICKERS_MKT: [string, 'J' | 'Q' | 'X'][] = [
  // KOSPI 대형주
  ['005930', 'J'], ['000660', 'J'], ['005380', 'J'], ['000270', 'J'], ['005490', 'J'],
  ['035420', 'J'], ['207940', 'J'], ['051910', 'J'], ['006400', 'J'], ['028260', 'J'],
  ['012330', 'J'], ['009150', 'J'], ['032830', 'J'], ['015760', 'J'], ['034730', 'J'],
  ['017670', 'J'], ['030200', 'J'], ['055550', 'J'], ['105560', 'J'], ['086790', 'J'],
  ['316140', 'J'], ['003490', 'J'], ['011200', 'J'], ['096770', 'J'], ['010950', 'J'],
  ['018260', 'J'], ['000810', 'J'], ['033780', 'J'], ['009830', 'J'], ['051600', 'J'],
  ['010130', 'J'], ['024110', 'J'], ['128940', 'J'], ['008770', 'J'], ['003550', 'J'],
  ['097950', 'J'], ['047050', 'J'], ['004020', 'J'], ['005440', 'J'], ['006280', 'J'],
  ['000100', 'J'], ['007070', 'J'], ['001800', 'J'], ['088350', 'J'], ['008560', 'J'],
  ['011790', 'J'], ['001040', 'J'], ['004990', 'J'], ['139480', 'J'], ['021240', 'J'],
  // KOSDAQ 대형주
  ['035720', 'Q'], ['086520', 'Q'], ['373220', 'Q'], ['003670', 'Q'], ['042700', 'Q'],
  ['000990', 'Q'], ['263750', 'Q'], ['247540', 'Q'], ['196170', 'Q'], ['018290', 'Q'],
  ['091990', 'Q'], ['214150', 'Q'], ['145020', 'Q'], ['357780', 'Q'], ['028300', 'Q'],
  ['122630', 'Q'], ['294870', 'Q'], ['045390', 'Q'], ['058470', 'Q'], ['041510', 'Q'],
  ['024770', 'Q'], ['068270', 'Q'], ['095340', 'Q'], ['039030', 'Q'], ['057540', 'Q'],
  ['263720', 'Q'], ['383310', 'Q'], ['241560', 'Q'], ['047310', 'Q'], ['950130', 'Q'],
  ['066970', 'Q'], ['052690', 'Q'], ['101360', 'Q'], ['251270', 'Q'], ['027360', 'Q'],
  ['065500', 'Q'], ['094360', 'Q'], ['131970', 'Q'], ['060150', 'Q'], ['140860', 'Q'],
  ['312610', 'Q'], ['236200', 'Q'], ['039440', 'Q'], ['220180', 'Q'], ['293490', 'Q'],
  ['140410', 'Q'], ['189300', 'Q'], ['323990', 'Q'], ['402340', 'Q'], ['048410', 'Q'],
];

// 하위 호환성을 위한 배열 (movers 등에서 사용)
const CURATED_TICKERS = CURATED_TICKERS_MKT.map(([t]) => t);

export async function fetchCuratedMovers(
  count = 5,
  opts?: { waitForLock?: boolean }
): Promise<{ gainers: MoverStock[]; losers: MoverStock[] }> {
  // 토큰 조기 만료 감지가 없던 함수 — 배치 중간에 만료되면 남은 종목들이 전부
  // Promise.allSettled에서 조용히 걸러져 에러 로그 하나 없이 급등락 목록만
  // 부실해졌다(2026-07-10 코드 리뷰에서 발견). 이제 만료를 감지하면 즉시 상위
  // withKisTokenRetry가 재발급 후 전체를 한 번 다시 시도한다.
  return withKisTokenRetry(async () => {
    const token = await getAccessToken(opts); // 토큰 1회 발급 후 공유

    const fetchTicker = async (ticker: string): Promise<MoverStock> => {
      for (const mktCode of ['J', 'Q']) {
        const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
        url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
        url.searchParams.set('FID_INPUT_ISCD', ticker);
        const res = await fetch(url.toString(), {
          headers: headers(token, 'FHKST01010100'),
          cache:   'no-store',
          signal:  AbortSignal.timeout(10000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        assertKisTokenValid(data, `fetchCuratedMovers(${ticker})`);
        if (data.rt_cd !== '0') continue;
        const o = data.output;
        return {
          ticker,
          name:       ((o.hts_kor_isnm || o.prdt_abrv_name || STOCK_NAMES[ticker] || ticker) as string).trim(),
          price:      parseInt(o.stck_prpr, 10),
          changeRate: signedChange(o.prdy_ctrt, o.prdy_vrss_sign),
        } satisfies MoverStock;
      }
      throw new Error(`종목 정보를 찾을 수 없습니다: ${ticker}`);
    };

    // 10개씩 배치 처리 — KIS API 동시 요청 과부하 방지
    const allSettled: PromiseSettledResult<MoverStock>[] = [];
    for (let i = 0; i < CURATED_TICKERS.length; i += 10) {
      const batch = CURATED_TICKERS.slice(i, i + 10);
      const batchResults = await Promise.allSettled(batch.map(fetchTicker));
      // 토큰 만료로 실패한 게 하나라도 있으면 나머지 배치를 계속 돌아봐야 똑같이
      // 실패할 뿐이니, 여기서 바로 던져서 상위 withKisTokenRetry가 처리하게 한다.
      const expired = batchResults.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected' && r.reason instanceof KisTokenExpiredError,
      );
      if (expired) throw expired.reason;
      allSettled.push(...batchResults);
      if (i + 10 < CURATED_TICKERS.length) await new Promise((r) => setTimeout(r, 300));
    }

    const stocks = allSettled
      .filter((r): r is PromiseFulfilledResult<MoverStock> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((s) => s.price > 0);

    stocks.sort((a, b) => b.changeRate - a.changeRate);

    // 상승 종목만 gainers, 하락 종목만 losers (방향 반대 종목 제외)
    const gainers = stocks.filter((s) => s.changeRate > 0).slice(0, count);
    const losers  = stocks.filter((s) => s.changeRate < 0).reverse().slice(0, count);

    return { gainers, losers };
  });
}

// 국내주식 급등/급락 순위 조회 (FHPST01700000)
// direction: 'up' = 상승률 순, 'down' = 하락률 순
// 참고: 2026-07-10 기준 app/api/market/ranking/route.ts가 동명의 로컬 함수를 따로
// 두고 있어(이미 withKisTokenRetry로 감쌈) 이 export는 현재 실제로 호출되는 곳이
// 없다. 그래도 토큰 만료 감지가 없는 채로 남겨두면 나중에 누가 그냥 갖다 쓸 때
// 똑같은 문제가 재현되므로 함께 고쳐둔다(2026-07-10 코드 리뷰에서 발견).
export async function fetchFluctuation(direction: 'up' | 'down', count = 5): Promise<MoverStock[]> {
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();

    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/ranking/fluctuation`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
    url.searchParams.set('FID_COND_SCR_DIV_CODE', '170');
    url.searchParams.set('FID_INPUT_ISCD', '0001');
    url.searchParams.set('FID_RANK_SORT_CLS_CODE', direction === 'up' ? '0' : '1');
    url.searchParams.set('FID_INPUT_CNT_1', '0');
    url.searchParams.set('FID_TRGT_CLS_CODE', '111111111');
    url.searchParams.set('FID_TRGT_EXLS_CLS_CODE', '000000');
    url.searchParams.set('FID_DIV_CLS_CODE', '0');
    url.searchParams.set('FID_INPUT_DATE_1', '');
    url.searchParams.set('FID_INPUT_PRICE_1', '');
    url.searchParams.set('FID_INPUT_PRICE_2', '');
    url.searchParams.set('FID_VOL_CNT', '');
    url.searchParams.set('FID_PRC_CLS_CODE', '0');
    url.searchParams.set('FID_RSFL_RATE1', '');
    url.searchParams.set('FID_RSFL_RATE2', '');
    url.searchParams.set('FID_RST_CLB_CODE', '');

    const res = await fetch(url.toString(), {
      headers: headers(token, 'FHPST01700000'),
      cache: 'no-store',
    });

    if (!res.ok) throw new Error(`급등락 조회 실패 [${res.status}]`);

    const data = await res.json();
    assertKisTokenValid(data, `fetchFluctuation(${direction})`);
    if (data.rt_cd !== '0') throw new Error(`급등락 API 오류: ${data.msg1}`);

    const output: any[] = data.output ?? [];
    return output.slice(0, count).map((o) => ({
      ticker: o.stck_shrn_iscd,
      name:   o.hts_kor_isnm,
      price:  parseInt(o.stck_prpr || '0', 10),
      changeRate: signedChange(o.prdy_ctrt, o.prdy_vrss_sign),
    }));
  });
}

export interface InvestorFlowRankRow {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  netAmountAuk: number; // 억원 단위 (아래 PBMN_TO_AUK_DIVISOR 참고)
}

// [확인 완료, 2026-07-23 09:22 KST] frgn_ntby_tr_pbmn/orgn_ntby_tr_pbmn 단위 = 백만원(→ /100 = 억원).
// 실제 응답으로 직접 검증: SK하이닉스 행에서 frgn_ntby_qty(166,000주) × stck_prpr(1,924,000원)
// = 319,384,000,000원인데, frgn_ntby_tr_pbmn 원본값이 정확히 "319384" — 즉 raw × 1,000,000 = 실제 금액.
// SK스퀘어 매도 행(-25,000주 × 1,264,000원 = -31,600,000,000원 vs raw "-31600")에서도 동일하게 재확인.
// inquire-investor(FHKST01010900) 등 이 코드베이스의 다른 3곳과 동일한 단위 컨벤션.
const PBMN_TO_AUK_DIVISOR = 100;

// 국내기관_외국인 매매종목가집계 — 전 종목 대상 외국인/기관 순매수·순매도 상위 (FHPTJ04400000)
// ⚠ 증권사 직원이 장중 수기 집계한 근사치로, 입력 시각은 외국인 09:30/11:20/13:20/14:30,
// 기관종합 10:00/11:20/13:20/14:30 고정 — 그 이전 시각에 호출하면 빈 배열이 정상 응답이다.
export async function fetchInvestorFlowRanking(
  investorType: 'foreign' | 'institution',
  direction: 'inflow' | 'outflow',
  count = 5,
): Promise<InvestorFlowRankRow[]> {
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();

    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/foreign-institution-total`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'V');
    url.searchParams.set('FID_COND_SCR_DIV_CODE', '16449');
    url.searchParams.set('FID_INPUT_ISCD', '0000');       // 전체(코스피+코스닥)
    url.searchParams.set('FID_DIV_CLS_CODE', '1');         // 금액정렬
    url.searchParams.set('FID_RANK_SORT_CLS_CODE', direction === 'inflow' ? '0' : '1');
    url.searchParams.set('FID_ETC_CLS_CODE', investorType === 'foreign' ? '1' : '2');

    await acquireKisRateSlot();
    const res = await fetch(url.toString(), {
      headers: headers(token, 'FHPTJ04400000'),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`외국인/기관 매매종목가집계 조회 실패 [${res.status}]`);

    const data = await res.json();
    assertKisTokenValid(data, `fetchInvestorFlowRanking(${investorType},${direction})`);
    if (data.rt_cd !== '0') throw new Error(`외국인/기관 매매종목가집계 API 오류: ${data.msg1}`);

    const output: any[] = data.output ?? [];
    const amountField = investorType === 'foreign' ? 'frgn_ntby_tr_pbmn' : 'orgn_ntby_tr_pbmn';
    return output.slice(0, count).map((o) => ({
      ticker:       o.mksc_shrn_iscd,
      name:         o.hts_kor_isnm,
      price:        parseInt(o.stck_prpr || '0', 10),
      changeRate:   signedChange(o.prdy_ctrt, o.prdy_vrss_sign),
      netAmountAuk: Math.round(Number(o[amountField] || 0) / PBMN_TO_AUK_DIVISOR),
    }));
  });
}

// 100개 주요 종목의 당일 52주 신고가/신저가 갱신 여부 확인 (배치 처리)
export async function fetchCurated52wAlerts(): Promise<{ highAlerts: AlertStock[]; lowAlerts: AlertStock[] }> {
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();

    // 오늘 날짜 (KST) — YYYYMMDD 형식
    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayStr =
      `${kst.getFullYear()}` +
      `${String(kst.getMonth() + 1).padStart(2, '0')}` +
      `${String(kst.getDate()).padStart(2, '0')}`;

    type StockData = {
      ticker: string; name: string; price: number;
      high52w: number; low52w: number; high52wDate: string; low52wDate: string;
    };

    const fetchOne = async ([ticker, mkt]: [string, 'J' | 'Q' | 'X']): Promise<StockData | null> => {
      const markets = mkt === 'X' ? ['J', 'Q'] : [mkt];
      for (const mktCode of markets) {
        const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
        url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
        url.searchParams.set('FID_INPUT_ISCD', ticker);
        try {
          const res = await fetch(url.toString(), {
            headers: headers(token, 'FHKST01010100'),
            cache: 'no-store',
            signal: AbortSignal.timeout(4000),
          });
          if (!res.ok) continue;
          const data = await res.json();
          assertKisTokenValid(data, 'FHKST01010100');
          if (data.rt_cd !== '0') continue;
          const o = data.output;
          return {
            ticker,
            name:        await resolveStockName(ticker, o),
            price:       parseInt(o.stck_prpr, 10),
            high52w:     parseInt(o.w52_hgpr, 10),
            low52w:      parseInt(o.w52_lwpr, 10),
            high52wDate: (o.w52_hgpr_date as string) ?? '',
            low52wDate:  (o.w52_lwpr_date as string) ?? '',
          };
        } catch (e) {
          if (e instanceof KisTokenExpiredError) throw e;
          continue;
        }
      }
      return null;
    };

    // 20개씩 배치 처리하여 rate limit 회피
    const BATCH = 20;
    const allData: StockData[] = [];
    for (let i = 0; i < CURATED_TICKERS_MKT.length; i += BATCH) {
      const batch = CURATED_TICKERS_MKT.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(fetchOne));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) allData.push(r.value);
        else if (r.status === 'rejected' && r.reason instanceof KisTokenExpiredError) throw r.reason;
      }
    }

    const highAlerts: AlertStock[] = allData
      .filter((s) => s.high52wDate === todayStr && s.price > 0)
      .map((s) => ({ ticker: s.ticker, name: s.name, price: s.price, high52w: s.high52w }));

    const lowAlerts: AlertStock[] = allData
      .filter((s) => s.low52wDate === todayStr && s.price > 0)
      .map((s) => ({ ticker: s.ticker, name: s.name, price: s.price, low52w: s.low52w }));

    console.log(`[52W] 조회 완료: ${allData.length}개 종목, 신고가 ${highAlerts.length}개, 신저가 ${lowAlerts.length}개`);
    return { highAlerts, lowAlerts };
  });
}

// 관심종목 ticker 배열에 대해 당일 52주 신고가/신저가 갱신 여부 개별 확인
export async function fetchWatch52w(
  tickers: string[],
): Promise<{ highAlerts: AlertStock[]; lowAlerts: AlertStock[] }> {
  if (!tickers.length) return { highAlerts: [], lowAlerts: [] };

  return withKisTokenRetry(async () => {
    const token = await getAccessToken();

    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayStr =
      `${kst.getFullYear()}` +
      `${String(kst.getMonth() + 1).padStart(2, '0')}` +
      `${String(kst.getDate()).padStart(2, '0')}`;

    type StockData = {
      ticker: string; name: string; price: number;
      high52w: number; low52w: number; high52wDate: string; low52wDate: string;
    };

    const fetchOne = async (ticker: string): Promise<StockData | null> => {
      // KOSPI(J) 먼저 시도, 실패 시 KOSDAQ(Q)
      for (const mktCode of ['J', 'Q']) {
        try {
          const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`);
          url.searchParams.set('FID_COND_MRKT_DIV_CODE', mktCode);
          url.searchParams.set('FID_INPUT_ISCD', ticker);
          const res = await fetch(url.toString(), {
            headers: headers(token, 'FHKST01010100'),
            cache: 'no-store',
            signal: AbortSignal.timeout(4000),
          });
          if (!res.ok) continue;
          const data = await res.json();
          assertKisTokenValid(data, 'FHKST01010100');
          if (data.rt_cd !== '0') continue;
          const o = data.output;
          return {
            ticker,
            name:        await resolveStockName(ticker, o),
            price:       parseInt(o.stck_prpr, 10),
            high52w:     parseInt(o.w52_hgpr, 10),
            low52w:      parseInt(o.w52_lwpr, 10),
            high52wDate: (o.w52_hgpr_date as string) ?? '',
            low52wDate:  (o.w52_lwpr_date as string) ?? '',
          };
        } catch (e) {
          if (e instanceof KisTokenExpiredError) throw e;
          continue;
        }
      }
      return null;
    };

    // 3개씩 배치 처리 (rate limit 회피)
    const allData: StockData[] = [];
    for (let i = 0; i < tickers.length; i += 3) {
      const batch = tickers.slice(i, i + 3);
      const results = await Promise.allSettled(batch.map(fetchOne));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) allData.push(r.value);
        else if (r.status === 'rejected' && r.reason instanceof KisTokenExpiredError) throw r.reason;
      }
      if (i + 3 < tickers.length) await new Promise((r) => setTimeout(r, 300));
    }

    const highAlerts: AlertStock[] = allData
      .filter((s) => s.high52wDate === todayStr && s.price > 0)
      .map((s) => ({ ticker: s.ticker, name: s.name, price: s.price, high52w: s.high52w }));
    const lowAlerts: AlertStock[] = allData
      .filter((s) => s.low52wDate === todayStr && s.price > 0)
      .map((s) => ({ ticker: s.ticker, name: s.name, price: s.price, low52w: s.low52w }));

    console.log(
      `[52W-WATCH] 관심종목 조회: ${allData.length}/${tickers.length}개, 신고가: ${highAlerts.length}개, 신저가: ${lowAlerts.length}개`,
    );
    return { highAlerts, lowAlerts };
  });
}

// ── 연간 확정 재무제표 (기업분석 페이지 실적 추이용, 2026-07-13) ──────────────────
// app/api/stock/[ticker]/finance/route.ts에 있던 로직을 재사용 가능한 함수로 추출.
// 의도적으로 "최근 3개 연도의 확정 연간 실적"만 반환한다 — 분기 실적이나 "잠정실적"
// (장 마감 후 공시되는 속보성 실적, DART/거래소 공시 기반)은 다루지 않는다. KIS의
// financial-ratio/balance-sheet TR 자체가 정식 재무제표 기준이라 잠정실적 공시와는
// 별개의 파이프라인이고(2026-07-08 삼성전자 2분기 잠정실적 미반영 문의로 확인: 이
// 시점 KIS 데이터의 최신 분기 행도 202603(1분기)까지만 존재), 분기 데이터를
// 노출하려면 완전히 다른 데이터 소스(DART 공시 API 등) 연동이 필요하다.
// type(아닌 interface)으로 선언 — diagnosis route가 이 배열을 stock_diagnosis.result(jsonb)에
// 그대로 저장하는데, TS의 Json 타입 검사는 named interface를 index signature에 대입하는 걸
// 허용하지 않는다(선언 병합 가능성 때문에 "닫힌 타입"으로 보지 않음). type alias는 통과함.
export type AnnualFinancialRow = {
  year:            string;
  revenue:         number | null;
  operatingProfit: number | null;
  netIncome:       number | null;
  roe:             number | null;
};

async function fetchFinanceApi(token: string, trId: string, endpoint: string, ticker: string) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: ticker,
    FID_DIV_CLS_CODE: '0', // 연간
  });
  const res = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/finance/${endpoint}?${params}`, {
    headers: headers(token, trId),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${trId} HTTP ${res.status}`);
  const d = await res.json();
  if (d.rt_cd !== '0') throw new Error(d.msg1);
  return (d.output ?? []) as Record<string, string>[];
}

export async function fetchAnnualFinancials(ticker: string): Promise<AnnualFinancialRow[]> {
  const token = await getAccessToken();

  const [ratioRows, bsRows] = await Promise.all([
    fetchFinanceApi(token, 'FHKST66430200', 'financial-ratio', ticker),
    fetchFinanceApi(token, 'FHKST66430300', 'balance-sheet', ticker),
  ]);

  // ROE 값을 stac_yymm 기준으로 매핑
  const roeMap = new Map<string, number>();
  for (const r of bsRows) {
    const v = parseFloat(r.roe_val);
    if (!isNaN(v) && v !== 99.99) roeMap.set(r.stac_yymm, v);
  }

  // FID_DIV_CLS_CODE='0'은 연간 + 진행 중인 부분연도 행을 함께 준다.
  // 연간 행은 12개월 간격이므로, 가장 흔한 "연말 월"을 찾아 그 행들만 채택한다.
  const months = ratioRows.slice(1).map((r) => r.stac_yymm.slice(4));
  const monthCount: Record<string, number> = {};
  for (const m of months) monthCount[m] = (monthCount[m] ?? 0) + 1;
  const yearEndMonth = Object.entries(monthCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '12';

  const annualRows = ratioRows
    .filter((r) => r.stac_yymm.slice(4) === yearEndMonth)
    .slice(0, 3);

  return annualRows.map((r) => {
    const revenue = parseFloat(r.sale_account);
    const opProfit = parseFloat(r.bsop_prti);
    const netIncome = parseFloat(r.thtr_ntin);
    return {
      year:            r.stac_yymm.slice(0, 4),
      revenue:         isNaN(revenue) || revenue === 99.99 ? null : Math.round(revenue),
      operatingProfit: isNaN(opProfit) || opProfit === 99.99 ? null : Math.round(opProfit),
      netIncome:       isNaN(netIncome) || netIncome === 99.99 ? null : Math.round(netIncome),
      roe:             roeMap.get(r.stac_yymm) ?? null,
    };
  });
}

// ── 배당 지급 이력 (기업분석 "배당 정보" 섹션) ──────────────────────────────
// 2026-07-30 실측: ksdinfo/dividend(HHKDB669102C0)의 divi_rate는 액면가 기준이라
// 실제 시가배당률이 아니다(예: 삼성전자 per_sto_divi_amt=372, face_val=100일 때
// divi_rate=372.00 — 372/100 그대로). 실제 배당율은 배당기준일(record_date) 종가
// 대비로 fpark이 직접 계산한다. 같은 실측에서 divi_kind는 "분기"/"결산" 두 값만
// 확인됨(005930/000660/005380/105560/017670/051910, 5년 범위 — 중간배당 등 다른
// 값 없음). per_sto_divi_amt가 "0"인 행은 아직 확정되지 않은 분기/연도의 placeholder
// (카카오 035720 실측: 매 결산기마다 12/31 기준 0원 행과 이사회 확정 후 실제 기준일의
// 확정 금액 행이 별도로 잡힘) — 반드시 걸러내야 "배당 없음"과 "아직 미확정"이 섞이지 않는다.
export type DividendKind = '분기' | '결산';

export type DividendHistoryRow = {
  recordDate:     string;        // 배당기준일 YYYY-MM-DD
  kind:           DividendKind;
  kindLabel:      string;        // '분기배당' | '결산배당'
  perShareAmount: number;        // 주당배당금(원)
  dividendRate:   number | null; // 배당기준일 종가 대비 실제 배당율(%) — 종가 조회 실패 시 null(0으로 표시하지 않음)
  payDate:        string | null; // 배당금 지급일 YYYY-MM-DD, 미지급이면 null
};

const DIVIDEND_HISTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 배당 이벤트는 분기 단위로만 발생 — 24시간이면 충분
const dividendHistoryCacheKey = (ticker: string) => `kis_dividend_history_${ticker}`;

async function fetchDividendHistoryRaw(ticker: string): Promise<
  { recordDate: string; kind: DividendKind; perShareAmount: number; payDate: string | null }[]
> {
  return withKisTokenRetry(async () => {
    const token = await getAccessToken();

    const now = new Date();
    const startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 5);
    const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/ksdinfo/dividend`);
    url.searchParams.set('CTS', '');
    url.searchParams.set('GB1', '0');
    url.searchParams.set('F_DT', fmt(startDate));
    url.searchParams.set('T_DT', fmt(now));
    url.searchParams.set('SHT_CD', ticker);
    url.searchParams.set('HIGH_GB', '');

    const res = await fetch(url.toString(), {
      headers: headers(token, 'HHKDB669102C0'),
      cache:   'no-store',
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`ksdinfo/dividend HTTP ${res.status}`);
    const data = await res.json();
    assertKisTokenValid(data, `fetchDividendHistory(${ticker})`);
    if (data.rt_cd !== '0') throw new Error(data.msg1 ?? 'ksdinfo/dividend 실패');

    type RawRow = { record_date: string; divi_kind: string; per_sto_divi_amt: string; divi_pay_dt: string };
    return ((data.output1 ?? []) as RawRow[])
      .filter((r) => r.per_sto_divi_amt && Number(r.per_sto_divi_amt) > 0)
      .filter((r): r is RawRow & { divi_kind: DividendKind } => r.divi_kind === '분기' || r.divi_kind === '결산')
      .map((r) => ({
        recordDate:     `${r.record_date.slice(0, 4)}-${r.record_date.slice(4, 6)}-${r.record_date.slice(6, 8)}`,
        kind:           r.divi_kind,
        perShareAmount: Number(r.per_sto_divi_amt),
        payDate:        r.divi_pay_dt ? r.divi_pay_dt.replace(/\//g, '-') : null,
      }));
  });
}

// 종가는 market_cache HTTP 라우트(/api/stock/[ticker]/chart-near)가 아니라 그 밑단의
// fetchChartNear를 서버에서 직접 호출한다 — 배당기준일은 "몇 개월 전" 같은 고정
// 버킷이 아니라 임의의 과거 날짜라 그 라우트의 캐시 키(monthsAgo 단위)와 맞지도 않고,
// 어차피 이 함수 전체 결과(배당율 계산까지 끝난 상태)를 24시간 통째로 캐싱하므로
// 종가만 따로 또 캐싱하면 이중 캐싱이 된다.
export async function fetchDividendHistory(ticker: string): Promise<DividendHistoryRow[]> {
  try {
    const { data: cache } = await supabase
      .from('market_cache')
      .select('data, updated_at')
      .eq('key', dividendHistoryCacheKey(ticker))
      .single();
    if (cache?.data && Date.now() - new Date(cache.updated_at as string).getTime() < DIVIDEND_HISTORY_CACHE_TTL_MS) {
      return cache.data as DividendHistoryRow[];
    }
  } catch {
    // 캐시 조회 실패 시 새로 계산
  }

  try {
    const rawRows = await fetchDividendHistoryRaw(ticker);

    // 3개씩 배치 처리 (rate limit 회피, 기존 관례)
    const enriched: DividendHistoryRow[] = [];
    for (let i = 0; i < rawRows.length; i += 3) {
      const batch = rawRows.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map(async (r) => {
          const points = await fetchChartNear(ticker, new Date(r.recordDate));
          const close = findClosestPastClose(points, r.recordDate)?.close ?? null;
          const dividendRate = close && close > 0 ? (r.perShareAmount / close) * 100 : null;
          return {
            recordDate:     r.recordDate,
            kind:           r.kind,
            kindLabel:      r.kind === '분기' ? '분기배당' : '결산배당',
            perShareAmount: r.perShareAmount,
            dividendRate,
            payDate:        r.payDate,
          };
        })
      );
      for (const result of results) if (result.status === 'fulfilled') enriched.push(result.value);
    }

    enriched.sort((a, b) => b.recordDate.localeCompare(a.recordDate));

    try {
      const { error } = await supabase
        .from('market_cache')
        .upsert({ key: dividendHistoryCacheKey(ticker), data: enriched, updated_at: new Date().toISOString() });
      if (error) console.warn(`[KIS] ${ticker} 배당이력 캐시 저장 실패:`, error.message);
    } catch (e) {
      console.warn(`[KIS] ${ticker} 배당이력 캐시 저장 실패:`, e instanceof Error ? e.message : e);
    }

    return enriched;
  } catch (e) {
    console.error(`[KIS] fetchDividendHistory 실패 ${ticker}:`, e instanceof Error ? e.message : e);
    return [];
  }
}
