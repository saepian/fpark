# KIS 접근토큰 캐시 공유 (fpark ↔ video-pipeline)

작성: 2026-08-31 · fpark 쪽 준비 완료 · **video-pipeline 쪽 구현은 아래 "video-pipeline에서 할 일"**

## 왜 필요한가

fpark와 video-pipeline은 **같은 KIS 앱키**를 쓴다. 2026-08-31 실측:

- 두 프로젝트가 각자 캐시(fpark = Supabase `kis_tokens`, video-pipeline = `scripts/.cache/kis_token.json`)를 따로 관리
- KIS는 유효기간 내 재요청 시 **기존 토큰을 그대로 돌려주면서 알림톡은 매 호출마다** 보낸다 → 하루 4회 "발급" 알림 (실제 신규 발급은 그보다 적어도, KIS 약관상 "잦은 발급 시 이용 제한" 리스크는 동일)
- 한쪽이 6시간 경과 후 재발급하면 KIS가 토큰을 교체해 다른 쪽 캐시가 죽는 연쇄 구조

해결: **토큰 캐시를 fpark 한 곳으로 통일**하고 video-pipeline은 fpark의 내부 API로 토큰을 받아 쓴다.

## 설계 선택: 내부 API(b안) — Supabase 직접 접근(a안) 대신

| | a. video-pipeline이 Supabase 직접 접근 | **b. fpark 내부 API** (채택) |
|---|---|---|
| 외부에 넘기는 비밀 | service-role 키 = fpark DB **전체** 권한 | 단일 목적 시크릿 1개, 독립 폐기·교체 |
| 락/쿨다운/동일토큰 처리/감사로그 | Python에서 **재구현** 필요 → 두 구현이 어긋나면 그게 다음 사고 | fpark `getAccessToken()`을 그대로 경유 → **전부 자동 공유** |
| video-pipeline 코드량 | RPC 프로토콜 이식(수십 줄) | `requests.get` 1회 |
| fpark 장애 시 | DB만 살아있으면 동작 | 토큰 못 받음 → **로컬 파일 캐시로 완충**(아래) |

## fpark 쪽 (완료)

- `GET /api/internal/kis-token` — `app/api/internal/kis-token/route.ts`
  - 인증: `Authorization: Bearer <KIS_TOKEN_SHARE_SECRET>` (timing-safe 비교). 시크릿 env 미설정 시 503(닫힘).
  - 응답 200: `{ "access_token": "...", "expires_at": "2026-09-01T02:44:33.000Z" }` (`expires_at`은 **KIS가 알려준 실제 만료**, UTC ISO)
  - 응답 401: 시크릿 불일치 / 503 + `Retry-After: 65`: KIS가 발급을 거부(EGW00133 등) → **65초 후 재시도**, 절대 자체 발급으로 우회하지 말 것
  - 남용 방지: 이 엔드포인트는 별도 발급 경로가 아니라 fpark 내부 캐시 경로(인메모리 → `kis_tokens` → 분산락 → 발급)를 그대로 타므로, 아무리 자주 호출해도 KIS tokenP 호출 횟수를 늘릴 수 없다. 호출은 `X-KIS-Client` 헤더로 로그에 식별된다.
- `lib/kis-api.ts` `getAccessTokenWithExpiry()` — 위 엔드포인트 전용, 발급 로직 변경 없음
- 환경변수 `KIS_TOKEN_SHARE_SECRET` — Vercel Production + `.env.local`에 설정됨 (`.env.local`에서 값 확인)

## video-pipeline에서 할 일

### 1. 환경변수 (`python/.env`)

```
FPARK_KIS_TOKEN_URL=https://fpark.com/api/internal/kis-token
FPARK_KIS_TOKEN_SECRET=<fpark .env.local의 KIS_TOKEN_SHARE_SECRET 값>
```

`KIS_APP_KEY` / `KIS_APP_SECRET`은 TR 요청 헤더(appkey/appsecret)에 계속 필요하므로 **그대로 둔다**. 단, 더 이상 `oauth2/tokenP`를 직접 호출하지 않는다.

### 2. `python/pipeline/market_kis.py` `get_access_token()` 교체

핵심: **tokenP POST를 fpark GET으로 바꾸고, 로컬 파일 캐시는 "fpark가 알려준 만료"를 기준으로 유지**한다. 기존 호출부(`flow_kis.py`, `financial_kis.py`, `index_kis.py`)는 시그니처가 같아 변경 없음.

```python
import os, json, requests
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
FPARK_URL    = os.environ["FPARK_KIS_TOKEN_URL"]
FPARK_SECRET = os.environ["FPARK_KIS_TOKEN_SECRET"]
REFRESH_MARGIN = timedelta(minutes=10)   # fpark와 동일: 만료 10분 전부터 갱신

def _cache_valid(cache: dict) -> bool:
    if not cache or "access_token" not in cache or "expires_at" not in cache:
        return False
    try:
        exp = datetime.fromisoformat(cache["expires_at"].replace("Z", "+00:00"))
    except ValueError:
        return False
    return datetime.now(timezone.utc) + REFRESH_MARGIN < exp

def get_access_token(cache_path: Path = TOKEN_CACHE_PATH) -> str:
    cache = _read_token_cache(cache_path)
    if _cache_valid(cache):
        return cache["access_token"]

    # fpark 단일 캐시에서 받아온다 — 여기서 tokenP를 직접 부르면 안 된다.
    resp = requests.get(
        FPARK_URL,
        headers={"Authorization": f"Bearer {FPARK_SECRET}", "X-KIS-Client": "video-pipeline"},
        timeout=20,
    )
    if resp.status_code == 503:
        # KIS 발급 거부(1분당 1회 등) — 옛 캐시가 아직 살아있으면 그걸 쓰고, 아니면 잠시 후 재시도
        if cache.get("access_token") and datetime.now(timezone.utc) < datetime.fromisoformat(cache["expires_at"].replace("Z", "+00:00")):
            return cache["access_token"]
        raise RuntimeError(f"fpark 토큰 일시 불가(503) — {resp.headers.get('Retry-After', '65')}초 후 재시도")
    resp.raise_for_status()
    data = resp.json()
    _write_token_cache(cache_path, data["access_token"], data["expires_at"])  # expires_at은 UTC ISO 그대로 저장
    return data["access_token"]
```

- `_read_token_cache` / `_write_token_cache` / `TOKEN_CACHE_PATH`는 기존 것 재사용.
- 기존 `_is_token_cache_valid`(naive `datetime.fromisoformat`)는 UTC ISO(`Z`)를 못 읽으므로 위 `_cache_valid`로 교체.
- 기존 캐시 파일(`expires_at: "2026-09-01T11:44:33"`, KST naive)은 새 코드가 파싱 실패 → 만료 취급 → fpark에서 1회 받아와 교체됨. 수동 삭제 불필요.

### 3. 검증 (video-pipeline 작업 시)

1. `python -c "from pipeline.market_kis import get_access_token; print(get_access_token()[-8:])"` → fpark `kis_tokens` 최신 행의 토큰 tail과 **일치**해야 함
2. 같은 명령 재실행 → fpark 호출 없이 파일 캐시로 즉시 반환(fpark 로그에 `[internal/kis-token]` 안 찍힘)
3. `grep -rn "tokenP" python/` → `market_kis.py`의 주석 외 실제 호출 0건
4. 하루 뒤 KIS 알림톡 "발급" 횟수가 **1회**로 돌아왔는지 확인 — 이게 최종 성공 기준

### 4. 시크릿 교체(로테이션) 절차

`KIS_TOKEN_SHARE_SECRET`을 Vercel Production + fpark `.env.local` + video-pipeline `.env` 세 곳에서 동시에 바꾼다. Vercel은 재배포 없이 새 요청부터 반영된다.

## 남는 한계

- video-pipeline이 fpark 배포 이전 코드로 돌면(예: 옛 브랜치) 여전히 자체 발급한다 — 이행 완료 전까지 알림톡 횟수를 하루 단위로 확인할 것.
- fpark 자체가 내려가면 video-pipeline은 로컬 캐시 만료 후 토큰을 받지 못한다(의도된 트레이드오프 — 자체 발급 폴백을 넣으면 사고가 재발하므로 넣지 않는다).
