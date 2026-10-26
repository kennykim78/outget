# WithSmall 배포·운영 절차

> 운영 메모. 값·시크릿은 이 문서에 적지 않는다(이름·의미만). 변수 표의 원본은 `.env.example`.
> 참조: `docker-entrypoint.sh`(기동 순서), `scripts/prune-backups.sh`(백업 정리), `server/src/privacy/policy.ts`(보존 기간).

## 1. 배포

동일 오리진 단일 컨테이너. 기동 순서(`docker-entrypoint.sh`):

1. 환경 변수 검사(`node dist/config/env.js`) — 누락·무효면 이름만 출력하고 중단. 시크릿 값은 출력하지 않는다.
2. 백업 설정 검증 → 기존 `/data/prod.db`를 `/data/backup/prod-<UTC>.db`로 복사 → 백업 정리.
3. `prisma migrate deploy`. 실패하면 중단 — 롤백은 2)의 백업 파일을 DB 경로로 되돌린다(3절).
4. 서버 기동. 개인정보 자동 파기는 기동 1회 + 24시간 주기(5절).

## 2. 환경 변수 (이름·의미)

| 변수 | 의미 |
|---|---|
| `PUBLIC_ORIGIN` | 메일 링크용 https 오리진(경로·끝 슬래시 없음). 운영 필수 |
| `TRUST_PROXY` | 앞단 프록시 홉 수(0~10, 기본 0). 0이면 X-Forwarded-For 무시 |
| `MAIL_TRANSPORT` | `resend` 또는 `console`. console은 운영 금지 |
| `RESEND_API_KEY`, `MAIL_FROM` | `MAIL_TRANSPORT=resend`일 때 필수(시크릿은 운영 주입, 커밋 금지) |
| `WS_BACKUP_DIR` | 백업 폴더(기본 `/data/backup`) |
| `WS_BACKUP_KEEP` | 보관 개수(기본 5, 1 이상 정수. 0·음수·비숫자면 기동 중단) |
| `WS_BACKUP_MAX_AGE_DAYS` | 보관 일수(기본 7, 1~7 정수 — 처리방침 백업 보관 7일, 8 이상이면 기동 거부). 개수와 나이 둘 다 적용 |
| `WS_CLIENT_DIST` | 클라이언트 dist 경로. 개발·테스트 전용, 운영(`NODE_ENV=production`)에서는 무시 |
| `WS_ERASURE_FILE` | 삭제 기록 파일. 기본 `/data/erasures.jsonl` — **백업 폴더 밖**에 둔다 |
| `WS_ALLOW_PRIVACY_PLACEHOLDER` | `1`이면 `/privacy`에 `{{KENNY:` 자리표시가 남아도 기동(경고). 점검·CI 전용, 공개 운영 금지 — 운영 기동 시 처리방침에 자리표시가 있으면 기동을 거부한다 |

백업 나이는 런타임 규칙(`now − N×24h`보다 오래된 파일)과 같게 분 단위로 판정한다. 정확히 7일을 넘기면 지워진다.

## 3. 백업·복원

- 백업: 기동 때마다 자동. 짝 파일(`-journal`, `-wal`)은 함께 지워진다.
- 복원: 컨테이너를 멈추고 `/data/backup/prod-<UTC>.db`를 `/data/prod.db`로 복사한 뒤 기동한다.
- **복원 후 기동하면 삭제 묘비가 자동 재적용되어, 삭제했던 계정을 다시 지운다.** 묘비 파일/테이블을 지우지 말 것. 묘비 보존은 백업 보존 기간(7일)과 같다.
- 복원 후 기동 시 지운 계정을 다시 지우면 그 삭제 기록 보존을 그날부터 7일 연장한다. 묘비 파일(`WS_ERASURE_FILE`)을 지우지 말 것.

## 4. 개인정보 수동 삭제 요청 처리

1. 처리방침의 연락처로 요청이 오면, 먼저 서비스 내 자기 삭제 방법을 안내한다.
2. 자기 삭제가 어려운 경우, 요청 메일에 **같은 주소로 회신**해 본인(계정 이메일) 소유를 확인한다.
3. 확인되면 운영자가 실행한다.
   - 개발/운영 소스: `npm run privacy:erase -w server -- --email <addr>`
   - 컨테이너: `node dist/privacy/cli-erase.js --email <addr>`
   - `--email` 값이 셸 기록(history)에 남으므로 실행 후 해당 기록을 지운다(bash: `history -d <번호>`, 그 외 셸은 해당 셸 방식).
   - 삭제 후 `VACUUM`은 CLI가 자동 수행한다(BE 레인 반영 예정).
4. 출력은 건수만 나온다(이메일·식별자 없음). 건수와 처리일만 내부 기록하고 회신한다.

## 5. 자동 파기 주기

기동 1회 + 24시간마다 실행. 기간은 `server/src/privacy/policy.ts`가 단일 출처(처리방침 본문도 같은 값을 읽는다). 값을 바꾸면 공개 후에는 시행 7일 전 고지가 필요하다.

## 6. Resend 설정 점검 목록 (Kenny 확인 항목)

- [ ] 발신 도메인 인증(SPF·DKIM) 완료
- [ ] click tracking 끔
- [ ] open tracking 끔
- [ ] 로그(메일 본문·수신자) 보존 기간 확인 — 처리방침 기재와 일치하는지
- [ ] API 키는 운영 환경에만 주입(저장소·이미지에 없음)
