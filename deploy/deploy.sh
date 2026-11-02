#!/bin/sh
# WithSmall 서버 배포·롤백(내부 테스트). 서버 위치: /opt/withsmall/bin/deploy.sh — SSH 강제 명령 deploy-gate.sh 가 호출한다.
#   사용: deploy.sh deploy sha-<12 hex>
#         deploy.sh rollback
#   흐름(deploy): 사전 점검(env 파일 0600·__SET_ME__ 없음) → pull → 아키텍처 확인(호스트와 같아야) →
#     마이그레이션 목록 비교(현재 vs 새 이미지, 못 읽으면 거부 — QA133 LOW-12) → app 정지 → 배포 전 DB 백업(data/backup/prod-<UTC>-predeploy.db) →
#     state/image.env 교체 → compose up → 헬스(기본 150초) → 성공: state current/previous 갱신·이전 태그 2개 밖 이미지 정리.
#     실패: app 정지 → (마이그레이션이 달랐으면) 배포 전 백업 복원 → 이전 이미지로 기동 → 종료 코드 1(롤백도 실패면 3).
#       마이그레이션이 다른데 복원을 못 하면 이전 이미지를 새 스키마 DB 위에 띄우지 않는다 — app 정지 상태로 종료 3(수동 복원).
#       배포 전에 DB 가 없었으면(nodb) 새 이미지가 만든 DB 를 data/backup/prod-<UTC>-faileddeploy.db 로 치운 뒤 기동(QA127 LOW-6).
#     DB 가 있는데 배포 전 백업이 실패하면 배포하지 않는다(이전 이미지 재기동, 종료 1).
#   rollback: current ↔ previous 교체(마이그레이션이 다르면 배포 전 백업 복원 — 그 뒤 쓰인 데이터는 사라진다, 로그로 알림).
#     복원에 필요한 백업 파일·이전 이미지는 app 을 멈추기 전에 확인한다(없으면 서비스 그대로 두고 거부, QA122 MED-1).
#   복원은 언제나 지금 DB 를 data/backup/prod-<UTC>-prerollback.db 로 먼저 복사한다(QA127 LOW-7).
#   SSH 끊김·러너 취소(SIGPIPE): PIPE 무시 + 화면 출력 실패 무시, docker 출력은 state/deploy.log 로만 → 끊겨도 끝까지 진행(QA127 MED-3).
#     기록: state/deploy.log(이번 실행)·deploy.log.1(직전). 실행 중 프로세스 없는 오래된 잠금은 같은 명령으로 회수(acquire_lock).
#     DB 를 바꾸는 단계(새 이미지 기동·복원) 도중 신호·kill -9 로 끝나거나 종료 3 이면 state/dbchange 가 남아
#     다음 실행을 거부(관리자 확인, 6절). 지우는 것은 DB 와 image.env 가 맞는 채 끝난 종료 0·1 뿐(QA131 MED-4).
#     표시를 쓰지 못하면 DB 를 바꾸는 단계로 가지 않는다(이전 이미지 재기동, 종료 1 — QA133 INFO-10).
#   출력에 시크릿 없음(env 파일 내용은 읽어 검사만 하고 출력하지 않는다). 외부로 나가는 요청은 레지스트리 pull 뿐.
#   백업 이름은 prod-*.db 형식 → 컨테이너 엔트리포인트의 prune-backups.sh 가 7일·5개 규칙으로 함께 정리한다(처리방침 백업 7일).
#   운영자 기록 1년(security 139 MED-3, Kenny 승인 "운영자 기록만 따로 1년 보관"): log() 의 단계 줄(태그·단계·결과, 시크릿·접속 IP 없음)을
#     syslog authpriv.info 태그 ws-admin-deploy 로도 보낸다 → journald → bootstrap.sh 의 내보내기가 /var/log/withsmall-admin/ 에 1년 보관.
#     docker 출력(state/deploy.log)은 그대로 두 번만. logger 가 없거나 실패해도 배포는 계속한다.
#   고아 짝 파일(LOW-7): 성공 뒤 data/backup 의 prod-*.db-journal·-wal·-shm 중 짝 prod-*.db 가 없고 7일(처리방침 백업 보관)을 넘긴 것을 지운다
#     — prune-backups.sh 는 prod-*.db 를 기준으로만 지우므로 짝 없는 사본(예: DB 없이 남은 journal)이 계속 남던 것.
#   테스트용 재정의(env): WS_ROOT WS_DOCKER WS_HOST_ARCH WS_HEALTH_TIMEOUT WS_HEALTH_INTERVAL WS_LOCK_STALE_SEC WS_LOCK_TEST_PAUSE
#     WS_ADMIN_LOGGER(빈 값 = 운영자 기록 끔) — scripts/__tests__/deploy-sh.test.mjs.
set -eu
LC_ALL=C
export LC_ALL

ROOT="${WS_ROOT:-/opt/withsmall}"
DOCKER="${WS_DOCKER:-docker}"
HEALTH_TIMEOUT="${WS_HEALTH_TIMEOUT:-150}"
HEALTH_INTERVAL="${WS_HEALTH_INTERVAL:-5}"
STATE="$ROOT/state"
DATA="$ROOT/data"
PROJECT=withsmall
# 실행 중 프로세스가 없는 잠금을 회수하기까지의 최소 나이(초).
LOCK_STALE_SEC="${WS_LOCK_STALE_SEC:-600}"
# 서버 쪽 기록(잠금을 잡은 뒤 설정). 비어 있으면 화면(SSH)에만.
LOG=""
# 운영자 기록(MED-3). 설정 안 됨 = logger(있으면), 빈 값 = 끔. PermitUserEnvironment no 라 배포 키로는 바꿀 수 없다.
if [ "${WS_ADMIN_LOGGER+set}" = set ]; then ADMIN_LOGGER="$WS_ADMIN_LOGGER"; elif command -v logger >/dev/null 2>&1; then ADMIN_LOGGER="logger"; else ADMIN_LOGGER=""; fi
# 백업 보관 일수 — scripts/prune-backups.sh POLICY_MAX_AGE · server/src/privacy/policy.ts BACKUP_RETENTION_DAYS 와 같아야 한다(deploy-config.test.mjs).
BACKUP_MAX_AGE_DAYS=7

# 화면 출력은 실패해도(SSH 끊김 = EPIPE) 멈추지 않는다 — set -e 라 `|| true` 필수(QA127 MED-3).
log() {
  if [ -n "$LOG" ]; then printf '%s [deploy] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG" 2>/dev/null || true; fi
  if [ -n "$ADMIN_LOGGER" ]; then "$ADMIN_LOGGER" -p authpriv.info -t ws-admin-deploy -- "$*" </dev/null >/dev/null 2>&1 || true; fi
  { printf '[deploy] %s\n' "$*"; } 2>/dev/null || true
}
fail() { log "FAIL: $*" >&2; exit 1; }

usage() {
  log "usage: deploy.sh deploy sha-<12 hex> | deploy.sh rollback" >&2
  exit 2
}

# 태그 형식: sha-<소문자 16진 12자>. case 패턴은 문자열 전체와 맞는다(개행·공백 불가).
valid_tag() {
  case "$1" in
    sha-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) return 0 ;;
    *) return 1 ;;
  esac
}

valid_backup_name() {
  case "$1" in
    prod-[0-9]*T[0-9]*Z-predeploy.db) case "$1" in *[!A-Za-z0-9.-]*) return 1 ;; *) return 0 ;; esac ;;
    *) return 1 ;;
  esac
}

read_conf() {
  conf="$ROOT/deploy.conf"
  [ -f "$conf" ] || fail "deploy.conf 없음($conf) — bootstrap.sh --image-repo 로 만든다"
  # source 하지 않고 한 줄만 읽는다.
  REPO="$(tr -d '\r' < "$conf" | sed -n 's/^WS_IMAGE_REPO=//p' | tail -n 1)"
  case "$REPO" in
    ''|*[!a-z0-9./_-]*|*__*) fail "deploy.conf WS_IMAGE_REPO 형식 오류(소문자 ghcr.io/<owner>/<repo>)" ;;
  esac
}

# 파일 권한 8진수(GNU stat → BSD stat 순). 못 읽으면 빈 값.
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || true; }

preflight() {
  # caddy.env 는 보지 않는다(basic_auth 폐기 — ORDERS §40). 이미 bootstrap 된 서버에 예시 그대로(__SET_ME__) 남아 있어도 배포를 막지 않는다.
  for f in server.env; do
    p="$ROOT/$f"
    [ -f "$p" ] || fail "$f 없음 — deploy/$f.example 을 보고 만든다(0600)"
    if [ "${WS_SKIP_MODE_CHECK:-0}" != "1" ]; then
      m="$(file_mode "$p")"
      [ "$m" = "600" ] || fail "$f 권한 $m — 600 이어야 한다(chmod 600 $p)"
    fi
    # 주석 줄은 제외(server.env.example 머리 주석에 __SET_ME__ 라는 낱말이 있다 — 값 줄만 본다, BE124).
    if grep -v '^[[:space:]]*#' "$p" | grep -q '__SET_ME__'; then fail "$f 에 __SET_ME__ 자리가 남아 있다"; fi
  done
  [ -f "$ROOT/compose.yaml" ] || fail "compose.yaml 없음"
  [ -f "$ROOT/Caddyfile" ] || fail "Caddyfile 없음"
  mkdir -p "$STATE"
}

host_arch() {
  a="${WS_HOST_ARCH:-$(uname -m)}"
  case "$a" in
    aarch64|arm64) echo arm64 ;;
    x86_64|amd64) echo amd64 ;;
    *) echo "$a" ;;
  esac
}

dc() { "$DOCKER" compose --project-name "$PROJECT" --project-directory "$ROOT" -f "$ROOT/compose.yaml" --env-file "$STATE/image.env" "$@"; }

set_image() {
  printf 'WS_IMAGE=%s\n' "$1" > "$STATE/image.env.tmp"
  mv "$STATE/image.env.tmp" "$STATE/image.env"
}

state_get() { if [ -f "$STATE/$1" ]; then head -n 1 "$STATE/$1"; fi; }
state_put() { printf '%s\n' "$2" > "$STATE/$1.tmp" && mv "$STATE/$1.tmp" "$STATE/$1"; }

# 이미지 안의 마이그레이션 폴더 목록(한 줄로). 비교용.
migrations_of() {
  "$DOCKER" run --rm --network none --entrypoint sh "$1" -c 'ls -1 /app/server/prisma/migrations 2>/dev/null | tr "\n" " "' 2>>"$LOG"
}

# 두 이미지의 마이그레이션 목록 비교: 0 = 같음, 1 = 다름, 2 = 알 수 없음(docker 실패·빈 목록).
#   알 수 없음을 '같음'으로 보면 실패한 배포 뒤 이전 이미지를 새 스키마 DB 위에 띄울 수 있다(QA133 LOW-12) → 호출한 쪽은
#   app 을 멈추기 전에 거부한다(아무것도 바꾸지 않음).
migrations_cmp() {
  ma="$(migrations_of "$1")" || return 2
  mb="$(migrations_of "$2")" || return 2
  [ -n "$ma" ] && [ -n "$mb" ] || return 2
  [ "$ma" = "$mb" ] || return 1
  return 0
}

stop_app() { dc stop app >/dev/null 2>&1 || true; }

# 정지한 상태에서 /data/prod.db → /data/backup/<name>. 이미지 안의 sh 로(데이터 폴더는 uid 1000 소유 — 호스트 사용자와 무관).
#   출력: copied(복사함) · nodb(DB 없음 — 첫 기동 전). 그 밖(빈 출력) = DB 가 있는데 복사 실패.
backup_predeploy() {
  img="$1"; name="$2"
  "$DOCKER" run --rm --network none --entrypoint sh -v "$DATA:/data" "$img" -c \
    "if [ -f /data/prod.db ]; then mkdir -p /data/backup && cp /data/prod.db /data/backup/$name && echo copied; else echo nodb; fi" 2>/dev/null || true
}

# 배포 전 백업 파일이 있는지(app 을 멈추기 전에 확인 — 엔트리포인트 prune 7일·5개로 지워졌을 수 있다).
backup_present() {
  img="$1"; name="$2"
  valid_backup_name "$name" || return 1
  [ "$("$DOCKER" run --rm --network none --entrypoint sh -v "$DATA:/data" "$img" -c "if [ -f /data/backup/$name ]; then echo present; fi" 2>/dev/null || true)" = "present" ]
}

# 복원(QA127 LOW-5·LOW-7): ① 남은 prod.db.restore 치움 ② 백업 → prod.db.restore 복사 ③ 지금 DB(+ -journal·-wal)를
#   data/backup/<keep> 로 복사(되돌릴 길, prune 대상 이름) ④ 지금 DB 의 -journal·-wal·-shm 을 지우지 않고 옆(.prerestore)으로 옮김
#   ⑤ mv prod.db.restore → prod.db. ⑤가 실패하면 ④를 되돌린다 = 지금 DB 와 그 journal 은 그대로. ⑥ 성공 뒤에만 옮긴 짝 파일 삭제.
#   (짝 파일을 남겨 두면 복원한 DB 에 새 스키마 DB 의 journal 이 섞인다.) 이름은 형식 검사를 통과한 값만 끼워 넣는다.
restore_predeploy() {
  img="$1"; name="$2"
  valid_backup_name "$name" || { log "배포 전 백업 이름 형식 오류 — 복원하지 않음"; return 1; }
  keep="prod-$(date -u +%Y%m%dT%H%M%SZ)-prerollback.db"
  s='set -eu
B=/data/backup/'"$name"'
K=/data/backup/'"$keep"'
[ -f "$B" ]
rm -rf /data/prod.db.restore
cp "$B" /data/prod.db.restore
if [ -f /data/prod.db ]; then for x in "" -journal -wal; do if [ -f "/data/prod.db$x" ]; then cp "/data/prod.db$x" "$K$x"; fi; done; fi
moved=""
undo() { for x in $moved; do mv "/data/prod.db$x.prerestore" "/data/prod.db$x" || true; done; rm -f /data/prod.db.restore; }
for x in -journal -wal -shm; do if [ -e "/data/prod.db$x" ]; then mv "/data/prod.db$x" "/data/prod.db$x.prerestore" || { undo; exit 1; }; moved="$moved $x"; fi; done
mv /data/prod.db.restore /data/prod.db || { undo; exit 1; }
for x in $moved; do rm -f "/data/prod.db$x.prerestore"; done
echo "restored; previous db copied to backup/$(basename "$K")"'
  "$DOCKER" run --rm --network none --entrypoint sh -v "$DATA:/data" "$img" -c "$s" >>"$LOG" 2>&1
}

# 배포 전에 DB 가 없었는데 새 이미지가 만든 DB(새 스키마)를 치운다(QA127 LOW-6) — 이전 이미지가 '없음' 상태에서 시작하게.
#   지우지 않고 data/backup/prod-<UTC>-faileddeploy.db(+ -journal·-wal) 로 옮긴다(prune 대상). 하나라도 실패하면 1.
discard_new_db() {
  img="$1"
  gone="prod-$(date -u +%Y%m%dT%H%M%SZ)-faileddeploy.db"
  s='set -eu
G=/data/backup/'"$gone"'
if [ -f /data/prod.db ]; then mkdir -p /data/backup; mv /data/prod.db "$G"; fi
for x in -journal -wal; do if [ -e "/data/prod.db$x" ]; then mkdir -p /data/backup; mv "/data/prod.db$x" "$G$x"; fi; done
rm -f /data/prod.db-shm
if [ -e /data/prod.db ] || [ -e /data/prod.db-journal ] || [ -e /data/prod.db-wal ]; then exit 1; fi
echo discarded'
  "$DOCKER" run --rm --network none --entrypoint sh -v "$DATA:/data" "$img" -c "$s" >>"$LOG" 2>&1
}

wait_healthy() {
  waited=0
  while [ "$waited" -le "$HEALTH_TIMEOUT" ]; do
    cid="$(dc ps -q app 2>/dev/null | head -n 1 || true)"
    if [ -n "$cid" ]; then
      st="$("$DOCKER" inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo none)"
      case "$st" in
        healthy) return 0 ;;
        unhealthy) return 1 ;;
      esac
    fi
    sleep "$HEALTH_INTERVAL"
    waited=$((waited + HEALTH_INTERVAL))
    [ "$HEALTH_INTERVAL" -gt 0 ] || waited=$((waited + 1))
  done
  return 1
}

up_with() {
  set_image "$1"
  dc up -d --remove-orphans >>"$LOG" 2>&1
}

# DB 를 바꾸는 단계(새 이미지 기동 = 마이그레이션, 복원, 새 DB 치우기) 표시. 남으면 다음 실행을 거부한다(QA127 MED-3).
#   지우는 곳은 하나 — 종료(finish) 때, DB 와 image.env 가 맞는다고 확인된 지점(settle_dbchange)을 지났고 종료 코드가 0·1 일 때만.
#   종료 3(app 정지·수동 복원), 신호, kill -9·재부팅, 예상 못 한 set -e 종료면 남는다(QA131 MED-4: 종료 3 에서 지워지던 것).
OWN_DBCHANGE=0
DBCHANGE_SETTLED=0
mark_dbchange() {
  # 표시를 못 쓰면(디스크 등) DB 를 바꾸는 단계로 가지 않는다(QA133 INFO-10, fail closed) — 1 을 돌려주고
  #   호출한 쪽(mark_or_abort)이 멈춘 이미지를 다시 띄운다. 반쯤 쓰인 파일은 치운다(아직 DB 는 그대로).
  if { printf '%s %s\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE/dbchange"; } 2>/dev/null; then
    OWN_DBCHANGE=1
    DBCHANGE_SETTLED=0
    return 0
  fi
  rm -f "$STATE/dbchange" 2>/dev/null || true
  log "state/dbchange 쓰기 실패 — DB 를 바꾸는 단계로 가지 않는다" >&2
  return 1
}
# mark_dbchange 실패 시: DB 는 아직 그대로 → <되돌릴 이미지>(없으면 정지 그대로)로 다시 띄우고 종료 1(재기동도 실패면 3, 표시 없음 = DB 는 안 바뀜).
mark_or_abort() {
  mark_dbchange "$1" && return 0
  [ -n "$2" ] || fail "state/dbchange 를 쓰지 못해 중단(DB 변경 전, 띄운 이미지 없음) — state 폴더·디스크 확인"
  if up_with "$2" && wait_healthy; then fail "state/dbchange 를 쓰지 못해 중단(DB 변경 전) — app 은 $2 그대로, state 폴더·디스크 확인"; fi
  log "state/dbchange 를 쓰지 못해 중단, $2 재기동도 헬스 실패 — 수동 조치 필요(docs/ops/deploy.md 6절, DB 는 바뀌지 않음)" >&2
  exit 3
}
# DB 와 image.env(띄운·띄울 이미지)가 맞는 상태로 끝나는 지점에서만 부른다.
settle_dbchange() { DBCHANGE_SETTLED=1; }

# current·previous 태그 밖의 이 저장소 이미지 제거 + 매달린 이미지 정리. 실패해도 배포 결과에는 영향 없음.
prune_images() {
  keep1="$(state_get current)"; keep2="$(state_get previous)"
  "$DOCKER" image ls --format '{{.Repository}}:{{.Tag}}' "$REPO" 2>/dev/null | while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    [ "$ref" = "$keep1" ] && continue
    [ "$ref" = "$keep2" ] && continue
    "$DOCKER" image rm "$ref" >/dev/null 2>&1 || true
  done
  "$DOCKER" image prune -f >/dev/null 2>&1 || true
}

# 고아 짝 파일 정리(LOW-7): 짝 prod-*.db 가 없는 prod-*.db-journal·-wal·-shm 중 BACKUP_MAX_AGE_DAYS 일을 넘긴 것만 지운다(분 단위 — prune-backups.sh 와 같은 판정).
#   짝이 있는 사본은 prune-backups.sh 가 .db 와 함께 지운다. 실패해도 배포 결과에는 영향 없음(기록만).
prune_orphan_sidecars() {
  img="$1"
  s='cd /data/backup 2>/dev/null || exit 0
find . -maxdepth 1 -type f \( -name "prod-*.db-journal" -o -name "prod-*.db-wal" -o -name "prod-*.db-shm" \) -mmin +'"$((BACKUP_MAX_AGE_DAYS * 1440))"' | while IFS= read -r f; do
  b="${f%-journal}"; b="${b%-wal}"; b="${b%-shm}"
  if [ ! -e "$b" ]; then rm -f "$f" && echo "orphan sidecar pruned ${f#./}"; fi
done'
  "$DOCKER" run --rm --network none --entrypoint sh -v "$DATA:/data" "$img" -c "$s" >>"$LOG" 2>&1 || log "고아 짝 파일 정리 실패(무시) — data/backup 확인"
}

cmd_deploy() {
  tag="$1"
  valid_tag "$tag" || usage
  new="$REPO:$tag"
  cur="$(state_get current)"
  log "pull $new"
  "$DOCKER" pull "$new" >>"$LOG" 2>&1 || fail "pull 실패($new) — 레지스트리 로그인(read:packages)·태그 확인(state/deploy.log)"
  want="$(host_arch)"
  got="$("$DOCKER" image inspect --format '{{.Architecture}}' "$new" 2>/dev/null || echo unknown)"
  [ "$got" = "$want" ] || fail "이미지 아키텍처 $got ≠ 호스트 $want — TARGET_PLATFORM 확인"

  migdiff=0
  pre=""
  bres=""
  if [ -n "$cur" ] && [ "$cur" != "$new" ]; then
    mres=0; migrations_cmp "$cur" "$new" || mres=$?
    case "$mres" in
      0) ;;
      1) migdiff=1; log "마이그레이션 목록이 다르다 — 실패 시 배포 전 백업을 복원한다" ;;
      *) fail "마이그레이션 목록을 읽지 못함($cur / $new — docker 실패 또는 빈 목록) — 배포하지 않음, app 은 그대로(state/deploy.log)" ;;
    esac
  fi
  if [ -n "$cur" ]; then
    stop_app
    name="prod-$(date -u +%Y%m%dT%H%M%SZ)-predeploy.db"
    bres="$(backup_predeploy "$cur" "$name")"
    case "$bres" in
      copied) pre="$name"; log "배포 전 백업 data/backup/$name" ;;
      nodb) log "배포 전 백업 생략(DB 없음)" ;;
      *)
        log "배포 전 백업 실패 — 배포하지 않고 $cur 재기동"
        if up_with "$cur" && wait_healthy; then fail "배포 전 백업 실패 — 배포 중단(이전 이미지 그대로)"; fi
        log "이전 이미지 재기동도 헬스 실패 — 수동 조치 필요(docs/ops/deploy.md 6절)" >&2
        exit 3 ;;
    esac
  fi

  log "up $new"
  mark_or_abort "deploy $new (이전 ${cur:-없음}, 배포 전 백업 ${pre:-없음})" "$cur"
  if up_with "$new" && wait_healthy; then
    if [ -n "$cur" ] && [ "$cur" != "$new" ]; then
      state_put previous "$cur"
      if [ -n "$pre" ]; then state_put predeploy "$pre"; else rm -f "$STATE/predeploy"; fi
    fi
    state_put current "$new"
    settle_dbchange
    prune_images
    prune_orphan_sidecars "$new"
    log "OK $new"
    return 0
  fi

  log "헬스 실패: $new"
  if [ -z "$cur" ] || [ "$cur" = "$new" ]; then
    stop_app
    # image.env = 새 이미지, DB = 그 이미지가 만든·바꾼 DB → 서로 맞다(같은 명령 재시도 가능).
    settle_dbchange
    fail "되돌릴 이전 이미지 없음 — app 정지 상태(docs/ops/deploy.md 6절)"
  fi
  stop_app
  if [ "$migdiff" = "1" ]; then
    if [ -n "$pre" ] && restore_predeploy "$cur" "$pre"; then
      log "배포 전 백업 복원 $pre (실패한 배포의 DB 사본: data/backup/prod-*-prerollback.db)"
    elif [ "${bres:-}" = "nodb" ]; then
      # 배포 전에 DB 가 없었다 = 지금 DB 는 새 이미지가 만든 새 스키마 DB. 치우고 '없음' 상태에서 이전 이미지를 띄운다(QA127 LOW-6).
      if discard_new_db "$cur"; then
        log "배포 전에 DB 없었음 — 새 이미지가 만든 DB 를 data/backup/prod-*-faileddeploy.db 로 치움"
      else
        log "새 이미지가 만든 DB 를 치우지 못함 — 이전 이미지를 새 스키마 DB 위에 띄우지 않는다, app 정지 상태(docs/ops/deploy.md 6절)" >&2
        exit 3
      fi
    else
      # 이전 이미지를 새 스키마 DB 위에 띄우지 않는다(데이터 손상·예측 불가 동작보다 정지가 낫다).
      log "배포 전 백업 복원 못 함 — app 정지 상태, 수동 복원 필요(docs/ops/deploy.md 6절)" >&2
      exit 3
    fi
  fi
  log "자동 롤백 → $cur"
  if up_with "$cur" && wait_healthy; then
    settle_dbchange
    log "롤백 OK $cur (배포 실패)"
    exit 1
  fi
  log "롤백도 헬스 실패 — 수동 조치 필요(docs/ops/deploy.md 6절)" >&2
  exit 3
}

cmd_rollback() {
  cur="$(state_get current)"; prev="$(state_get previous)"
  [ -n "$prev" ] || fail "previous 없음 — 되돌릴 이미지가 없다"
  [ -n "$cur" ] || fail "current 없음"
  # 아래 확인은 모두 app 을 멈추기 전 — 하나라도 실패하면 지금 서비스를 그대로 둔다.
  "$DOCKER" image inspect "$prev" >/dev/null 2>&1 || "$DOCKER" pull "$prev" >>"$LOG" 2>&1 || fail "pull 실패($prev) — app 은 그대로"
  pre="$(state_get predeploy)"
  migdiff=0
  mres=0; migrations_cmp "$cur" "$prev" || mres=$?
  [ "$mres" -le 1 ] || fail "마이그레이션 목록을 읽지 못함($cur / $prev — docker 실패 또는 빈 목록) — app 은 그대로(state/deploy.log)"
  if [ "$mres" = "1" ]; then
    migdiff=1
    [ -n "$pre" ] || fail "마이그레이션이 다른데 배포 전 백업 기록 없음 — 수동 복원(docs/ops/deploy.md 6절)"
    valid_backup_name "$pre" || fail "배포 전 백업 기록 형식 오류($pre) — app 은 그대로"
    backup_present "$prev" "$pre" || fail "배포 전 백업 파일 없음(data/backup/$pre, 정리됐을 수 있음) — app 은 그대로, 수동 복원(docs/ops/deploy.md 6절)"
  fi
  stop_app
  if [ "$migdiff" = "1" ]; then
    mark_or_abort "rollback $cur -> $prev (복원 $pre)" "$cur"
    if ! restore_predeploy "$prev" "$pre"; then
      # 지금 DB 의 짝 파일(-journal 등)은 mv 성공 뒤에만 지우고 실패하면 되돌린다(QA127 LOW-5) — 지금 DB 는 그대로, 원래 이미지로 다시 띄운다.
      log "배포 전 백업 복원 실패($pre) — $cur 재기동"
      if up_with "$cur" && wait_healthy; then settle_dbchange; fail "rollback 중단 — 복원 실패, app 은 $cur 그대로"; fi
      log "재기동도 헬스 실패 — 수동 조치 필요(docs/ops/deploy.md 6절)" >&2
      exit 3
    fi
    log "배포 전 백업 복원 $pre — 그 배포 뒤 쓰인 데이터는 사라졌다(복원 전 DB 사본: data/backup/prod-*-prerollback.db, 7일·5개 정리)"
  fi
  log "rollback → $prev"
  if up_with "$prev" && wait_healthy; then
    state_put current "$prev"
    state_put previous "$cur"
    rm -f "$STATE/predeploy"
    settle_dbchange
    prune_orphan_sidecars "$prev"
    log "OK $prev"
    return 0
  fi
  log "롤백 헬스 실패 — 수동 조치 필요(docs/ops/deploy.md 6절)" >&2
  exit 3
}

# 파일 수정 시각(epoch 초, GNU stat → BSD stat). 못 읽으면 빈 값.
file_mtime() { stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null || true; }

# 잠금을 잡은 deploy.sh 가 아직 살아 있는지. /proc 가 있으면 명령줄에 deploy.sh 가 있어야 한다(PID 재사용 방어).
lock_pid_alive() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$1" 2>/dev/null || return 1
  if [ -r "/proc/$1/cmdline" ]; then
    tr '\000' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -q 'deploy\.sh' || return 1
  fi
  return 0
}

write_lock_info() {
  printf '%s %s\n' "$$" "$(date +%s)" > "$lock/info" || { rmdir "$lock" 2>/dev/null || true; fail "잠금 정보 쓰기 실패($lock)"; }
}

release_lock() { rm -f "$lock/info" 2>/dev/null || true; rmdir "$lock" 2>/dev/null || true; }

# 동시 실행 방지(mkdir 원자성 — flock 없는 환경도 동일). 잠금 안 info = "<pid> <epoch>".
#   남은 잠금(QA127 MED-3): 그 pid 의 deploy.sh 가 살아 있지 않고 LOCK_STALE_SEC 이상 지났으면 회수 — 배포 키(강제 명령)로
#   같은 deploy/rollback 을 다시 보내면 풀린다(관리자 rmdir 불필요). info 가 없으면(옛 형식·손으로 만든 잠금) 폴더 수정 시각으로 잰다.
#   WS_LOCK_TEST_PAUSE(테스트 전용, 숫자 초만): 회수 판정 뒤·mv 전, 그리고 rm 뒤·mkdir 전에 멈춰 경합을 재현한다(QA131 LOW-9).
lock_test_pause() {
  case "${WS_LOCK_TEST_PAUSE:-0}" in ''|0|*[!0-9]*) return 0 ;; esac
  sleep "$WS_LOCK_TEST_PAUSE"
}

acquire_lock() {
  if mkdir "$lock" 2>/dev/null; then write_lock_info; return 0; fi
  info="$(head -n 1 "$lock/info" 2>/dev/null || true)"
  # "<pid> <epoch>" 일 때만 시각을 info 에서 읽는다. 빈 info·pid 만(숫자, 공백 없음)은 폴더 수정 시각(QA131 INFO-5).
  #   그 밖의 형태는 나이를 알 수 없음 → 거부.
  case "$info" in
    *' '*) lpid="${info%% *}"; lts="${info#* }" ;;
    '') lpid=""; lts="$(file_mtime "$lock")" ;;
    *[!0-9]*) lpid=""; lts="" ;;
    *) lpid="$info"; lts="$(file_mtime "$lock")" ;;
  esac
  case "$lts" in ''|*[!0-9]*) fail "다른 배포가 진행 중(잠금 $lock — 나이를 알 수 없음, 관리자가 확인 후 sudo -u deploy rm -r $lock)" ;; esac
  age=$(( $(date +%s) - lts ))
  if lock_pid_alive "$lpid"; then fail "다른 배포가 진행 중(잠금 pid $lpid, ${age}초 전 시작)"; fi
  [ "$age" -ge "$LOCK_STALE_SEC" ] || fail "다른 배포가 진행 중이거나 막 중단됐다(잠금 ${age}초, 실행 중 deploy.sh 없음) — ${LOCK_STALE_SEC}초가 지나면 같은 명령으로 잠금을 회수한다"
  lock_test_pause
  stale="$lock.stale.$$"
  mv "$lock" "$stale" 2>/dev/null || fail "남은 잠금 회수 실패($lock)"
  if [ "$(head -n 1 "$stale/info" 2>/dev/null || true)" != "$info" ]; then
    # 판정한 그 잠금이 아니다(그 사이 다른 실행이 잡았다) — 되돌리고 거부.
    [ -e "$lock" ] || mv "$stale" "$lock" 2>/dev/null || true
    fail "잠금 회수 중 경합 — 다른 배포가 진행 중일 수 있다"
  fi
  rm -rf "$stale"
  lock_test_pause
  # -p 금지: 그 사이 다른 실행이 잡은 잠금이면 여기서 실패해야 한다(배타성).
  mkdir "$lock" 2>/dev/null || fail "다른 배포가 진행 중(잠금 회수 직후 경합)"
  write_lock_info
  RECLAIMED="pid ${lpid:-?}, ${age}초 전"
}

# 종료 처리는 한 번만(신호 뒤 EXIT 트랩이 다시 돌지 않게 on_signal 이 EXIT 트랩을 먼저 지운다).
#   state/deploy.log 끝에 종료 코드를 남긴다 — SSH 가 끊겨 화면을 못 봤어도 종료 3 을 알 수 있게.
#   dbchange 는 settle_dbchange 를 지났고 종료 0·1 일 때만 지운다(MED-4). 남기면 그 사실을 기록한다.
finish() {
  rc="$1"
  if [ "$OWN_DBCHANGE" = "1" ]; then
    if [ "$DBCHANGE_SETTLED" = "1" ] && { [ "$rc" = "0" ] || [ "$rc" = "1" ]; }; then
      rm -f "$STATE/dbchange" 2>/dev/null || true
    else
      # 왜 남겼는지 적는다(관리자 판단 근거): 확인 지점 전에 끝났는지, 확인 지점은 지났지만 종료 코드가 0·1 이 아닌지(신호 등).
      if [ "$DBCHANGE_SETTLED" = "1" ]; then why="DB·image.env 확인 지점은 지났으나 종료 코드 $rc"; else why="DB·image.env 확인 지점 전에 끝남"; fi
      if [ -f "$STATE/dbchange" ]; then
        log "state/dbchange 남김($why) — DB 와 image.env 가 어긋났을 수 있다. 다음 deploy/rollback 은 거부된다(관리자: docs/ops/deploy.md 6절, sudo -u deploy rm $STATE/dbchange)" >&2
      else
        log "state/dbchange 를 남겨야 하는데 파일이 없다($why) — 다음 실행은 거부되지 않는다. 관리자가 docs/ops/deploy.md 6절대로 DB·image.env 를 확인" >&2
      fi
    fi
  fi
  release_lock
  log "종료 코드 $rc"
}

on_signal() {
  trap - EXIT HUP INT TERM
  log "신호 $2 — 중단(잠금 해제). app 상태 확인: docs/ops/deploy.md 6절" >&2
  finish "$1"
  exit "$1"
}

on_exit() {
  rc=$?
  finish "$rc"
}

main() {
  # SSH 끊김·러너 취소는 HUP 가 아니다(authorized_keys restrict = no-pty, ssh -t 없음) — 다음 출력 쓰기의 SIGPIPE 다.
  #   PIPE 무시 + 화면 출력 실패 무시(log) → 끊겨도 끝까지 진행해 app 을 정지 상태로 두지 않는다(QA127 MED-3).
  #   SIG_IGN 은 자식(docker 등)에게도 물려지고, docker 출력은 state/deploy.log 로만 간다. 표준입력은 SSH 채널 대신 /dev/null.
  trap '' PIPE
  exec </dev/null
  [ $# -ge 1 ] || usage
  read_conf
  mkdir -p "$ROOT/state"
  lock="$ROOT/state/.lock"
  RECLAIMED=""
  acquire_lock
  # Ctrl-C·TERM·HUP(사람이 보낸 신호)는 잠금을 풀고 바로 멈춘다 — 핸들러 뒤 계속 실행하지 않는다(QA122 LOW-1).
  #   진행 중이던 단계(app 정지 등)는 그대로일 수 있다 → 같은 명령을 다시 보내면 이어서 맞춘다. DB 를 바꾸는 단계였으면 dbchange 가 남는다.
  trap on_exit EXIT
  trap 'on_signal 129 HUP' HUP
  trap 'on_signal 130 INT' INT
  trap 'on_signal 143 TERM' TERM
  # dbchange 검사는 기록 회전보다 먼저(QA131 LOW-11): 거부된 실행은 deploy.log 를 돌리지 않고 끝에 덧붙인다 —
  #   중단된 실행의 기록(관리자가 판단할 근거)이 거부를 거듭해도 사라지지 않게.
  if [ -f "$STATE/dbchange" ]; then
    if : >> "$STATE/deploy.log" 2>/dev/null; then LOG="$STATE/deploy.log"; fi
    log "거부된 실행: $* (pid $$)"
    [ -z "$RECLAIMED" ] || log "남은 잠금 회수($RECLAIMED, 실행 중 deploy.sh 없음)"
    fail "이전 실행이 DB 를 바꾸는 단계에서 중단됐다($(head -n 1 "$STATE/dbchange" 2>/dev/null || true)) — DB·image.env 가 어긋났을 수 있다. 관리자가 docs/ops/deploy.md 6절대로 확인 후 sudo -u deploy rm $STATE/dbchange"
  fi
  # 서버 쪽 전체 기록: 이번 실행 state/deploy.log, 직전 실행 deploy.log.1(두 번만 보관 — 이미지 태그·단계·docker 출력, 접속 IP 없음).
  if [ -f "$STATE/deploy.log" ]; then mv -f "$STATE/deploy.log" "$STATE/deploy.log.1" 2>/dev/null || true; fi
  if : >> "$STATE/deploy.log" 2>/dev/null; then LOG="$STATE/deploy.log"; else LOG=/dev/null; fi
  log "시작: $* (pid $$, 기록 state/deploy.log)"
  [ -z "$RECLAIMED" ] || log "남은 잠금 회수($RECLAIMED, 실행 중 deploy.sh 없음) — 이전 실행이 중단됐다, 이 실행이 이어서 맞춘다"
  preflight
  case "$1" in
    deploy) [ $# -eq 2 ] || usage; cmd_deploy "$2" ;;
    rollback) [ $# -eq 1 ] || usage; cmd_rollback ;;
    *) usage ;;
  esac
}

main "$@"
