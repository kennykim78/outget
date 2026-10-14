#!/bin/sh
# WithSmall 동일 오리진 컨테이너 엔트리포인트(R6 A2). cwd = /app/server.
#   0) env 검사(node dist/config/env.js) — 누락·무효 env 이름을 한 번에 출력하고 중단(시크릿 값은 출력 0).
#   1) 기존 SQLite DB 백업 — /data/prod.db 가 있으면 /data/backup/prod-<UTC>.db 로 복사, 최근 WS_BACKUP_KEEP(기본 5)개만 보관.
#   2) prisma migrate deploy(비대화형). 실패하면 중단 — 롤백은 1)의 백업 파일을 DB 경로로 되돌리면 된다(docs/ops/deploy.md).
#   3) 시드 적재(node dist/seed/cli-load.js) — 검증 실패면 쓰기 0건 + 비0 종료 → 기동 중단. 시드는 DRAFT 그대로(노출은 엔진 판정).
#   4) exec node dist/index.js — PID 1 교체(SIGTERM 우아한 종료 전달).
# 불변식 ④: 결제·정산 없음. ⑧: 위치 저장 없음. 외부 네트워크 호출 없음(npx 대신 로컬 prisma CLI).
set -eu

log() { printf '[entrypoint] %s\n' "$*"; }

# DATABASE_URL=file:/abs/path.db 에서 파일 경로를 얻는다(그 밖의 형식이면 백업 생략).
DB_URL="${DATABASE_URL:-file:/data/prod.db}"
case "$DB_URL" in
  file:/*) DB_FILE="${DB_URL#file:}"; DB_FILE="${DB_FILE%%\?*}" ;;
  *) DB_FILE="" ;;
esac
BACKUP_DIR="${WS_BACKUP_DIR:-/data/backup}"
BACKUP_KEEP="${WS_BACKUP_KEEP:-5}"
PRISMA_CLI="${WS_PRISMA_CLI:-/app/node_modules/prisma/build/index.js}"

# 0) env
log "env check"
if ! node dist/config/env.js; then
  log "env check failed — not starting"
  exit 1
fi

# 1) backup
if [ -n "$DB_FILE" ] && [ -f "$DB_FILE" ]; then
  mkdir -p "$BACKUP_DIR"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dest="$BACKUP_DIR/prod-$ts.db"
  cp "$DB_FILE" "$dest"
  # 남은 저널(비정상 종료 흔적)이 있으면 함께 보존.
  for ext in -journal -wal; do
    if [ -f "$DB_FILE$ext" ]; then cp "$DB_FILE$ext" "$dest$ext"; fi
  done
  log "backup $DB_FILE -> $dest"
  # 최근 BACKUP_KEEP 개만(이름의 UTC 타임스탬프가 사전순 = 시간순).
  ls -1 "$BACKUP_DIR"/prod-*.db 2>/dev/null | sort -r | tail -n +"$((BACKUP_KEEP + 1))" | while IFS= read -r old; do
    rm -f "$old" "$old-journal" "$old-wal"
    log "backup pruned $old"
  done
else
  log "backup skipped (no existing db at ${DB_FILE:-<non-file DATABASE_URL>})"
fi

# 2) migrate
log "migrate deploy"
if ! node "$PRISMA_CLI" migrate deploy; then
  log "migrate failed — not starting (restore: cp <latest $BACKUP_DIR/prod-*.db> $DB_FILE)"
  exit 1
fi

# 3) seed
log "seed load"
if ! node dist/seed/cli-load.js; then
  log "seed load failed — not starting (DB unchanged by seed)"
  exit 1
fi

# 4) server
log "start server"
exec node dist/index.js
