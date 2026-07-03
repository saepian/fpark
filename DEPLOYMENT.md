# 배포 원칙

## 배포 경로는 GitHub 자동배포 하나만 사용한다

- 배포는 `main` 브랜치에 `git push`하면 Vercel의 GitHub 연동이 자동으로 빌드·배포한다.
- `vercel --prod` 수동 배포 명령은 원칙적으로 사용하지 않는다.

## 배포 전 체크리스트

1. `git status`로 커밋되지 않은 변경사항이 없는지 확인한다. (`.git/hooks/pre-push`가 자동으로 경고하지만, push 전에 직접 확인하는 습관을 들일 것)
2. 확인이 끝나면 `git push origin main`만 실행한다.
3. 배포 후 실제 화면(fpark.com)에서 방금 바꾼 기능을 눈으로 직접 확인한다 (스모크 테스트) — 타입체크 통과가 기능 정상 작동을 보장하지 않는다.

## pre-push 훅 설치 (최초 1회)

```
ln -sf ../../scripts/git-hooks/pre-push .git/hooks/pre-push
```

`.git/hooks`는 git으로 관리되지 않으므로, 새로 클론한 환경에서는 위 명령을 한 번 실행해야 훅이 동작한다.

## 이 규칙이 생긴 이유

2026-07-03, `git push`(GitHub 자동배포)와 `vercel --prod`(로컬 디스크 기준 수동배포)를 번갈아 실행하다가 두 배포가 경합했다. 로컬에는 커밋되지 않은 수정 버전이 있었는데, `vercel --prod`는 이 미커밋 버전을 배포하고 곧이어 `git push`가 트리거한 자동배포는 커밋된 구버전으로 덮어써서, `fpark.com`이 몇 분 단위로 신/구 버전을 오락가락했다 (수급 알림 임계값·중복 발송 버그로 표면화됨). 배포 경로를 하나로 고정해 재발을 막는다.

## 결제수단 배경과 현재 상태 (2026-07-03 최종 확정)

### 왜 카드결제 하나로는 안 되는가

국내 카드사가 "주식/투자 정보 관련 업종"을 공통적으로 심사 거부함 (KG이니시스 확인, 토스페이먼츠 등 타 PG의 제한 업종 목록에도 "투자 정보 관련 서비스", "유사투자자문업" 명시). 해외 MoR(Paddle)도 "financial services"(trading signals 포함) 업종 미지원으로 가맹 신청 자체가 막힘.

### 확정: 계좌이체(가상계좌)

**결제수단은 계좌이체(가상계좌, 무통장입금)로 확정.** KG이니시스(PortOne V2)가 이미 지원하는 결제수단이라 신규 PG 계약이 필요 없음 — 기존 `PORTONE_*` 환경변수 그대로 사용.

- 자동 출금이 아니다. 사용자가 발급받은 가상계좌로 매달 직접 입금하는 방식.
- 흐름: 구독 신청 → 가상계좌 발급 → 입금 → 웹훅으로 입금 확인 → 구독 활성화. 갱신일 D-3일에 새 계좌 발급 + 안내 이메일(`cron/virtual-account-renewal`), 입금 기한(발급 후 3일) 초과 시 `subscription_status`를 `paused`로 전환, 이후 입금 확인되면 웹훅이 자동으로 `active` 복구.
- 코드: `lib/portone.ts`(`issueVirtualAccount`), `app/api/payment/virtual-account/issue`, `app/api/payment/webhook`(입금 확인 시 최초 활성화 분기 추가), `app/api/cron/virtual-account-renewal`, `components/payment/PaymentMethodSelect.tsx` → `VirtualAccountForm.tsx`.
- 마이그레이션: `supabase/migrations/20260703_virtual_account.sql` — **아직 프로덕션 DB에 미적용.**

**운영 시작 전 확인 필요 (코드가 아니라 PortOne 콘솔/계약 확인 사항):**

| 항목 | 내용 |
|---|---|
| 채널의 가상계좌 지원 여부 | 현재 `NEXT_PUBLIC_PORTONE_CHANNEL_KEY`가 카드 전용으로 계약돼 있을 수 있음 — PortOne 콘솔에서 해당 채널(또는 KG이니시스 계약)에 가상계좌(무통장입금)가 활성화돼 있는지 확인 필요. 안 되어 있으면 이니시스 측에 가상계좌 사용 신청 필요. |
| 지원 은행 목록 | `app/api/payment/virtual-account/issue/route.ts`의 `ALLOWED_BANKS`, `components/payment/VirtualAccountForm.tsx`의 `BANKS`에 임의로 9개 은행을 나열해둠 — 실제 계약에서 지원하는 은행 목록으로 교체 필요. |
| 웹훅 URL 등록 | 기존 카드결제와 동일한 `https://fpark.com/api/payment/webhook`을 그대로 사용 (가상계좌 발급완료/입금완료 이벤트도 같은 엔드포인트로 옴). |
| 마이그레이션 적용 | `20260703_virtual_account.sql`을 프로덕션 DB에 실행. |

### CMS 자동이체 — 검토 후 미채택

사용자의 심리적 거부감(자동으로 계좌에서 돈이 빠져나가는 것에 대한 불편함)을 고려해 CMS 자동이체는 채택하지 않기로 결정. 관련 스캐폴딩 코드(`lib/cms.ts`, `app/api/payment/cms/*` 등)는 삭제함 — 미커밋 상태였고 계좌이체(가상계좌)로 완전히 대체되어 남겨둘 실익이 없었음.

### Paddle — 가맹 신청 보류

Paddle 가맹 신청 중 "financial services"(trading signals 포함) 업종을 지원하지 않는다는 답변을 받아 계정 생성 자체가 불가능함을 확인. fpark 화면의 "매수세/매도세 배지", "저항선/지지선" 같은 트레이딩 시그널 요소가 원인으로 의심되며, 다른 MoR도 유사한 정책일 가능성이 있어 대안 검토 중.

- 코드: `components/payment/PaymentMethodSelect.tsx`의 `PADDLE_ENABLED = false` 플래그로 비활성화. 선택 화면 UI 구조(1. 수단 선택 → 2B 슬롯)는 유지해서, 대체 MoR이 확정되면 2B 슬롯에 새 컴포넌트만 연결하면 되도록 해둠.
- 실제 API 연동 코드(`api/payment/paddle/*`)는 만들지 않음 — 계정조차 없어 스캐폴딩할 대상이 없었음.

### 기존 이니시스 카드결제 — 보존만

카드사 승인 거부로 노출은 막았으나 코드는 삭제하지 않음 (특정 카드사가 향후 승인할 가능성 대비). `PaymentMethodSelect.tsx`의 `CARD_ENABLED = false`로 숨김, `PortoneCheckout.tsx`는 그대로 보존.
