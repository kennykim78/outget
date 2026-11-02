# WithSmall 배포·운영 절차

> 운영 메모. 값·시크릿은 이 문서에 적지 않는다(이름·의미만). 변수 표의 원본은 `.env.example`.
> 참조: `docker-entrypoint.sh`(기동 순서), `scripts/prune-backups.sh`(백업 정리), `server/src/privacy/policy.ts`(보존 기간).

## 1. 배포

동일 오리진 단일 컨테이너. 기동 순서(`docker-entrypoint.sh`):

1. 환경 변수 검사(`node dist/config/env.js`) — 누락·무효면 이름만 출력하고 중단. 시크릿 값은 출력하지 않는다.
2. 백업 설정 검증 → 기존 `/data/prod.db`를 `/data/backup/prod-<UTC>.db`로 복사 → 백업 정리.
3. `prisma migrate deploy`. 실패하면 중단 — 롤백은 2)의 백업 파일을 DB 경로로 되돌린다(3절).
4. 서버 기동. 개인정보 자동 파기는 기동 1회 + 24시간 주기(5절).

운영 호스트: Oracle Cloud Always Free, ap-tokyo-1(일본 도쿄), VM.Standard.A1.Flex(arm64). 앞단 Caddy(TLS·`X-Robots-Tag: noindex`, 비밀번호 없음 — Kenny 2026-11-02 ORDERS §40) → 앱 컨테이너. 이미지는 GHCR 비공개. 배포·롤백은 6절, 호스트 준비는 8절.

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
| `SQLITE_TMPDIR` | SQLite 임시 파일 폴더. 이미지 기본 `/data/.sqlite-tmp`(compose·CI 스모크도 같은 값, 엔트리포인트가 0700 으로 만든다). read_only 루트에서 비우면 tmpfs `/tmp`(64m)로 떨어져 DB 가 약 64MB 를 넘으면 VACUUM(삭제 뒤 파기)이 실패한다(QA148 MED-1). `/data/backup` 밖이라 백업 정리와 무관 |
| `WS_ERASURE_FILE` | 삭제 기록 파일. 기본 `/data/erasures.jsonl` — **백업 폴더 밖**에 둔다 |
| `WS_EVENT_DAILY_CAP` | 익명 이벤트(`/api/events`) 하루 저장 행 상한(서울 날짜 기준, 기본 10000, 0 이상 정수 — 0이면 저장 안 함, 비숫자·음수면 기동 중단). 넘친 이벤트는 저장하지 않고 응답은 그대로 204. 근거: 행 약 250B(최대 1.4KB) × 90일 보존 → 평균 약 225MB, 최악 약 1.3GB(+VACUUM 사본·백업 5개) |
| `WS_VET_REPORT_DAILY_CAP` | 병원 제보(`/api/vets/reports`) 하루 저장 상한(기본 100, 0 이상 정수). 넘친 제보는 저장하지 않고 응답은 그대로 202. 제보는 접수 후 180일 지나면 자동 정리(확인된 병원은 남김). 상한을 그날 처음 치면 `[cap] vetReports daily cap reached date=… limit=…` 한 줄(이벤트는 `[cap] events …`, 날짜·숫자만) |
| `WS_VET_REPORT_PER_IP_DAILY` | 병원 제보 IP별 하루 한도(기본 10, 0 이상 정수). 넘친 제보는 전역 상한을 쓰지 않고 응답은 그대로 202. IP 는 서버 메모리에서 그날의 무작위 키로 만든 해시로만 세고 날짜가 바뀌면 버린다 — DB·파일·로그에 남지 않는다 |
| `WS_ALLOW_PRIVACY_PLACEHOLDER` | `1`이면 `/privacy`에 `{{KENNY:` 자리표시가 남아도 기동(경고). 점검·CI·내부 테스트 전용, 공개 운영 금지 — 운영 기동 시 처리방침에 자리표시가 있으면 기동을 거부한다. **공개 빌드(빌드 인자 WS_INDEXABLE=1 → prerender-manifest.json indexable=true)에서는 이 값이 있어도 무시하고 거부한다**(security 139 MED-2). 내부 테스트는 WS_INDEXABLE=0 유지 |

백업 나이는 런타임 규칙(`now − N×24h`보다 오래된 파일)과 같게 분 단위로 판정한다. 7일이 지난 백업은 다음 정리 작업(기동 시·24시간마다) 때 지워진다 — 실제로는 최대 약 8일 남을 수 있다.

## 3. 백업·복원

- 백업: 기동 때마다 자동. 짝 파일(`-journal`, `-wal`)은 함께 지워진다.
- 복원: 컨테이너를 멈추고 `/data/backup/prod-<UTC>.db`를 `/data/prod.db`로 복사한 뒤 기동한다.
- 복원 직후 기동이 실패하면, 그 실패한 기동이 만든 새 백업(`prod-<시각>.db`)은 지운 뒤 다시 시도한다.
- **복원 후 기동하면 삭제 묘비가 자동 재적용되어, 삭제했던 계정을 다시 지운다.** 묘비 파일/테이블을 지우지 말 것. 묘비 보존은 백업 보존 기간(7일)과 같다.
- 복원 후 기동 시 지운 계정을 다시 지우면 그 삭제 기록 보존을 그날부터 7일 연장한다. 묘비 파일(`WS_ERASURE_FILE`)을 지우지 말 것.

## 4. 개인정보 수동 삭제 요청 처리

1. 처리방침의 연락처로 요청이 오면, 먼저 서비스 내 자기 삭제 방법을 안내한다.
2. 자기 삭제가 어려운 경우, 요청 메일에 **같은 주소로 회신**해 본인(계정 이메일) 소유를 확인한다.
3. 확인되면 운영자가 실행한다.
   - 이메일은 명령줄에 쓰지 않고 **표준 입력**으로 넣는다. 인수 없이 실행하면 안내가 뜨고, 그때 이메일을 붙여넣고 Enter, 확인용으로 한 번 더 입력하고 Enter 를 친다. 입력값은 화면(터미널 에코)에만 보이고 프로그램은 되울리지 않는다 — 명령줄로 받지 않으므로 sudo 명령 기록·journald·셸 history 에 들어가지 않는다. 단 sudo 입력 기록(`log_input`)·터미널 세션 녹화(`script`·tlog 등)를 켜지 않은 전제다(켜 두었다면 입력도 거기에 남는다).
   - 개발/운영 소스: `npm run privacy:erase -w server`
   - 컨테이너: `sudo -u deploy docker compose -f /opt/withsmall/compose.yaml exec app node dist/privacy/cli-erase.js`
   - `echo 주소 | …`·`<<<`·파일 리다이렉트처럼 이메일을 명령이나 파일에 적지 않는다(`sudo sh -c` 로 감싸면 명령줄 기록에 남고, 셸 history·파일에도 잔류한다).
   - `--email` 같은 인수는 거부된다(종료 2). 실수로 쳤다면 그 줄은 journald(7일)에 남고, 1년 보관하는 운영자 접속 기록(7절)에는 이메일 형태가 `<email>` 로 가려진다. 셸 history 에도 남으니 `history -d <번호>` 로 지우고, 개발 소스 경로(`npm run …`)였다면 `~/.npm/_logs/` 의 그 실행 로그도 지운다.
   - 한 번에 한 계정만 처리한다(여러 줄이거나 두 입력이 다르면 종료 2 — 두 계정을 한 번에 붙여넣어도, 확인 전에 Ctrl-D 로 끝내도 아무것도 지우지 않는다).
   - 확인 줄을 받은 뒤(첫 줄이 빈 Enter 거나 입력이 너무 길면 그 뒤) 터미널을 잠시 raw 모드로 바꿔 입력을 계속 읽어 버린다. 조용해질 때까지(마지막 입력 뒤 약 0.25초) 공백·Enter 외 글자(Ctrl-C·Ctrl-D 포함)가 들어오면 거부한다. 2초가 지나도 입력이 계속 들어와도 거부한다(둘 다 종료 2, 아무것도 지우지 않음).
   - 붙여넣은 나머지 중 조용 구간(약 0.25초) 안에 이어 들어온 것과 결과가 출력되기 전에 친 입력은 프로그램이 읽어 버린다(삭제·VACUUM 중 친 Ctrl-C 도 무시하고 끝까지 진행한다). 결과가 나온 뒤 친 입력은 셸로 간다 — 느린 연결로 붙여넣기가 0.25초 넘게 끊겨 들어와 거부 결과 뒤에 도착한 조각도 마찬가지다. 그러니 확인 Enter 뒤 결과가 나올 때까지 아무것도 치지 않는다. 끝나면 터미널 모드는 원래대로 돌아온다.
   - 위 붙여넣기 동작은 개발 환경의 실제 터미널(pty)에서 확인했고, 컨테이너 경로(`docker compose exec`)에서는 아직 실 서버로 확인하지 않았다. 첫 사용 전에 테스트 계정 없이 확인한다: `a@x` Enter, `a@x` Enter, `b@x`(줄바꿈 없음)를 한 번에 붙여넣기 → 종료 2 확인 → 3초 뒤 Enter → `history | tail -3` 에 `b@x` 가 없어야 한다.
   - 삭제 후 `VACUUM`은 CLI가 자동 수행한다. 종료 코드: 0 성공, 1 실행 실패, 2 입력 오류.
4. 출력은 건수만 나온다(이메일·식별자 없음). 건수와 처리일만 내부 기록하고 회신한다.

## 5. 자동 파기 주기

기동 1회 + 24시간마다 실행. 기간은 `server/src/privacy/policy.ts`가 단일 출처(처리방침 본문도 같은 값을 읽는다). 값을 바꾸면 공개 후에는 시행 7일 전 고지가 필요하다.

## 6. 배포 자동화·롤백 (내부 테스트, Oracle Cloud)

구성(`deploy/`, 서버 `/opt/withsmall/`):

| 파일 | 서버 위치 | 역할 |
|---|---|---|
| `compose.yaml` | `/opt/withsmall/compose.yaml` | `app`(이미지 `WS_IMAGE`, 호스트 포트 없음) + `caddy`(80·443, 이미지 다이제스트 고정). 둘 다 `read_only` 루트 + tmpfs `/tmp`(noexec) + `mem_limit`·`cpus`·`pids_limit`, cap 전부 제거. 로그 journald |
| `Caddyfile` | `/opt/withsmall/Caddyfile` | 비밀번호 없음(basic_auth 폐기, ORDERS §40) · 운영자 경로(`/auth/login`·`/auth/refresh`·`/auth/me`·`/admin`·`/admin/*`, 끝 슬래시 포함) 외부 404(ORDERS §41 — 저장 흐름 `/auth/magic/*`·`/auth/session`·`/auth/logout` 은 열림) · `X-Robots-Tag: noindex`(오류 응답 포함) · `-Server` · www → apex 302 · 접속 기록 0(7절) |
| `deploy.sh` | `/opt/withsmall/bin/deploy.sh` | `deploy sha-<12>` / `rollback` |
| `deploy-gate.sh` | `/opt/withsmall/bin/deploy-gate.sh` | SSH 강제 명령. `deploy sha-<16진 12자>`·`rollback` 외 전부 거부 |
| `bootstrap.sh` | (1회 실행) | 새 호스트 준비(8절). sshd `AllowUsers deploy <관리 계정>`·포워딩 끔, 운영자 접속 기록 1년(7절) |
| `server.env.example` | `/opt/withsmall/server.env`(0600, deploy 소유) | 앱 런타임 env. 시크릿 3개는 bootstrap 이 서버에서 생성 |
| `deploy.conf.example` | `/opt/withsmall/deploy.conf` | `WS_IMAGE_REPO=ghcr.io/<owner>/<repo>`(소문자) |

흐름: GitHub Actions `Deploy (internal test)`(수동 실행만, **main 에서만** — 첫 job `require-main` 이 `github.ref != refs/heads/main` 이면 실패하고 build-push·deploy·rollback 모두 돌지 않는다, security 139 LOW-1) → `build-push`(첫 단계: 이 커밋의 `ci.yml` 최신 실행이 completed·success 가 아니면 중단 — `ci.yml` 은 pull_request·main push 에서만 돌므로 **PR 이 열려 CI 가 초록인 커밋**만 배포된다, QEMU arm64, GHCR 비공개, 태그 `sha-<커밋 12자>`, provenance 끔) → `deploy`(SSH `deploy sha-…`) → 외부 확인(`/` 200 · 응답 헤더 `X-Robots-Tag` 에 noindex · `/robots.txt` 에 `Disallow: /` 줄 = WS_INDEXABLE=0. 6번 × 5초 재시도). caddy.env 는 쓰지 않는다(basic_auth 폐기 — 옛 서버에 남아 있어도 무시, 아래 'basic_auth 제거 반영').

`deploy.sh deploy <tag>` 순서:

1. 잠금(`state/.lock`, 안에 `info` = pid·시작 시각) → 사전 점검: `server.env` 존재·권한 600·`__SET_ME__` 없음(caddy.env 는 보지 않는다).
2. `docker pull` → 이미지 아키텍처 = 호스트(arm64) 확인. 다르면 중단(아무것도 바꾸지 않음).
3. 현재 이미지와 새 이미지의 `prisma/migrations` 목록 비교. 한쪽이라도 목록을 읽지 못하면(docker 실패·빈 목록) '같음'으로 보지 않고 **배포하지 않는다**(app·DB 그대로, 종료 1 — QA133 LOW-12). rollback 도 같다.
4. `app` 정지 → 배포 전 백업 `data/backup/prod-<UTC>-predeploy.db`(이름이 `prod-*.db`라 7일·5개 정리 대상 — 처리방침 백업 7일과 같음). DB 가 있는데 백업이 실패하면 배포하지 않고 이전 이미지를 다시 띄운다(종료 1).
5. `state/image.env` 교체 → `compose up -d` → 헬스(기본 150초, 컨테이너 `/health`).
6. 성공: `state/current`·`state/previous`·`state/predeploy` 갱신, current·previous 밖 이미지 삭제, `data/backup` 의 고아 짝 파일 정리(짝 `prod-*.db` 가 없는 `prod-*.db-journal`·`-wal`·`-shm` 중 7일 넘은 것 — `prune-backups.sh` 는 `.db` 기준이라 짝 없는 사본이 남던 것, security 139 LOW-7). rollback 성공 뒤에도 같다.
7. 실패: `app` 정지 → 마이그레이션이 달랐으면 배포 전 백업을 `prod.db`로 복원 → 이전 이미지로 기동. 종료 코드 1(롤백 성공) / 3(롤백도 실패). 마이그레이션이 다른데 복원을 못 하면 이전 이미지를 새 스키마 DB 위에 띄우지 않고 **app 정지 상태로 종료 3**(수동 복원). 배포 전에 DB 가 없었으면(첫 DB) 새 이미지가 만든 DB 를 `data/backup/prod-<UTC>-faileddeploy.db` 로 치우고 이전 이미지를 'DB 없음' 상태에서 띄운다(치우지 못하면 정지, 종료 3).
   - 복원 순서(rollback 도 같음): 남은 `prod.db.restore` 치움 → 백업을 `prod.db.restore` 로 복사 → **지금 DB(+ `-journal`·`-wal`)를 `data/backup/prod-<UTC>-prerollback.db` 로 복사** → 지금 DB 의 `-journal`·`-wal`·`-shm` 을 옆(`.prerestore`)으로 옮김 → `mv prod.db.restore prod.db`. 마지막 `mv` 가 실패하면 옮긴 짝 파일을 되돌린다(지금 DB 와 그 journal 그대로). 성공 뒤에만 옮긴 짝 파일을 지운다. `prerollback`·`faileddeploy` 도 `prod-*.db` 이름이라 7일·5개 정리 대상.
8. SSH 끊김·러너 취소: 배포 키는 `restrict`(pty 없음)라 끊겨도 HUP 가 오지 않고, 다음 출력 쓰기에서 SIGPIPE 가 난다. `deploy.sh` 는 SIGPIPE 를 무시하고 화면 출력 실패를 무시하며, docker 출력은 화면이 아니라 `state/deploy.log` 로만 보낸다 → **끊겨도 끝까지 진행**(성공·자동 롤백까지). 결과는 서버의 `state/deploy.log`(이번 실행)·`state/deploy.log.1`(직전 실행)에 남는다(이미지 태그·단계·docker 출력, 접속 IP 없음). 마지막 줄이 `종료 코드 N` 이다. 워크플로가 끊겨 실패로 보이면 다음 배포 전에 관리자가 이 파일로 결과를 본다(`sudo -u deploy tail -n 20 /opt/withsmall/state/deploy.log` — `state/` 는 0700 deploy 소유라 관리 계정은 `sudo -u deploy` 필요).
9. 신호(Ctrl-C·TERM·HUP — 사람이 보낸 것): 잠금을 풀고 바로 멈춘다(129·130·143). 진행 중이던 단계(app 정지 등)는 그대로일 수 있다 → 같은 명령을 다시 보내면 이어서 맞춘다. 단 DB 를 바꾸는 단계 도중이었으면 `state/dbchange` 가 남아 다시 보내도 거부된다(11, 관리자 확인 필요).
10. 남은 잠금(kill -9·OOM·재부팅): 잠금의 pid 에 실행 중인 `deploy.sh` 가 없고 10분(`WS_LOCK_STALE_SEC`, 기본 600초)이 지났으면 **같은 `deploy`/`rollback` 명령이 잠금을 회수**하고 진행한다(배포 키로 가능, 관리자 `rmdir` 불필요). pid 가 살아 있으면 오래돼도 거부.
11. DB 를 바꾸는 단계(새 이미지 기동 = 마이그레이션, 복원, 새 DB 치우기)에 들어갈 때 `state/dbchange` 표시를 둔다. **지우는 것은 DB 와 `image.env` 가 맞는 채 끝난 종료 0·1 뿐**(배포 성공, 자동 롤백 성공, 첫 배포 실패로 정지, rollback 성공, 복원 실패 후 원래 이미지 재기동). **종료 3(app 정지·수동 복원), 신호(129·130·143), kill -9·OOM·재부팅이면 남는다**(QA131 MED-4). 남아 있으면 다음 `deploy`/`rollback` 을 **docker 를 한 번도 부르지 않고 거부**한다 — 종료 3 뒤 같은 배포나 지금 태그를 다시 보내도 이전 이미지를 새 스키마 DB 위에 띄우지 않는다. 거부된 실행은 `deploy.log` 를 돌리지 않고 끝에 `거부된 실행`·`FAIL` 줄만 덧붙인다(중단된 실행의 기록 유지, QA131 LOW-11). 관리자가 아래 수동 조치로 확인한 뒤 `sudo -u deploy rm /opt/withsmall/state/dbchange`. 배포 키로는 풀 수 없다(의도). 남길 때 `deploy.log` 에 이유를 적는다 — `확인 지점 전에 끝남`(DB·image.env 가 어긋났을 수 있음) 또는 `확인 지점은 지났으나 종료 코드 N`(맞게 끝난 뒤 신호 등). 표시 파일을 쓰지 못하면(디스크 등) DB 를 바꾸는 단계로 가지 않고 이전 이미지를 다시 띄운 뒤 종료 1(QA133 INFO-10).

`deploy.sh rollback`: current ↔ previous. 마이그레이션이 다르면 `state/predeploy` 백업을 복원한다 — **그 배포 뒤에 쓰인 데이터(저장 연결 등)는 사라진다.** 이전 이미지(로컬 또는 pull)와 백업 파일이 있는지는 **app 을 멈추기 전에** 확인한다 — 백업이 이미 정리됐거나 이미지를 못 받으면 서비스를 그대로 둔 채 거부(종료 1, 수동 복원). 복원 전에 지금 DB 를 `data/backup/prod-<UTC>-prerollback.db` 로 복사하므로, 복원 뒤 이전 이미지 헬스가 실패(종료 3)해도 배포 뒤 데이터로 되돌아갈 수 있다(7일·5개 정리 전까지). 복원 명령이 실패하면 지금 DB 는 그대로(짝 파일 포함) 두고 지금 이미지로 다시 띄운다(종료 1).

- 병원 제보 보존 시계(264, 마이그레이션 `20261102000000_vet_report_created_at`): 이 마이그레이션 **전** 백업을 복원한 뒤 다시 배포하면 마이그레이션이 다시 돌아 그 백업 속 사용자 제보의 `createdAt` 을 재배포 시각으로 채운다 — 그 제보들의 180일 보존 시계가 다시 시작된다(최대 보존 = 재배포 시각 + 180일). 복원·재배포 날짜를 내부 기록에 남긴다.
- 옛 이미지(이 마이그레이션 전 코드)가 새 스키마 DB 위에서 돌면(수동 기동 등) 그동안 받은 제보는 `createdAt` 이 빈 값('')으로 저장되고, 새 이미지로 돌아온 뒤 **다음 정리 때 바로 삭제된다**(빈 값 < 기준 시각). 옛 이미지를 새 스키마에 띄우지 않는 것이 원칙(위 11번 `state/dbchange`)이다.

수동 조치(종료 코드 3 또는 첫 배포 실패). `state/` 는 0700 deploy 소유(`bootstrap.sh`)이고 docker 는 deploy 계정이 docker 그룹이라, 관리 계정(`ubuntu`)에서는 아래처럼 `sudo -u deploy` 로 실행한다(QA131 LOW-10):

- 상태 보기: `sudo -u deploy docker compose -p withsmall -f /opt/withsmall/compose.yaml --env-file /opt/withsmall/state/image.env ps`, 로그 `sudo journalctl -t withsmall-app --since -30min`, 배포 기록 `sudo -u deploy cat /opt/withsmall/state/deploy.log`(직전 실행 `deploy.log.1`, 마지막 줄 `종료 코드 N`).
- 복원: 3절과 같다. `app` 정지 → `data/backup/`의 원하는 `prod-*.db`를 `data/prod.db`로 복사(이미지 안 `sh`로: `sudo -u deploy docker run --rm --entrypoint sh -v /opt/withsmall/data:/data <이미지> -c 'cp /data/backup/<파일> /data/prod.db'`) → `state/image.env`를 원하는 이미지로(`echo 'WS_IMAGE=<이미지>' | sudo -u deploy tee /opt/withsmall/state/image.env`) → `sudo -u deploy docker compose … up -d`(위 상태 보기와 같은 옵션).
  - **헬스가 초록이 된 뒤 `state/current` 를 띄운 이미지로 맞춘다**(QA138 LOW-14): `echo '<이미지>' | sudo -u deploy tee /opt/withsmall/state/current`. 맞추지 않으면 다음 배포의 마이그레이션 비교·자동 롤백 기준이 실제로 돌고 있지 않은 옛 이미지가 된다. `state/previous` 가 띄운 이미지와 같으면 지운다(`sudo -u deploy rm /opt/withsmall/state/previous` — rollback 이 같은 이미지로 '되돌리지' 않게), `state/predeploy` 는 이 복원과 맞지 않으므로 지운다(`sudo -u deploy rm -f /opt/withsmall/state/predeploy` — 다음 rollback 이 엉뚱한 백업을 복원하지 않게, 그 경우 rollback 은 거부되고 수동 복원).
- **마이그레이션 목록을 못 읽어 deploy·rollback 이 계속 거부되면**(QA138 LOW-14 — 메시지 `마이그레이션 목록을 읽지 못함(<current> / <새 이미지>)`, app·DB 는 그대로): 거의 늘 `state/current` 이미지 쪽 문제다(새 이미지는 방금 pull 됨).
  1. 원인 보기: `sudo -u deploy tail -n 30 /opt/withsmall/state/deploy.log`(docker 오류 줄).
  2. 지금 이미지가 로컬에 있는지: `sudo -u deploy docker image inspect "$(sudo -u deploy cat /opt/withsmall/state/current)" >/dev/null && echo present`. 없으면 `sudo -u deploy docker pull "$(sudo -u deploy cat /opt/withsmall/state/current)"` 뒤 같은 배포를 다시 보낸다.
  3. 레지스트리에서도 지워졌으면(패키지 정리 등): 먼저 지금 DB 를 백업한다(`app` 정지 → `sudo -u deploy docker run --rm --network none --entrypoint sh -v /opt/withsmall/data:/data <돌던 것과 같은 커밋의 이미지 또는 아무 앱 이미지> -c 'cp /data/prod.db /data/backup/prod-'"$(date -u +%Y%m%dT%H%M%SZ)"'-manual.db'` → `up -d`). 그다음 **돌던 이미지와 같은 마이그레이션 목록을 가진, 존재하는 태그**를 고른다 — 같은 커밋을 다시 빌드·푸시하는 것이 가장 확실하다(main 에서 그 커밋으로 `deploy`, 또는 로컬 `docker build` 뒤 같은 태그로 push). 고른 태그를 `echo 'ghcr.io/<owner>/<repo>:sha-<12>' | sudo -u deploy tee /opt/withsmall/state/current` 로 적고 배포를 다시 보낸다.
  4. 하지 말 것: `state/current` 를 지워 '첫 배포'로 만드는 것 — 진행은 되지만 배포 전 백업·마이그레이션 비교·자동 롤백이 모두 빠지고 `previous` 도 없어 rollback 이 안 된다.
  5. 디스크·docker 데몬 장애면(`df -h /`, `systemctl status docker`) 그것부터 고친다 — 고친 뒤 같은 명령이 그대로 통과한다.
- 남은 잠금: 보통은 같은 명령 재실행으로 회수된다(위 10). 바로 풀어야 하면 다른 배포가 없는지(`sudo -u deploy cat /opt/withsmall/state/.lock/info` 의 pid) 확인 후 `sudo -u deploy rm -r /opt/withsmall/state/.lock`.
- `state/dbchange` 가 남아 배포가 거부되면: 내용(`sudo -u deploy cat /opt/withsmall/state/dbchange` — 어느 배포·복원 도중이었는지)과 `deploy.log` 를 보고, `state/image.env` 의 이미지와 `data/prod.db` 의 스키마가 맞는지 확인·필요하면 위 복원(원래 DB 는 그 줄에 적힌 `배포 전 백업` 파일) → `sudo -u deploy rm /opt/withsmall/state/dbchange` → 배포 키로 같은 명령을 다시 보낸다.

**베이스 이미지 갱신(security 139 LOW-3).** `Dockerfile` 의 `node:22-alpine` 세 단계와 `compose.yaml` 의 `caddy` 는 다이제스트(`@sha256:…`)로 고정한다 — 같은 태그가 다른 내용으로 바뀌어도 빌드·배포가 따라가지 않는다. 지금 값: `caddy:2.11-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f`(2.11.7, 2026-10-28 고정), node 는 `Dockerfile` 머리 주석.

1. Dependabot(`.github/dependabot.yml`, 매주 월요일)이 `docker`(Dockerfile)·`docker-compose`(deploy/compose.yaml) 갱신 PR 을 연다. 손으로 할 때: `docker buildx imagetools inspect node:22-alpine`·`docker buildx imagetools inspect caddy:2.11-alpine` 의 맨 위 `Digest:`(멀티 아키텍처 **인덱스** 다이제스트 — 아래 플랫폼별 다이제스트가 아니다)를 넣는다. node 는 세 `FROM` 줄을 같은 값으로(테스트가 본다).
2. PR 에서 CI 초록 확인 — `docker build + boot smoke` 가 read-only·상한 그대로 기동하는지, `scripts/__tests__/deploy-config.test.mjs` 가 다이제스트 형식·문서 일치를 본다(caddy 를 바꾸면 이 절의 값도 같은 값으로).
3. caddy 마이너 변경(2.11 → 2.12)이면 로컬에서 한 번: `docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" <새 이미지> caddy validate --config /etc/caddy/Caddyfile` 와 200·502 응답에 `X-Robots-Tag` 가 붙고 `Server` 가 없는지(2026-10-28 2.11.7 에서 확인).
4. 병합 → main 에서 `deploy`. caddy 이미지만 바뀐 경우에도 서버의 `/opt/withsmall/compose.yaml` 은 bootstrap 이 복사한 것이므로 `sudo install -m 0644 deploy/compose.yaml /opt/withsmall/compose.yaml` 로 바꾼 뒤 배포(또는 `sudo -u deploy docker compose … up -d caddy`).
5. Actions(SHA 고정, `uses: owner/action@<40자> # vX.Y.Z`)도 Dependabot `github-actions` PR 로만 바꾼다 — 손으로 바꿀 때는 `git ls-remote https://github.com/<owner>/<action>.git refs/tags/vX.Y.Z` 의 커밋 SHA(주석 태그면 `^{}` 줄).

**basic_auth 제거 반영 — 이미 bootstrap 된 서버(ORDERS §40, 작업 256).** 서버의 `compose.yaml`·`Caddyfile`·`bin/deploy.sh` 는 bootstrap 이 복사한 옛판이고 CI 배포는 이 셋을 바꾸지 않는다(이미지만 바꾼다). 순서가 중요하다 — 옛 `compose.yaml` 은 `./caddy.env` 를 요구하고 옛 `deploy.sh` 는 caddy.env 를 사전 점검하므로, **세 파일을 먼저 바꾸고 caddy.env 는 마지막에** 지운다.
1. 새 `deploy/` 를 서버로(`scp -r deploy ubuntu@<IP>:~/`).
2. 권장(최소 변경): `sudo install -m 0644 -o root -g root ~/deploy/compose.yaml /opt/withsmall/compose.yaml && sudo install -m 0644 -o root -g root ~/deploy/Caddyfile /opt/withsmall/Caddyfile && sudo install -m 0755 -o root -g root ~/deploy/deploy.sh /opt/withsmall/bin/deploy.sh && sudo rm -f /opt/withsmall/caddy.env`.
   또는 bootstrap 재실행(멱등 — 8절 B2 와 같은 인수, 같은 배포 공개키): `compose.yaml`·`Caddyfile`·`deploy.sh`·`deploy-gate.sh` 를 매번 덮어쓰고 옛 `caddy.env` 를 지운다. `server.env` 는 있으면 그대로 둔다(시크릿 재생성 없음). sshd·방화벽·journald 설정도 다시 쓰므로 끝난 뒤 새 터미널에서 관리 계정 접속을 먼저 확인한다.
3. Actions `deploy` 1회. caddy 서비스 설정(env_file 제거)이 바뀌었으므로 `deploy.sh` 의 `up -d` 가 caddy 컨테이너를 다시 만들고 새 Caddyfile(비밀번호 없음)을 읽는다. 외부 확인이 `external status: 200 · robots.txt 200 Disallow-all=yes · X-Robots-Tag noindex=yes` 면 끝.
   caddy 가 아직 한 번도 뜨지 않은 서버(첫 배포 전)면 1·2 뒤 8절 E 첫 배포가 곧 이 단계다.

## 7. 로그·접속 기록 (처리방침과 같아야 함)

- **웹 접속 기록(IP·요청 주소)은 남기지 않는다.** Caddy: 사이트 블록에 `log` 없음 + 기본 로거에서 `http` 네임스페이스 전체 제외(오류 기록에 들어가는 요청·IP 포함 차단). 앱: 요청 로거 없음, 요청 처리 중 콘솔 출력 0(테스트 `server/src/__tests__/no-access-log.test.ts`, `scripts/__tests__/deploy-config.test.mjs`).
- 남는 것: 앱 기동·오류 기록(메일 실패 시 가린 이메일 `a***@g***.com` 형태), Caddy 인증서 발급 기록. 모두 journald, **7일·500M**(`bootstrap.sh` `JOURNAL_DAYS` = `policy.ts` `SERVER_LOG_RETENTION_DAYS`).
- 7일 보장(QA122 HIGH-1): journald `MaxRetentionSec` 는 닫힌(archived) 파일만 지우고 활성 파일은 기본 한 달까지 열려 있다. 그래서 `bootstrap.sh` 가 (1) 드롭인 `/etc/systemd/journald.conf.d/zz-withsmall.conf` 에 `MaxFileSec=1day`(매일 순환)·`MaxRetentionSec=7day`·`ForwardToSyslog=no`, (2) 매일 타이머 `withsmall-journal-vacuum.timer` → `journalctl --rotate --vacuum-time=5d`(파일 하나가 최대 하루 + 타이머 지연 여유 하루 → 가장 오래된 항목 ≤ 7일)를 둔다.
- syslog 사본 0: rsyslog 가 깔린 이미지(Ubuntu `/usr/lib/systemd/journald.conf.d/syslog.conf` 가 ForwardToSyslog=yes 를 켬, logrotate 4주)에서도 `/var/log/syslog`·`/var/log/messages` 에 앱·Caddy 기록이 남지 않게 — `ForwardToSyslog=no`(드롭인 이름 `zz-` 가 `syslog.conf` 뒤라 이긴다) + `/etc/rsyslog.d/00-withsmall-drop.conf`(`withsmall-*` 태그 `stop`, Oracle Linux 의 `imjournal` 경로도 막음). 컨테이너 로그 드라이버는 compose 에서 서비스마다 `journald`(json-file 은 시간 기준 정리가 없어 쓰지 않는다).
- 호스트 sshd 기록(SSH 시도 IP 포함): Ubuntu 에서는 `ForwardToSyslog=no` 가 withsmall 만이 아니라 **모든** syslog 전달을 끄므로(QA127 INFO-1) `/var/log/auth.log`·`/var/log/syslog` 에는 드롭인 적용 뒤 새 기록이 쌓이지 않고, sshd 기록 전체는 **journald 에 7일**(같은 `MaxRetentionSec`·vacuum) 남는다 — 보기 `journalctl -u ssh --since -1d`(Oracle Linux 는 imjournal 경로라 `/var/log/secure` 에도 남는다).
- **운영자 접속 기록만 따로 1년**(security 139 MED-3, Kenny 승인 "운영자 기록만 따로 1년 보관" — 안전성 확보조치 기준 제8조 개인정보취급자 접속기록 1년 이상): `bootstrap.sh` 가 `/usr/local/sbin/withsmall-admin-log-export` 를 설치하고 **매시**(`withsmall-admin-log.timer`) + **journal vacuum 직전**(`withsmall-journal-vacuum.service` 의 `ExecStartPre`) 실행한다.
  - 고르는 것: journald 의 `SYSLOG_FACILITY=4`(auth — sshd·logind)·`10`(authpriv — sudo·pam) 줄 중 **운영 계정 이름**(`/etc/withsmall-admin-users` = `deploy` + `--admin-user`, sshd `AllowUsers` 와 같음)이 낱말로 들어간 줄과, `deploy.sh` 단계 줄(태그 `ws-admin-deploy` — `log()` 가 `logger -p authpriv.info` 로 보냄: 시작·이미지 태그·단계·결과·종료 코드). 운영 계정이 아닌 이름으로 두드린 시도는 고르지 않고, **운영 계정 이름을 댄 스캐너 줄도 뺀다**(security 150 MED-A — sshd 의 `[preauth]`·`Failed `·`Invalid user`·`Connection closed by authenticating user`·`Disconnected from authenticating user` 줄, 접속한 곳 IP 가 제3자). 남는 것: `Accepted`(로그인 성공), session opened/closed, sudo, logind, `ws-admin-deploy`. 뺀 줄은 7일 journald 에만.
  - 저장: `/var/log/withsmall-admin/access.log`(폴더 0700·파일 0600 root). 이메일 형태는 `<email>` 로 가린다 — `@`·`%40`·전각 `＠`·`(at)`·`[at]`·`낱말 at 도메인꼴` 을 품은 덩어리(따옴표 로컬 파트·`=` 포함, 비 ASCII·IDN 포함)를 과잉 가림으로 통째로(여는 따옴표 뒤 `@` 까지는 열린 구간도 가림. 못 가리는 형태: `&#64;`·`%u0040`·`\x40`·`@` 를 띄어 쓴 것·`( at )`·유니코드 공백 at·도메인꼴이 아닌 `at`(`kim at localhost`·IP·`at … dot com` 풀어쓰기 — `at now` 같은 명령을 지키려고 좁힌 결과)·`%2540`·`﹫`;150 LOW-1·152 LOW-2; 4절 삭제 명령은 표준 입력을 써 명령줄에 이메일이 없다 — 가림은 실수 입력 대비 방어선). 커서 파일(`/var/lib/withsmall-admin/cursor`)로 이어 읽어 중복·누락이 없고, 실패하면 커서를 되돌려 다음 실행이 다시 읽는다. `deploy.sh` 의 docker 출력(`state/deploy.log`)은 지금처럼 두 번만.
  - 보관: `/etc/logrotate.d/withsmall-admin` — **매일 순환, 366개·`maxage 366`, `ifempty`**(빈 날도 순환해 파일 하나 = 하루, `ADMIN_LOG_DAYS=366`) → **1년**(security 150 MED-B — 처리방침 보유 기간 표의 '운영자 접속 기록 1년'과 같은 값, `deploy-config.test.mjs` 패리티). 정기 점검: 월 1회 `sudo tail -n 50 /var/log/withsmall-admin/access.log`(모르는 IP 의 `Accepted`·예정 없는 `sudo` 확인).
  - 바뀌지 않는 것: 웹 접속 기록 0(Caddy·앱), 앱·Caddy 기록(`withsmall-*`)과 그 밖의 호스트 기록은 journald 7일(`SERVER_LOG_RETENTION_DAYS`) 그대로 — 내보내기는 auth·authpriv 만 읽고 `withsmall-*` 태그를 고르지 않는다.
  - 처리방침: 이 기록은 이용자가 아니라 운영자(와 배포 러너)의 서버 접속 기록이라 '웹 접속 기록 남기지 않음'·'서버 오류 기록 7일' 문구와 모순되지 않는다. 처리방침에 반영됨(lane 151): '개인정보 보호 조치' 목록에 운영자 접속 기록 1년 별도 보관 문장, '보유 기간' 표에 '운영자 접속 기록 — 1년' 행(`server/src/prerender/privacy-content.ts`). 보관 일수를 바꾸면 이 행·`ADMIN_LOG_DAYS` 를 함께 바꾸고 공개 후에는 시행 7일 전 고지.
  - 관리 계정은 하나(`--admin-user`)다. 바꾸면 bootstrap 을 다시 돌려 `/etc/withsmall-admin-users`·`AllowUsers` 를 함께 바꾼다 — 목록 밖 계정의 sudo 는 1년 기록에 들어가지 않는다(QA148 INFO-3). sudo 명령줄에 비밀을 넣지 않는다(`docker login --password-stdin` — 이메일 외 값은 가리지 않고 1년 남는다, INFO-4).
  - 서버 확인: `systemctl list-timers withsmall-admin-log.timer`, `sudo systemctl start withsmall-admin-log.service && sudo tail -n 5 /var/log/withsmall-admin/access.log`, `sudo logrotate -d /etc/logrotate.d/withsmall-admin`(오류 없음).
- sshd 강화(security 139 LOW-5, `/etc/ssh/sshd_config.d/10-withsmall.conf`): `AllowUsers deploy <관리 계정>`, `AllowTcpForwarding no`·`AllowAgentForwarding no`·`AllowStreamLocalForwarding no`·`X11Forwarding no`·`PermitTunnel no`(배포 키는 `restrict` 로 이미 막혀 있고 이것은 관리 계정까지). `bootstrap.sh` 는 관리 계정의 `~/.ssh/authorized_keys` 가 비었으면 아무것도 바꾸기 전에 멈춘다(잠김 방지). 호스트 이름이 `deploy`·관리 계정 이름과 같아도 멈춘다 — 기록 줄 머리의 호스트 이름 때문에 거의 모든 auth 줄이 1년 기록에 들어가므로(QA152 LOW-1, `sudo hostnamectl set-hostname withsmall`). 관리 계정을 바꾸려면 `--admin-user` 로 bootstrap 을 다시 돌린다(멱등). 확인: `sudo sshd -T | grep -E '^(allowusers|allowtcpforwarding|allowagentforwarding|x11forwarding|permittunnel|permituserenvironment) '`.
- 하지 않는 것: OCI VCN Flow Logs·OCI Logging 에이전트 켜기(접속 IP 가 남는다). 켜려면 처리방침부터 바꾼다.
- 로그를 바꾸는 변경(접속 기록 켜기, 보관 일수 변경)은 처리방침 변경 = 공개 후 시행 7일 전 고지.

## 8. Oracle Cloud 준비 (Kenny 콘솔 체크리스트, D6)

순서대로. 값(IP·키·비밀번호)은 이 문서·저장소에 적지 않는다.

**A. OCI 콘솔 (리전 ap-tokyo-1)**

1. 네트워킹 → 가상 클라우드 네트워크 → "인터넷 연결이 있는 VCN 생성" 마법사(공용 서브넷 + 인터넷 게이트웨이 + 기본 라우트가 만들어짐).
2. 공용 서브넷의 기본 Security List → 수신 규칙 추가(소스 `0.0.0.0/0`): TCP 80, TCP 443, UDP 443. TCP 22 는 마법사 기본값 유지(GitHub Actions 러너 IP 가 고정이 아니라 좁힐 수 없음 — 키 전용 + 강제 명령으로 막는다, 위험 R7).
3. 컴퓨트 → 인스턴스 생성: 이미지 **Canonical Ubuntu 24.04**(aarch64), 셰이프 **VM.Standard.A1.Flex 1 OCPU / 6 GB**(Always Free 범위, 2026-11-02 생성. `compose.yaml` cpus 는 서비스마다 1.0 이하여야 한다. 올리면 cpus 도 함께 조정, Ubuntu 24.04 Minimal 이미지도 bootstrap 이 필요한 패키지를 설치한다), 위 공용 서브넷, 공용 IPv4 할당, Kenny 의 관리용 SSH 공개키 등록. 용량 부족(Out of host capacity)이면 다른 가용 도메인·나중에 재시도.
4. 네트워킹 → IP 관리 → **예약된 공용 IP** 생성 → 인스턴스 → 연결된 VNIC → IPv4 주소 → 기본 사설 IP 편집 → 공용 IP 없음으로 바꿨다가 예약된 공용 IP 선택(임시 IP → 예약 IP). Always Free 에서 무료인지 콘솔 비용 표시로 확인(위험 R5).
5. VCN Flow Logs·Logging 은 켜지 않는다(7절).
6. (권장) 유휴 회수 방지: 결제 → 종량제(PAYG) 업그레이드 + 예산 0원 알림(위험 R2, 공식 문서 재확인).

**B. 서버 (Kenny 관리 계정 `ubuntu`로 SSH)**

1. GitHub Actions 용 배포 키 쌍을 **Kenny PC 에서** 만든다: `ssh-keygen -t ed25519 -C gha-deploy -f withsmall_deploy -N ""` (비밀키 `withsmall_deploy` 는 GitHub Secret 에만, PC 사본은 등록 뒤 삭제).
2. 저장소 `deploy/` 폴더와 공개키를 서버로 복사(`scp -r deploy withsmall_deploy.pub ubuntu@<IP>:~/`) → 서버에서 `sudo sh ~/deploy/bootstrap.sh --image-repo ghcr.io/<owner 소문자>/<repo 소문자> --deploy-pubkey "$(cat ~/withsmall_deploy.pub)" --admin-user ubuntu`(공개키 내용을 따옴표로. `--admin-user` 를 빼면 sudo 를 부른 사용자. sshd `AllowUsers` 가 deploy + 이 계정만 남기므로 **bootstrap 뒤 새 터미널에서 관리 계정 SSH 접속이 되는지 먼저 확인**하고 기존 세션을 닫는다).
3. (삭제 — ORDERS §40, basic_auth 폐기. caddy.env 를 만들거나 채우지 않는다. 번호는 B4·B5 참조를 지키려고 남긴다.)
4. GHCR 로그인(deploy 사용자): GitHub → Settings → Developer settings → **classic PAT**, 범위 `read:packages`만, 만료일 지정(위험 R11 — **만료 7일 전 알림을 달력에 넣는다**: 만료되면 `docker pull` 이 실패해 배포가 `pull 실패` 로 멈춘다. 갱신은 같은 범위로 새 PAT → 아래 로그인 다시, security 150 LOW-3) → `sudo -u deploy -H docker login ghcr.io -u <github 사용자> --password-stdin`(붙여넣고 Enter, Ctrl-D. `-H` 로 로그인 정보가 deploy 홈 `~/.docker/config.json` 에 저장된다 — deploy.sh 의 pull 이 쓴다).
5. 호스트 키 지문 기록: `ssh-keyscan -t ed25519 <예약 IP>` 출력(한 줄)을 `DEPLOY_KNOWN_HOSTS` 로. 지문은 서버에서 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 와 같은지 확인.
6. 확인: `sudo iptables -L INPUT -n --line-numbers`(80·443 ACCEPT 가 REJECT 보다 위), `ls -l /opt/withsmall`(server.env `-rw-------`, caddy.env 없음), `journalctl --disk-usage`.
7. 로그 보관 확인(처리방침 '서버 오류 기록 7일'): `systemd-analyze cat-config systemd/journald.conf | grep -E 'ForwardToSyslog|MaxFileSec|MaxRetentionSec'`(마지막 값이 `no`·`1day`·`7day`), `systemctl list-timers withsmall-journal-vacuum.timer`(다음 실행 있음), `dpkg -l rsyslog`(있으면 `ls /etc/rsyslog.d/00-withsmall-drop.conf`). 첫 배포 뒤 `journalctl -t withsmall-app --since -1h | head`(기록이 journald 에 있음), `journalctl -u ssh --since -1h | head`(sshd 기록도 journald 에), `sudo grep -c withsmall /var/log/syslog`(파일이 있으면 0 — Ubuntu 는 전달 자체가 꺼져 자명하게 0, Oracle Linux 는 `/var/log/messages` 로 확인해야 rsyslog 버림 규칙 검증이 된다). 운영자 접속 기록(7절): 첫 배포 뒤 `sudo systemctl start withsmall-admin-log.service && sudo grep -c ws-admin-deploy /var/log/withsmall-admin/access.log`(1 이상), `sudo grep -c withsmall-app /var/log/withsmall-admin/access.log`(0).

**C. DNS (LETO — DNS 는 LETO 유지)**

1. LETO 도메인 관리 → withsmall.kr → DNS(레코드) 관리.
2. `@` A 레코드 → 예약 공용 IP, TTL 300. `www` CNAME → `withsmall.kr`(CNAME 불가하면 같은 IP 로 A). **AAAA 넣지 않음.** CAA 는 선택(`0 issue "letsencrypt.org"`).
3. 전파 확인: `nslookup withsmall.kr 8.8.8.8` 과 `nslookup www.withsmall.kr 8.8.8.8` 이 예약 IP 를 돌려준 뒤에 첫 배포(Caddy 가 인증서를 바로 발급 — 전파 전이면 발급 실패·재시도 지연).

**D. GitHub (저장소 Settings → Secrets and variables → Actions)**

- Secrets: `DEPLOY_SSH_KEY`(B1 비밀키 전체), `DEPLOY_HOST`(예약 IP), `DEPLOY_KNOWN_HOSTS`(B5 한 줄), `DEPLOY_USER`(`deploy`).
- Variables: `SITE_ORIGIN`=`https://withsmall.kr`, `WS_INDEXABLE`=`0`, `TARGET_PLATFORM`=`linux/arm64`, `VITE_NAVER_MAP_CLIENT_ID`(선택 — NCP 콘솔 Web 서비스 URL 에 `https://withsmall.kr` 등록 후).
- **workflow_dispatch 는 워크플로 파일이 기본 브랜치에 있어야 실행된다.** 2026-11-01 main 병합 완료(11fcd72)로 이 조건은 충족됐다.

**E. 첫 배포**

- **basic_auth 없는 배포 전에(Kenny): 처리방침 6값(`officerName`·`officerEmail`·`hostingContact`·`resendContact`·`resendLogRetention`·`effectiveDate`) 채우기와 `server.env` 의 `WS_ALLOW_PRIVACY_PLACEHOLDER` 줄 삭제 여부를 확인한다** — 비밀번호가 없으면 `/privacy` 의 자리표시가 누구에게나 보인다(security 257).

0. 배포할 커밋에 `ci.yml` 이 초록이어야 한다(PR 을 열어 CI 를 돌린다 — 없거나 진행 중·실패면 `build-push` 첫 단계에서 멈춘다).
1. Actions → `Deploy (internal test)` → Run workflow → 브랜치 **`main`**, action `deploy`. (CLI: `gh workflow run deploy.yml --ref main -f action=deploy`.) main 이 아니면 첫 job `require-main` 이 실패하고 아무것도 빌드·배포하지 않는다(security 139 LOW-1 — 운영자 실수 방지이지 보안 경계는 아니다: 다른 브랜치의 워크플로 파일은 이 검사를 지울 수 있다). 그래서 이 브랜치가 main 에 합쳐진 뒤부터 배포한다. QEMU arm64 빌드라 15~40분.
2. 성공 기준: `build-push` 초록 → `deploy` 로그 `[deploy] OK ghcr.io/...:sha-…` → 외부 확인 `external status: 200 · robots.txt 200 Disallow-all=yes · X-Robots-Tag noindex=yes`.
3. 브라우저로 `https://withsmall.kr` → (비밀번호 창 없이) 홈. `curl -sI https://withsmall.kr/ | grep -i x-robots-tag` 에 `noindex, nofollow`, `curl -s https://withsmall.kr/robots.txt` 가 `Disallow: /`. `/privacy` 에 국외 이전(일본·Oracle) 블록, 페이지 끝 자리표시 경고는 E 앞 줄(처리방침 6값·`WS_ALLOW_PRIVACY_PLACEHOLDER` 줄 확인, Kenny)을 거친 경우에만 정상 — 비밀번호가 없어 누구에게나 보인다(QA262 LOW-6).
4. 저장 연결(메일)은 Resend 인증 전이라 503(저장 불가 안내)이 정상.
5. 롤백 연습: action `rollback`(previous 가 있을 때만 — 두 번째 배포 뒤).

## 9. 공개 전환 체크리스트 (D8, Kenny 결정)

- [ ] **순서: 자리표시를 먼저 채운 뒤에 WS_INDEXABLE=1 로 재빌드** — 공개 빌드는 자리표시가 남으면 WS_ALLOW_PRIVACY_PLACEHOLDER=1 이어도 기동을 거부한다(app 헬스 실패 → deploy.sh 자동 롤백)
- [ ] 처리방침 자리표시 전부 채움(`officerName`·`officerEmail`·`hostingContact`·`resendContact`·`resendLogRetention`·`effectiveDate`) → `server.env` 에서 `WS_ALLOW_PRIVACY_PLACEHOLDER` 줄 삭제
- [ ] 접속 기록·개인정보 처리 시스템 접속 기록 보관 의무 법적 확인(웹 접속 기록 0 유지 가능한지). 운영자 접속 기록 1년은 구현됨(7절, Kenny 승인) — 처리방침 반영됨(보호 조치 문장·보유 기간 행), 법적 확인 때 함께 본다
- [x] **1단계 접근 공개**: Caddyfile 에서 basic_auth 제거 · caddy.env 폐기 · deploy.yml 외부 확인 401 → 200 + noindex·robots Disallow 확인 — **§40 완료**(Kenny 2026-11-02, 작업 256). 검색 노출 차단(`X-Robots-Tag`·WS_INDEXABLE=0)은 그대로
- [ ] **2단계 색인 공개(Kenny 별도 결정)**: Variables `WS_INDEXABLE=1` 후 재빌드 · Caddyfile 의 `header`·`handle_errors` 에서 `X-Robots-Tag` 제거(이 단계에서만) · www 302 → 308 · HSTS 단계 적용(짧은 max-age 부터) · deploy.yml 외부 확인의 robots(`Disallow: /` → `Allow: /`)·noindex 기준과 `scripts/__tests__/deploy-config.test.mjs` 를 같이 바꾼다
- [ ] Resend 발신 도메인 인증 + `MAIL_TRANSPORT=resend`(10절)
- [ ] 외부 백업(OCI Object Storage, 7일 수명 주기 — `erasures.jsonl` 포함) · PAYG 업그레이드
- [ ] 제휴 도메인 등록(공개 시점) · NCP 지도 URL

## 10. Resend 설정 점검 목록 (Kenny 확인 항목)

- [ ] 발신 도메인 인증(SPF·DKIM) 완료
- [ ] click tracking 끔
- [ ] open tracking 끔
- [ ] 로그(메일 본문·수신자) 보존 기간 확인 — 처리방침 기재와 일치하는지
- [ ] API 키는 운영 환경에만 주입(저장소·이미지에 없음)
